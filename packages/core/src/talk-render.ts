// talk-render.ts — validator checks that need a real browser (`talkc validate --render`).
//
//   ghost-visible (error)   a `data-a` element is visible at a hold although no motion call
//                           has touched it before that hold (PLAN 3.1, the second ghost
//                           clause). Typical causes: a later beat's first opacity animation
//                           starts from a visible keyframe and fills backwards, or a theme
//                           rule overrides `[data-a] { opacity: 0 }`.
//
// At each hold the page is seeked (@sage/render), every `[data-a]` element under the stage
// whose effective opacity (own times every ancestor's) exceeds 0.05, that is displayed and
// not visibility:hidden, and whose box overlaps the stage, is collected by its elementKey; the
// recorder says which elements motion touched before that hold. @sage/render is imported
// lazily, so nothing else in core loads Playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileTalk } from './compile.ts';
import { diag, type Diagnostic } from './diagnostics.ts';
import { sceneElements } from './html.ts';
import type { LoadedTalk } from './load.ts';
import { publishTalk } from './publish.ts';
import { recordTalk, type Recording } from './record.ts';

const EPS = 1e-6;
export const GHOST_OPACITY = 0.05;

/** What the check needs from a film (an @sage/render Film satisfies it). */
export interface FrameProbe {
  holds(): { index: number; at: number; label: string; id?: string }[];
  seek(t: number): Promise<void>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

export interface VisibleElement { key: string; id: string | null; opacity: number }

/** Runs in the page: visible [data-a] elements, addressed like record.ts's elementKey. */
function visibleDataA(min: number): VisibleElement[] {
  const stage = document.querySelector('.stage');
  if (!stage) return [];
  const sr = stage.getBoundingClientRect();
  const key = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== stage; e = e.parentElement) {
      if (e.id) return ['#' + e.id, ...parts].join('/');
      const p: Element | null = e.parentElement;
      parts.unshift(String(p ? Array.prototype.indexOf.call(p.children, e) : 0));
    }
    return ['', ...parts].join('/');
  };
  const out: VisibleElement[] = [];
  for (const el of stage.querySelectorAll('[data-a]')) {
    if (getComputedStyle(el).visibility === 'hidden') continue;
    let op = 1, shown = true;
    for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none') { shown = false; break; }
      op *= parseFloat(cs.opacity);
    }
    if (!shown || op <= min) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right <= sr.left || r.left >= sr.right || r.bottom <= sr.top || r.top >= sr.bottom) continue;
    out.push({ key: key(el), id: el.id || null, opacity: Math.round(op * 1000) / 1000 });
  }
  return out;
}

/** Earliest motion-call start per element key. */
export function firstTouch(rec: Recording): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of rec.beats.values()) for (const c of b.calls) for (const i of c.targets) {
    const k = rec.elements[i]?.key;
    if (k !== undefined && !(c.start >= (m.get(k) ?? Infinity))) m.set(k, c.start);
  }
  return m;
}

/** The ghost-visible check against a loaded film. One diagnostic per element (its first hold). */
export async function ghostVisible(talk: LoadedTalk, rec: Recording, film: FrameProbe): Promise<Diagnostic[]> {
  const touch = firstTouch(rec);
  const D: (Diagnostic & { holds: number })[] = [];
  const seen = new Map<string, Diagnostic & { holds: number }>();
  // where an id lives in the sources, for a precise location
  const where = new Map<string, { file: string; text: string; offset: number }>();
  const files = [talk.layers, ...talk.chapters.map((c) => c.scene), talk.publicChapter?.scene ?? null];
  for (const f of files) if (f) for (const el of sceneElements(f.text)) if (el.id && !where.has(el.id)) where.set(el.id, { file: f.path, text: f.text, offset: el.loc.startOffset });
  for (const h of film.holds()) {
    await film.seek(h.at);
    for (const v of await film.evaluate(visibleDataA, GHOST_OPACITY)) {
      if ((touch.get(v.key) ?? Infinity) < h.at - EPS) continue;
      const prev = seen.get(v.key);
      if (prev) { prev.holds++; continue; }
      const name = v.id ? `#${v.id}` : `the data-a element at ${v.key || '(stage)'}`;
      const d = Object.assign(diag('ghost-visible', 'error', `${name} is visible at hold ${h.index} "${h.label}" (t=${h.at}, opacity ${v.opacity}) but no beat has brought it in yet`, { ...(v.id ? where.get(v.id) ?? {} : {}), ...(h.id ? { beat: h.id } : {}) }), { holds: 1 });
      seen.set(v.key, d);
      D.push(d);
    }
  }
  return D.map(({ holds, ...d }) => (holds > 1 ? { ...d, message: `${d.message}; visible at ${holds} holds` } : d));
}

export interface RenderValidateOptions { public?: boolean }

/**
 * Build the talk (or its public file) into a temporary folder, open it in headless Chromium and
 * run the browser checks. Build failures come back as their diagnostics.
 */
export async function validateRendered(talk: LoadedTalk, opts: RenderValidateOptions = {}): Promise<Diagnostic[]> {
  if (!talk.spine || !talk.dir) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talkc-render-'));
  try {
    let html: string;
    if (opts.public) {
      const r = publishTalk(talk.dir, { outDir: tmp, slug: 'public' });
      if (!r.ok) return r.diagnostics.filter((d) => d.severity === 'error');
      html = r.outFile!;
    } else {
      const r = compileTalk(talk.dir, { outDir: tmp });
      if (!r.ok) return r.diagnostics;
      html = r.outFile!;
    }
    const rec = recordTalk(talk, opts);
    const { openFilm } = await import('@sage/render');
    const film = await openFilm(html);
    try {
      const D = await ghostVisible(talk, rec, film);
      for (const e of film.errors()) D.push(diag('render-page-error', 'error', `the film threw in the browser: ${e.split('\n')[0]}`, {}));
      return D;
    } finally { await film.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
