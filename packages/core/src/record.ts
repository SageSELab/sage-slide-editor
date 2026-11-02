// record.ts — the Node motion recorder. Evaluates a talk's lib and beat scripts in a node:vm
// context against a headless DOM (linkedom, built from layers + scenes) and a stub `Talk`/`B`
// that records every call, its element count, and its end time — the same end-time rules as
// talk-layout.js's instrument (anim: t + stagger·(n−1) + dur when n > 0; tween: t + dur;
// set: t). Nothing animates. Scripts that cannot run headless become diagnostics.
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { diag, type Diagnostic } from './diagnostics.ts';
import { layout, r6, type Layout, type LayoutOptions } from './layout.ts';
import type { LoadedTalk, SourceFile } from './load.ts';

export type CallKind = 'entrance' | 'exit' | 'anim' | 'tween' | 'set';

export interface MotionCall {
  beat: string;
  /** `in`, `out`, `anim`, `show`, `hide`, `words`, `count`, `type`, `draw`, `tween`, `set`; `T.` prefix for B.T. */
  method: string;
  kind: CallKind;
  sel?: string | undefined;
  /** Absolute start and end (end = start when nothing matched). */
  start: number;
  end: number;
  /** Elements matched; null for tween. */
  n: number | null;
  /** Indices into Recording.elements of the elements this call animates. */
  targets: number[];
  /** Number of keyframes for anim-like calls, and whether they set opacity. */
  keyframes?: number | undefined;
  opacity?: boolean | undefined;
  /** For `set`: the keys it steps (`text`, `class`, or style properties). */
  keys?: string[] | undefined;
  /** First frame in a talk script (helper calls point into lib/), and the frame in the motion file. */
  loc?: CallLoc | undefined;
  beatLoc?: CallLoc | undefined;
}
export interface CallLoc { file: string; line: number; col: number }

export interface BeatRecording {
  id: string;
  start: number;
  /** Motion end relative to start (talk-layout.js's `rel`). */
  lastEnd: number;
  registered: boolean;
  calls: MotionCall[];
  /** `B.at` / `B.T` uses (escape hatches), with locations. */
  escapes: { what: 'B.at' | 'B.T'; loc?: CallLoc | undefined }[];
}

export interface RecordedElement {
  id: string | null;
  dataA: boolean;
  tag: string;
  /** Stable address shared with the browser: see elementKey. */
  key: string;
}

/**
 * An element's address that survives differences between the recorder's DOM and a real page
 * (the public build drops private scenes): the nearest ancestor-or-self with an id, then the
 * child-element indices down to the element, e.g. `#rq1/2/0`; `/3/1` from the stage when no
 * ancestor has an id. talk-render.ts computes the same key in the page.
 */
export function elementKey(el: Element, stage: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== stage; e = e.parentElement) {
    const id = e.getAttribute('id');
    if (id) return ['#' + id, ...parts].join('/');
    const p: Element | null = e.parentElement;
    parts.unshift(String(p ? Array.prototype.indexOf.call(p.children, e) : 0));
  }
  return ['', ...parts].join('/');
}

/**
 * Who uses which `Talk.lib` helper: the names each lib file defines, the names each lib file
 * reads while it loads, and the names each beat reads while it runs (directly or through
 * another helper). The public build keeps only the libs its beats need (publish.ts).
 */
export interface LibUsage {
  defines: Map<string, string[]>;
  loadUses: Map<string, Set<string>>;
  beatUses: Map<string, Set<string>>;
}

export interface Recording {
  beats: Map<string, BeatRecording>;
  /** Beat ids registered with Talk.beat, in registration order. */
  registered: string[];
  elements: RecordedElement[];
  lib: LibUsage;
  layout: Layout;
  diagnostics: Diagnostic[];
}

const MAX_STACK = 60;

/** Parse `at … (file:line:col)` frames, keeping those in talk scripts. */
function frames(stack: string | undefined, files: Set<string>): CallLoc[] {
  const out: CallLoc[] = [];
  for (const line of (stack ?? '').split('\n')) {
    const m = /\(?([^\s()]+):(\d+):(\d+)\)?\s*$/.exec(line);
    if (m && files.has(m[1]!)) out.push({ file: m[1]!, line: +m[2]!, col: +m[3]! });
  }
  return out;
}

type AnyObj = Record<string, unknown>;
type Opts = { dur?: number; stagger?: number } & AnyObj;

/**
 * Build the headless page: `.film > .stage` holding layers then every chapter's scene (private
 * ones too: lib scripts may generate DOM into them), plus the public scene for a public cut.
 */
function buildDom(talk: LoadedTalk, withPublic: boolean) {
  const parts: string[] = [];
  if (talk.layers) parts.push(talk.layers.text);
  for (const c of talk.chapters) if (c.scene) parts.push(c.scene.text);
  if (withPublic && talk.publicChapter?.scene) parts.push(talk.publicChapter.scene.text);
  const { window, document } = parseHTML(`<!doctype html><html><head></head><body><div class="film"><div class="stage">${parts.join('\n')}</div></div></body></html>`);
  const proto = (window as unknown as { Element: { prototype: AnyObj } }).Element.prototype;
  proto.getTotalLength ??= () => 1000;
  proto.animate ??= () => ({ pause() {}, play() {}, cancel() {}, finish() {}, currentTime: 0 });
  proto.getBoundingClientRect ??= () => ({ x: 0, y: 0, left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 });
  return { window, document, stage: document.querySelector('.stage') as unknown as Element };
}

/**
 * Record a talk. Runs lib scripts, then motion scripts (registration), then walks the spine
 * running each beat once at its laid-out start — the same single pass the runtime does.
 */
export function recordTalk(talk: LoadedTalk, opts: LayoutOptions = {}): Recording {
  const D: Diagnostic[] = [];
  const spine = talk.spine;
  const beats = new Map<string, BeatRecording>();
  const elements: RecordedElement[] = [];
  const lib: LibUsage = { defines: new Map(), loadUses: new Map(), beatUses: new Map() };
  if (!spine) return { beats, registered: [], elements, lib, diagnostics: D, layout: { beats: [], chapters: [], checkpoints: [], duration: 1, darkWindows: [] } };

  const { window, document, stage } = buildDom(talk, !!opts.public);
  const elIndex = new WeakMap<object, number>();
  const idx = (el: Element) => {
    let i = elIndex.get(el);
    if (i === undefined) {
      i = elements.length;
      elements.push({ id: el.getAttribute('id'), dataA: el.hasAttribute('data-a'), tag: el.tagName.toLowerCase(), key: elementKey(el, stage) });
      elIndex.set(el, i);
    }
    return i;
  };

  const registry = new Map<string, Function>();
  const registered: string[] = [];
  // Talk.lib behind a proxy that notes every helper read against the current reader.
  let reader: Set<string> | null = null;
  const libTarget: AnyObj = {};
  const libProxy = new Proxy(libTarget, {
    get: (o, k) => { if (typeof k === 'string' && reader && k in o) reader.add(k); return Reflect.get(o, k); },
  });
  const TalkStub: AnyObj = {
    lib: libProxy,
    beat: (id: string, fn: Function) => {
      if (registry.has(id)) D.push(diag('beat-registered-twice', 'warning', `Talk.beat('${id}') registered twice; the last one wins`, { beat: id }));
      registry.set(id, fn); registered.push(id);
    },
    ready: () => {},
  };
  const noop = () => {};
  const context = vm.createContext({
    window: undefined as unknown, document, Talk: TalkStub, console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
    location: { search: '', href: 'file:///talk/build/index.html', hash: '' }, URLSearchParams,
    setTimeout: () => 0, clearTimeout: noop, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop,
    getComputedStyle: () => new Proxy({}, { get: () => '' }), performance: { now: () => 0 },
    Element: (window as unknown as AnyObj).Element, HTMLElement: (window as unknown as AnyObj).HTMLElement, Node: (window as unknown as AnyObj).Node,
  });
  context.window = context; context.self = context; context.globalThis = context;

  const scriptFiles = new Set<string>();
  const motionFiles = new Set<string>();
  const run = (f: SourceFile, what: string, isLib = false) => {
    scriptFiles.add(f.path);
    const before = new Set(Object.keys(libTarget));
    if (isLib) { reader = new Set(); lib.loadUses.set(f.path, reader); }
    try {
      new vm.Script(f.text, { filename: f.path }).runInContext(context, { timeout: 2000 });
    } catch (e) {
      const loc = frames((e as Error).stack, new Set([f.path]))[0];
      D.push(diag('record-script-failed', 'warning', `${what} could not run headless: ${(e as Error).message}`, { file: f.path, line: loc?.line, col: loc?.col }));
    }
    reader = null;
    if (isLib) lib.defines.set(f.path, Object.keys(libTarget).filter((k) => !before.has(k)));
  };
  talk.lib.forEach((f) => run(f, 'lib script', true));
  const chapters = opts.public && talk.publicChapter ? [...talk.chapters, talk.publicChapter] : talk.chapters;
  const seenMotion = new Set<string>();
  for (const c of chapters) if (c.motion && !seenMotion.has(c.motion.path)) { seenMotion.add(c.motion.path); motionFiles.add(c.motion.path); run(c.motion, 'motion script'); }

  // ---- the recording B ----
  let cur: BeatRecording | null = null;
  let lastEndAbs = 0;
  const noteEnd = (e: number) => { if (e > lastEndAbs) lastEndAbs = e; };
  const where = () => {
    const prev = Error.stackTraceLimit; Error.stackTraceLimit = MAX_STACK;
    const fs = frames(new Error().stack, scriptFiles);
    Error.stackTraceLimit = prev;
    return { loc: fs[0], beatLoc: fs.find((f) => motionFiles.has(f.file)) };
  };
  const els = (sel: unknown): Element[] => {
    if (typeof sel !== 'string') {
      if (sel && typeof (sel as Element).getAttribute === 'function') return [sel as Element];
      return sel && typeof (sel as Iterable<Element>)[Symbol.iterator] === 'function' ? [...(sel as Iterable<Element>)] : [];
    }
    return [...stage.querySelectorAll(sel)];
  };
  const push = (c: Omit<MotionCall, 'beat' | 'loc' | 'beatLoc'>) => {
    if (!cur) return;
    const w = where();
    cur.calls.push({ ...c, beat: cur.id, loc: w.loc, beatLoc: w.beatLoc });
  };
  const selStr = (sel: unknown) => (typeof sel === 'string' ? sel : undefined);
  const kfInfo = (kf: unknown) => {
    const list = Array.isArray(kf) ? (kf as AnyObj[]) : [];
    return { keyframes: list.length, opacity: list.some((k) => k && 'opacity' in k) };
  };
  // Absolute-time primitives, mirroring talk.js + the talk-layout.js instrument.
  const P = {
    anim(sel: unknown, t: number, dur: number, kf: unknown, o: Opts = {}, method = 'anim', kind: CallKind = 'anim') {
      const list = els(sel), n = list.length;
      const end = n ? t + (o.stagger || 0) * (n - 1) + dur : t;
      if (n) noteEnd(end);
      push({ method, kind, sel: selStr(sel), start: t, end, n, targets: list.map(idx), ...kfInfo(kf) });
    },
    tween(t: number, dur: number, method = 'tween', sel?: unknown, n: number | null = null, targets: number[] = []) {
      noteEnd(t + dur);
      push({ method, kind: 'tween', sel: selStr(sel), start: t, end: t + dur, n, targets });
    },
    perEl(sel: unknown, t: number, dur: number, method: string) {
      const list = els(sel);
      if (list.length) noteEnd(t + dur);
      push({ method, kind: method === 'draw' ? 'anim' : 'tween', sel: selStr(sel), start: t, end: list.length ? t + dur : t, n: list.length, targets: list.map(idx) });
    },
  };
  const ENTER_KF = [{ opacity: 0 }, { opacity: 1 }];
  const api = (a: (t: number) => number, prefix: string) => ({
    els: (sel: unknown) => els(sel),
    in: (sel: unknown, t: number, o: Opts = {}) => P.anim(sel, a(t), o.dur === undefined ? 1 : o.dur, ENTER_KF, { stagger: o.stagger ?? 0 }, prefix + 'in', 'entrance'),
    out: (sel: unknown, t: number, o: Opts = {}) => P.anim(sel, a(t), o.dur === undefined ? 0.6 : o.dur, [{ opacity: 0 }], { stagger: o.stagger ?? 0 }, prefix + 'out', 'exit'),
    anim: (sel: unknown, t: number, dur: number, kf: unknown, o: Opts = {}) => P.anim(sel, a(t), dur, kf, o, prefix + 'anim'),
    show: (sel: unknown, t: number) => P.anim(sel, a(t), 0.01, ENTER_KF, {}, prefix + 'show', 'entrance'),
    hide: (sel: unknown, t: number) => P.anim(sel, a(t), 0.01, [{ opacity: 0 }, { opacity: 0 }], {}, prefix + 'hide', 'exit'),
    words: (sel: unknown, t: number, o: Opts = {}) => {
      const s = a(t);
      P.anim(sel, s, 0.01, ENTER_KF, {}, prefix + 'words', 'entrance');
      P.anim(`${String(sel)} .w`, s, o.dur === undefined ? 0.9 : o.dur, ENTER_KF, { stagger: o.stagger === undefined ? 0.09 : o.stagger }, prefix + 'words', 'entrance');
    },
    count: (sel: unknown, t: number, dur: number) => P.perEl(sel, a(t), dur, prefix + 'count'),
    type: (sel: unknown, t: number, dur: number) => P.perEl(sel, a(t), dur, prefix + 'type'),
    draw: (sel: unknown, t: number, dur: number) => P.perEl(sel, a(t), dur, prefix + 'draw'),
    tween: (t: number, dur: number) => P.tween(a(t), dur, prefix + 'tween'),
  });

  const makeB = (start: number) => {
    const rel = api((t) => r6(start + t), '');
    const T = { ...api((t) => t, 'T.'), set: noop, t: 0 };
    const B: AnyObj = {
      ...rel,
      lib: TalkStub.lib,
      set: (sel: unknown, t: number, v?: unknown) => {
        const s = r6(start + t), list = els(sel);
        noteEnd(s);
        const keys = v && typeof v === 'object' ? Object.entries(v as AnyObj).flatMap(([k, x]) => (k === 'style' && x && typeof x === 'object' ? Object.keys(x as AnyObj) : [k])) : [];
        push({ method: 'set', kind: 'set', sel: selStr(sel), start: s, end: s, n: list.length, targets: list.map(idx), keys });
      },
    };
    Object.defineProperty(B, 'at', { enumerable: true, get: () => { cur?.escapes.push({ what: 'B.at', loc: where().loc }); return start; } });
    Object.defineProperty(B, 'T', { enumerable: true, get: () => { cur?.escapes.push({ what: 'B.T', loc: where().loc }); return T; } });
    return B;
  };

  const lay = layout(spine, (id, start) => {
    const fn = registry.get(id);
    const rec: BeatRecording = { id, start, lastEnd: 0, registered: !!fn, calls: [], escapes: [] };
    beats.set(id, rec);
    cur = rec; lastEndAbs = start;
    reader = new Set(); lib.beatUses.set(id, reader);
    if (fn) {
      try { fn(makeB(start)); } catch (e) {
        const loc = frames((e as Error).stack, scriptFiles)[0];
        D.push(diag('record-beat-failed', 'warning', `beat ${id} could not run headless: ${(e as Error).message}`, { file: loc?.file, line: loc?.line, col: loc?.col, beat: id }));
      }
    }
    cur = null; reader = null;
    rec.lastEnd = r6(lastEndAbs - start);
    return rec.lastEnd;
  }, opts);
  return { beats, registered, elements, lib, layout: lay, diagnostics: D };
}

/** Relative lastEnd per beat, the input layout() takes. */
export const lastEnds = (r: Recording): Record<string, number> =>
  Object.fromEntries([...r.beats.values()].map((b) => [b.id, b.lastEnd]));
