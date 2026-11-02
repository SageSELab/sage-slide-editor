// publish.ts — talk folder -> one self-contained public HTML file (PLAN 4: `talkc publish`).
// The TypeScript port of the skill's build-public.py, driven by the spine instead of
// <!-- private:start --> / public:start comment markers:
//
//   cut       chapters with `private: true` (the dark passage, the backups) are dropped with
//             their scene and motion files; the spine's `public` block (end card) is appended
//             with its scene and motion; duration uses `public.tail`. Lib files whose
//             Talk.lib helpers only dropped beats use are dropped too (found by the recorder);
//             libs that define no helper are kept.
//   private   speaker notes are removed from the inlined spine, as are `materials` (local paths)
//             and the `public` block itself.
//   editor    edit.js is not shipped. With text overrides (opts.overrides) a tiny id-keyed
//             applier stands in for it; without, there is no overrides block at all.
//   engine    talk.js: CSS zoom fit (iOS-safe), no presenter (N) or clock (T) keys, the title
//             build autoplays to the first hold (not under ?capture), the first keypress hides
//             the hint. talk-layout.js: no editor hooks, no ?hide debug parameter.
//   page      a hint pill, the slide counter hidden, controls visible while holding, end-card
//             button styles, robots noindex and a description meta.
//   inline    talk.css, the theme, talk.js, talk-layout.js, every lib and motion script, the
//             font and every assets/ file referenced as src="…" or url(…) become one file.
// Every engine patch must apply; if talk.js or talk-layout.js drift, publish fails loudly
// (build-public.py skipped a pattern that no longer matched without a word).
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ENGINE_DIR } from './compile.ts';
import { checkScript } from './compile.ts';
import { diag, type Diagnostic } from './diagnostics.ts';
import { loadTalk, type ChapterSources, type LoadedTalk, type SourceFile } from './load.ts';
import { recordTalk, type Recording } from './record.ts';

export interface PublishOptions {
  /** File name without .html; default `talk` (as build-public.py). */
  slug?: string;
  /** Output folder; default `<talk>/build/public`. */
  outDir?: string;
  /** Folder holding talk.js, talk.css, talk-layout.js; default packages/engine/src. */
  engineDir?: string;
  /** Text overrides keyed by element id (inner HTML); applied by a tiny applier. */
  overrides?: { text?: Record<string, string> };
}

export interface PublishCut {
  scenes: string[];
  motion: string[];
  libs: string[];
  /** Lib files left out because only private beats use their helpers. */
  droppedLibs: string[];
}

export interface PublishResult {
  ok: boolean;
  outFile: string | null;
  bytes: number;
  diagnostics: Diagnostic[];
  cut: PublishCut | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
const trimEnd = (s: string) => s.replace(/\s+$/, '');
/** `</script` inside an inlined script would end the element early. */
const scriptSafe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1');

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf',
};

// ---- the web variant of the engine (build-public.py's replacements, verbatim) ----

const FIT_OLD = `    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      this.stage.style.transform = \`translate(-50%,-50%) scale(\${s})\`;
    }`;
const FIT_NEW = `    // CSS zoom, not transform: scale, so composited layers shrink with the
    // displayed size (a scale transform rasterizes every layer at 1920×1080 and
    // iOS Safari kills the tab).
    fit() {
      const r = this.root.getBoundingClientRect();
      const s = Math.min(r.width / 1920, r.height / 1080);
      const ZOOM = typeof CSS !== 'undefined' && CSS.supports('zoom', '0.5');
      const IOS = /Apple/.test(navigator.vendor) && navigator.maxTouchPoints > 1;
      if (ZOOM) {
        this.stage.style.transform = 'none';
        this.stage.style.zoom = s;
        if (IOS) this.stage.style.webkitTextSizeAdjust = s * 100 + '%';
        this.stage.style.left = (r.width - 1920 * s) / 2 / s + 'px';
        this.stage.style.top = (r.height - 1080 * s) / 2 / s + 'px';
      } else {
        this.stage.style.left = '50%'; this.stage.style.top = '50%';
        this.stage.style.transform = \`translate(-50%,-50%) scale(\${s})\`;
      }
    }`;

/** [what, old, new]; each must match exactly once. */
export const TALK_JS_PATCHES: [string, string, string][] = [
  ['CSS zoom fit', FIT_OLD, FIT_NEW],
  ['presenter key', "        else if (k === 'n' || k === 'N') this.openPresenter();\n", ''],
  ['clock key', "        else if (k === 't' || k === 'T') { this.started = Date.now(); this.sync?.(); }\n", ''],
  ['title autoplay',
    "      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);",
    "      if (q.has('t')) return this.render(parseFloat(q.get('t')));\n      this.render(0);\n      if (!q.has('capture')) this.play(this.cps[0]?.at ?? null);"],
  ['hint dismissal',
    '    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); }\n    }',
    "    markStart() {\n      if (!this.started) { this.started = Date.now(); this.sync?.(); document.querySelector('.hint')?.classList.add('gone'); }\n    }"],
];

export const LAYOUT_JS_PATCHES: [string, string, string][] = [
  ['editor hooks',
    "    if (ED) { ED.apply(); ED.applyNotes(); T.editor = ED; window.ED = ED; if (q.has('edit')) setTimeout(() => ED.enter(), 50); }",
    '    if (ED) ED.apply();'],
  ['?hide debug parameter',
    "    if (q.has('hide')) q.get('hide').split(',').forEach((s) => document.querySelectorAll(s).forEach((e) => (e.style.display = 'none')));\n",
    ''],
];

/** The overrides applier that replaces edit.js when there are overrides (keyed by id, PLAN 3.1). */
const OVERRIDES_JS = `(function () {
  class TalkEdit {
    constructor() { this.o = { text: {} };
      try { this.o = Object.assign({ text: {} }, JSON.parse(document.getElementById('text-overrides').textContent || '{}')); } catch (e) {} }
    apply() { for (const [id, html] of Object.entries(this.o.text)) { const el = document.getElementById(id); if (el && el.innerHTML !== html) el.innerHTML = html; } }
  }
  window.TalkEdit = TalkEdit;
})();`;

export const PUBLIC_CSS = `
.film:not(.is-playing) .film-ui { opacity: 1; }
.film-ui { padding-bottom: 14px; }
.endbtn { display: inline-block; padding: 16px 34px; border-radius: 999px; background: var(--ink); color: #fff; font: 700 26px var(--display); text-decoration: none; }
.endbtn.ghost { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 2px var(--line); }
.endbtn:hover { background: var(--a1); color: #fff; box-shadow: none; }
.hint { position: fixed; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 20; padding: 12px 22px; border-radius: 999px; background: rgba(20,20,22,.88); color: #f5f5f7; font: 600 15px var(--text); letter-spacing: .02em; transition: opacity .5s; pointer-events: none; backdrop-filter: blur(8px); }
.hint.gone { opacity: 0; }
#slideno { display: none; }
@media (max-width: 900px) { .hint { font-size: 12px; padding: 9px 14px; bottom: 52px; white-space: nowrap; } }
`;

export const HINT = '<div class="hint">Press space or tap to play to the next stop · ← back · F fullscreen</div>';

function patch(text: string, patches: [string, string, string][], file: string, D: Diagnostic[]): string {
  for (const [what, a, b] of patches) {
    const n = text.split(a).length - 1;
    if (n !== 1) { D.push(diag('publish-engine-patch', 'error', `${file}: the ${what} patch matched ${n} times (expected once); the engine changed`, { file })); continue; }
    text = text.replace(a, () => b);
  }
  return text;
}

/** The spine the public page boots from: private chapters out, public block in, no notes. */
export function publicSpine(raw: unknown): Record<string, unknown> {
  const r = structuredClone(raw) as Record<string, unknown> & { chapters?: Record<string, unknown>[]; public?: Record<string, unknown>; defaults?: Record<string, unknown> };
  const noNotes = (beats: unknown) => (Array.isArray(beats) ? beats.map((b) => { const { notes: _n, ...rest } = b as Record<string, unknown>; return rest; }) : []);
  const chapters: Record<string, unknown>[] = (r.chapters ?? []).filter((c) => !c.private).map((c) => ({ ...c, beats: noNotes(c.beats) }));
  const p = r.public;
  if (p) {
    const { tail: _t, beats, id, label, ...rest } = p;
    chapters.push({ id: id ?? 'public', label: label ?? 'Public', ...rest, beats: noNotes(beats) });
  }
  const out: Record<string, unknown> = { ...r, chapters };
  delete out.public; delete out.materials;
  if (p && typeof p.tail === 'number') out.defaults = { ...(r.defaults ?? {}), tail: p.tail };
  return out;
}

/** Which scene, motion and lib files the public page carries. */
export function publicCut(talk: LoadedTalk, rec: Recording): PublishCut {
  const spine = talk.spine!;
  const keep: ChapterSources[] = talk.chapters.filter((_, i) => !spine.chapters[i]!.private);
  if (talk.publicChapter) keep.push(talk.publicChapter);
  const uniq = (xs: (SourceFile | null)[]) => [...new Set(xs.filter((x): x is SourceFile => !!x).map((x) => x.path))];
  // Libs: keep the ones defining a helper the public beats read (transitively through helpers
  // read while a kept lib loads), and every lib that defines none (side effects, ready hooks).
  const used = new Set<string>();
  for (const s of rec.lib.beatUses.values()) s.forEach((n) => used.add(n));
  const libs = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of talk.lib) {
      if (libs.has(f.path)) continue;
      const defs = rec.lib.defines.get(f.path) ?? [];
      if (defs.length && !defs.some((n) => used.has(n))) continue;
      libs.add(f.path); grew = true;
      rec.lib.loadUses.get(f.path)?.forEach((n) => used.add(n));
    }
  }
  return {
    scenes: uniq([talk.layers, ...keep.map((c) => c.scene)]),
    motion: uniq(keep.map((c) => c.motion)),
    libs: talk.lib.map((f) => f.path).filter((p) => libs.has(p)),
    droppedLibs: talk.lib.map((f) => f.path).filter((p) => !libs.has(p)),
  };
}

/**
 * Strings that must not ship: the labels of private chapters and their beats (one-word labels
 * such as "Backup" or "But" are too generic to search for), and the opening of every speaker
 * note in the talk.
 */
export function privateNeedles(talk: LoadedTalk): { what: string; text: string }[] {
  const out = new Map<string, string>();
  const label = (s: string, what: string) => { const t = s.trim(); if (/\s/.test(t) && t.length >= 8) out.set(t, what); };
  for (const ch of talk.spine?.chapters ?? []) {
    if (ch.private) { label(ch.label, 'private chapter label'); for (const b of ch.beats) label(b.label, 'private beat label'); }
    for (const b of ch.beats) { const n = b.notes?.trim() ?? ''; if (n.length >= 24) out.set(n.slice(0, 40), 'speaker note'); }
  }
  for (const b of talk.spine?.public?.beats ?? []) { const n = b.notes?.trim() ?? ''; if (n.length >= 24) out.set(n.slice(0, 40), 'speaker note'); }
  return [...out].map(([text, what]) => ({ what, text }));
}

/** Render the public page (no writes). */
export function renderPublic(talk: LoadedTalk, opts: PublishOptions = {}): { html: string | null; diagnostics: Diagnostic[]; cut: PublishCut | null } {
  const D: Diagnostic[] = talk.diagnostics.filter((d) => d.severity === 'error');
  const spine = talk.spine;
  if (!spine || D.length) return { html: null, diagnostics: D, cut: null };
  const engine = opts.engineDir ?? DEFAULT_ENGINE_DIR;
  const readEngine = (f: string) => { try { return fs.readFileSync(path.join(engine, f), 'utf8'); } catch { D.push(diag('file-missing', 'error', `engine file not found: ${path.join(engine, f)}`, {})); return ''; } };
  const rec = recordTalk(talk, { public: true });
  const cut = publicCut(talk, rec);
  const text = (p: string) => talk.host.read(p) ?? '';
  const scripts: SourceFile[] = [...cut.libs, ...cut.motion].map((p) => ({ path: p, text: text(p) }));
  for (const s of scripts) { const d = checkScript(s); if (d) D.push(d); }

  // ---- data URIs ----
  const uriCache = new Map<string, string | null>();
  const dataUri = (ref: string, from: string): string | null => {
    const rel = path.posix.normalize(decodeURI(ref.split(/[?#]/)[0]!));
    if (uriCache.has(rel)) return uriCache.get(rel)!;
    const cands = talk.dir ? [path.join(talk.dir, rel), path.join(engine, rel), path.join(engine, path.basename(rel))] : [];
    const file = cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    let uri: string | null = null;
    if (file) uri = `data:${MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;
    else D.push(diag('asset-missing', 'error', `missing asset: ${ref} (referenced from ${from})`, { file: from }));
    uriCache.set(rel, uri);
    return uri;
  };
  const inlineHtml = (s: string, from: string) => s
    .replace(/\b(src|href|poster)=(["'])(assets\/[^"']+)\2/g, (m, attr: string, q: string, ref: string) => { const u = dataUri(ref, from); return u ? `${attr}=${q}${u}${q}` : m; })
    .replace(/url\((["']?)(assets\/[^"')]+)\1\)/g, (m, q: string, ref: string) => { const u = dataUri(ref, from); return u ? `url(${q || '"'}${u}${q || '"'})` : m; });
  const inlineCss = (s: string, from: string) => inlineHtml(s, from);

  // ---- engine ----
  const css = inlineCss(readEngine('talk.css'), 'talk.css') + PUBLIC_CSS;
  const talkJs = patch(readEngine('talk.js'), TALK_JS_PATCHES, 'talk.js', D);
  const layoutJs = patch(readEngine('talk-layout.js'), LAYOUT_JS_PATCHES, 'talk-layout.js', D);
  if (D.some((d) => d.severity === 'error')) return { html: null, diagnostics: D, cut };

  const scenes = cut.scenes.map((p) => `<!-- ${p} -->\n${inlineHtml(text(p), p)}`);
  const theme = talk.theme ? inlineCss(talk.theme.text, talk.theme.path) : '';
  const overrides = Object.keys(opts.overrides?.text ?? {}).length ? { text: opts.overrides!.text! } : null;
  const script = (f: SourceFile) => `<script>\n${scriptSafe(inlineHtml(trimEnd(f.text), f.path))}\n//# sourceURL=${f.path}\n</script>`;
  const spineJson = JSON.stringify(publicSpine(talk.raw)).replace(/</g, '\\u003c');
  const title = `${esc(spine.title)}${spine.venue ? ' — ' + esc(spine.venue) : ''}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- generated by talkc publish; do not edit -->
<meta name="robots" content="noindex">
<meta name="description" content="Talk slides: ${escAttr(spine.title)}. Press space or tap to advance.">
<style>
${trimEnd(css)}
</style>
<style>
${trimEnd(theme)}
</style>
</head>
<body>
<div class="film">
${HINT}
<div class="stage">

${scenes.map(trimEnd).join('\n\n')}

</div>
</div>
${overrides ? `
<script type="application/json" id="text-overrides">
${JSON.stringify(overrides).replace(/</g, '\\u003c')}
</script>` : ''}
<script type="application/json" id="talk-spine">
${spineJson}
</script>
<script>
${scriptSafe(trimEnd(talkJs))}
</script>
${overrides ? `<script>\n${OVERRIDES_JS}\n</script>\n` : ''}<script>
${scriptSafe(trimEnd(layoutJs))}
</script>
${scripts.map(script).join('\n')}
<script>Talk.boot();</script>
</body>
</html>
`;
  // A safety net for what the cut cannot see: private labels or any speaker notes written into
  // talk files that do ship (a comment in a lib, a public scene).
  const shipped: SourceFile[] = [...cut.scenes.map((p) => ({ path: p, text: text(p) })), ...(talk.theme ? [talk.theme] : []), ...scripts];
  for (const needle of privateNeedles(talk)) for (const f of shipped) {
    const at = f.text.indexOf(needle.text);
    if (at >= 0) D.push(diag('publish-private-text', 'warning', `${needle.what} "${needle.text}" appears in a file the public build ships`, { file: f.path, text: f.text, offset: at }));
  }
  // Anything still pointing into assets/ would break a file opened on its own.
  const left = D.some((d) => d.severity === 'error') ? null : /(?:\b(?:src|href|poster)=["']|url\(["']?|["'`])assets\//.exec(html);
  if (left) D.push(diag('publish-unresolved-asset', 'error', `an assets/ reference could not be inlined: …${html.slice(left.index, left.index + 80)}…`, {}));
  return D.some((d) => d.severity === 'error') ? { html: null, diagnostics: D, cut } : { html, diagnostics: D, cut };
}

/** Publish a talk folder: write `<outDir>/<slug>.html`. */
export function publishTalk(dir: string, opts: PublishOptions = {}): PublishResult {
  const talk = loadTalk(dir);
  const { html, diagnostics, cut } = renderPublic(talk, opts);
  if (html === null) return { ok: false, outFile: null, bytes: 0, diagnostics, cut };
  const out = path.resolve(opts.outDir ?? path.join(dir, 'build', 'public'));
  fs.mkdirSync(out, { recursive: true });
  const outFile = path.join(out, `${opts.slug ?? 'talk'}.html`);
  fs.writeFileSync(outFile, html);
  return { ok: true, outFile, bytes: Buffer.byteLength(html), diagnostics, cut };
}
