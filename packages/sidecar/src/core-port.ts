// core-port.ts — the narrow slice of @sage/core the sidecar depends on.
//
// Everything that understands the sage-talk/1 format belongs to @sage/core (PLAN 4). Until its
// Phase 1 API lands, `stubCore` below stands in: it reads talk.json, computes holds statically
// from explicit `hold` values, checks referenced files exist, and compiles by shelling out to
// the Phase 0 compiler (`node spikes/format/build.mjs <root>`). Wiring the real core is a
// one-file change: implement CorePort on top of @sage/core and export it as `defaultCore`.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildResult, Diagnostic, Hold, LayoutResult } from './protocol.ts';

/** The minimum of the spine the sidecar itself looks at. */
export interface SpineBeat { id: string; label?: string; notes?: string; hold?: number; backup?: boolean }
export interface SpineChapter { id: string; label?: string; scene?: string; motion?: string; backup?: boolean; beats?: SpineBeat[] }
export interface Spine {
  format: string;
  title?: string;
  theme?: string;
  layers?: string;
  lib?: string[];
  defaults?: { holdPad?: number };
  chapters: SpineChapter[];
}

export interface LoadedTalk {
  /** Canonical absolute path of the talk folder. */
  root: string;
  spine: Spine;
}

/** Thrown by load() when talk.json is missing, unparsable or not sage-talk/1. */
export class NotATalkError extends Error {
  constructor(message: string) { super(message); this.name = 'NotATalkError'; }
}

export interface CorePort {
  /** Reads and checks talk.json. Throws NotATalkError when the folder is not a sage-talk/1 talk. */
  load(root: string): Promise<LoadedTalk>;
  /** Hold list and duration (PLAN 3.6). Never throws for content problems; reports diagnostics. */
  layout(talk: LoadedTalk): Promise<LayoutResult>;
  /** Static validation (references, ids, ordering). */
  validate(talk: LoadedTalk): Promise<Diagnostic[]>;
  /** Writes <root>/build/ (index.html + engine + assets). A failed compile is ok:false. */
  compile(talk: LoadedTalk): Promise<BuildResult>;
  // Phase 3: edit(talk, op) -> { writes: {path, content}[] } so the sidecar can register
  // expected writes before committing them atomically.
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
const SPIKE_BUILD = path.join(REPO_ROOT, 'spikes/format/build.mjs');

const r6 = (v: number) => { const s = Math.round(v * 1e6) / 1e6; return Math.abs(v - s) < 1e-9 ? s : v; };

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

export const stubCore: CorePort = {
  async load(root) {
    const abs = await fs.realpath(root).catch(() => { throw new NotATalkError(`${root} does not exist`); });
    let text: string;
    try { text = await fs.readFile(path.join(abs, 'talk.json'), 'utf8'); } catch { throw new NotATalkError(`${abs} has no talk.json`); }
    let spine: Spine;
    try { spine = JSON.parse(text) as Spine; } catch (e) { throw new NotATalkError(`talk.json is not valid JSON: ${(e as Error).message}`); }
    if (spine?.format !== 'sage-talk/1') throw new NotATalkError(`talk.json format is ${JSON.stringify(spine?.format)}, expected "sage-talk/1"`);
    if (!Array.isArray(spine.chapters)) throw new NotATalkError('talk.json has no chapters array');
    return { root: abs, spine };
  },

  async layout({ spine }) {
    // Static approximation: the real layout runs the motion to find auto-hold ends. Explicit
    // holds (the norm, per the Phase 0 memo) are exact.
    const pad = spine.defaults?.holdPad ?? 1.0;
    const holds: Hold[] = [];
    const diagnostics: Diagnostic[] = [];
    let cursor = 0;
    for (const ch of spine.chapters) {
      for (const b of ch.beats ?? []) {
        const beat = `${ch.id}.${b.id}`;
        const auto = typeof b.hold !== 'number';
        if (auto) diagnostics.push({ severity: 'info', code: 'auto-hold-approximate', message: `${beat} has no explicit hold; using holdPad ${pad}s until @sage/core layout lands`, beat });
        const at = r6(cursor + (auto ? pad : b.hold!));
        holds.push({ index: holds.length + 1, at, label: b.label ?? b.id, backup: !!(b.backup || ch.backup), beat, chapter: ch.id, auto });
        cursor = at;
      }
    }
    return { holds, duration: r6(cursor + 1.0), diagnostics };
  },

  async validate({ root, spine }) {
    const diagnostics: Diagnostic[] = [];
    const refs = [spine.theme ?? 'theme.css', spine.layers, ...(spine.lib ?? []), ...spine.chapters.flatMap((c) => [c.scene, c.motion])];
    for (const rel of refs) {
      if (rel && !(await exists(path.join(root, rel)))) diagnostics.push({ severity: 'error', code: 'missing-file', message: `${rel} is referenced by talk.json but does not exist`, file: rel });
    }
    const seen = new Set<string>();
    for (const ch of spine.chapters) for (const b of ch.beats ?? []) {
      const id = `${ch.id}.${b.id}`;
      if (seen.has(id)) diagnostics.push({ severity: 'error', code: 'duplicate-beat', message: `beat id ${id} appears twice`, beat: id });
      seen.add(id);
    }
    return diagnostics;
  },

  async compile(talk) {
    const t0 = performance.now();
    const diagnostics = await this.validate(talk);
    if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics, ms: Math.round(performance.now() - t0) };
    const res = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(process.execPath, [SPIKE_BUILD, talk.root], { cwd: REPO_ROOT, timeout: 60_000 }, (err, _stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr: String(stderr) });
      });
    });
    if (res.code !== 0) {
      // build.mjs reports the first thrown error on stderr; surface its message line.
      const line = res.stderr.split('\n').find((l) => /Error/.test(l)) ?? res.stderr.trim().split('\n')[0] ?? 'build failed';
      diagnostics.push({ severity: 'error', code: 'build-failed', message: line.trim() });
    }
    return { ok: res.code === 0, diagnostics, ms: Math.round(performance.now() - t0) };
  },
};

// The core the sidecar uses is `sageCore` in sage-core.ts (re-exported from there to avoid an
// import cycle). `stubCore` remains for its loader and as a fallback in tests.
