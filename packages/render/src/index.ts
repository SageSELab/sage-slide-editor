// @sage/render — deterministic frames of a compiled talk film in headless Chromium.
//
// The renderer behind `talkc shoot`, `talkc validate --render`, and (later) the sidecar's
// talk_frame tool and the PNG/PDF exports (PLAN 4; Phase 0 chose Chromium over WebKit's
// takeSnapshot because the latter flattens 3D transforms).
//
// One long-lived browser (a Renderer); one page per open film, reused for every frame. A film
// is loaded once as `index.html?capture` (controls hidden, no autoplay); each frame is
// `T.seek(t)`, then `document.fonts.ready` and two requestAnimationFrame ticks, then a
// 1920x1080 screenshot at deviceScaleFactor 1. Phase 0 showed seek is pixel-identical to a
// fresh `?t=T&capture` load (the golden harness's method) and 4-5x faster; the render tests
// check it byte for byte against tests/golden/shoot.mjs.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface RendererOptions {
  /** Viewport, default 1920x1080 (the stage size). */
  width?: number;
  height?: number;
  /**
   * Block every request that is not file:, data: or blob: (default true): a frame must never
   * depend on the network. Blocked and failed requests are listed by Film.requests().
   */
  offline?: boolean;
}

export interface OpenOptions extends RendererOptions {
  /** Share a long-lived browser; without one the film launches its own and closes it on close(). */
  renderer?: Renderer;
  /** Extra query parameters. */
  query?: Record<string, string>;
  /**
   * Load with ?capture (default true: controls hidden, no autoplay, the deterministic path).
   * false loads the film as a viewer sees it, for behaviour tests.
   */
  capture?: boolean;
}

export interface RequestRecord { url: string; ok: boolean; blocked: boolean; failure?: string }

export interface Hold {
  /** 1-based hold number, as in `?cplist` and `?cp=N`. */
  index: number;
  at: number;
  label: string;
  backup: boolean;
  /** `chapter.beat` for sage-talk/1 films; absent for legacy decks. */
  id?: string;
}

export interface FrameOptions {
  /** Also write the PNG here. */
  path?: string;
}

export interface Film {
  readonly htmlPath: string;
  readonly url: string;
  /** Film duration (T.duration), read at load. */
  readonly duration: number;
  /** The checkpoints (T.cps), read at load. */
  holds(): Hold[];
  /** Seek to t (clamped to [0, duration] by the engine) and return the frame as PNG bytes. */
  frame(t: number, opts?: FrameOptions): Promise<Buffer>;
  /** Seek to t and settle without a screenshot (for probes that read the DOM). */
  seek(t: number): Promise<void>;
  /** Run a function in the page (after a seek, it sees the frame at that time). */
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  /** Uncaught page errors since load (cleared by reload). */
  errors(): string[];
  /** Every request since load except data: URLs, with whether it failed or was blocked. */
  requests(): RequestRecord[];
  /** Reload the film (after a rebuild); holds and duration are re-read. */
  reload(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Which Chromium to launch. Default: Playwright's own build (the golden frames are pinned to it).
 * The packaged app's sidecar points this elsewhere through the environment (docs/packaging.md):
 * `SAGE_RENDER_CHANNEL=chrome` uses an installed Google Chrome, `SAGE_RENDER_EXECUTABLE` a
 * browser binary by path; with neither, Playwright looks in `PLAYWRIGHT_BROWSERS_PATH`.
 */
export function browserLaunchOptions(env: NodeJS.ProcessEnv = process.env): { channel?: string; executablePath?: string } {
  if (env.SAGE_RENDER_EXECUTABLE) return { executablePath: env.SAGE_RENDER_EXECUTABLE };
  if (env.SAGE_RENDER_CHANNEL) return { channel: env.SAGE_RENDER_CHANNEL };
  return {};
}

/** A long-lived headless Chromium. Open many films; close once. */
export class Renderer {
  readonly browser: Browser;
  readonly opts: Required<RendererOptions>;
  private readonly ctx: BrowserContext;
  private constructor(browser: Browser, ctx: BrowserContext, opts: Required<RendererOptions>) { this.browser = browser; this.ctx = ctx; this.opts = opts; }

  static async launch(opts: RendererOptions = {}): Promise<Renderer> {
    const o = { width: opts.width ?? 1920, height: opts.height ?? 1080, offline: opts.offline ?? true };
    const browser = await chromium.launch(browserLaunchOptions());
    const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
    if (o.offline) await ctx.route(/^(?!file:|data:|blob:)/, (route) => route.abort('blockedbyclient'));
    return new Renderer(browser, ctx, o);
  }

  get version(): string { return `chromium ${this.browser.version()}`; }

  async openFilm(htmlPath: string, opts: Omit<OpenOptions, 'renderer'> = {}): Promise<Film> {
    const page = await this.ctx.newPage();
    if (opts.width || opts.height) await page.setViewportSize({ width: opts.width ?? this.opts.width, height: opts.height ?? this.opts.height });
    const film = new PageFilm(page, path.resolve(htmlPath), opts.query ?? {}, opts.capture ?? true);
    try { await film.load(); } catch (e) { await page.close(); throw e; }
    return film;
  }

  async close(): Promise<void> { await this.browser.close(); }
}

export const filmUrl = (htmlPath: string, query: Record<string, string> = {}, capture = true): string => {
  const q = [capture ? 'capture' : '', new URLSearchParams(query).toString()].filter(Boolean).join('&');
  return pathToFileURL(path.resolve(htmlPath)).href + (q ? '?' + q : '');
};

class PageFilm implements Film {
  readonly url: string;
  duration = 0;
  private cps: Hold[] = [];
  private errs: string[] = [];
  private reqs: RequestRecord[] = [];
  onClose: (() => Promise<void>) | null = null;

  readonly htmlPath: string;
  private readonly page: Page;
  constructor(page: Page, htmlPath: string, query: Record<string, string>, capture: boolean) {
    this.page = page; this.htmlPath = htmlPath;
    this.url = filmUrl(htmlPath, query, capture);
    page.on('pageerror', (e) => this.errs.push(String(e)));
    page.on('requestfailed', (r) => {
      if (r.url().startsWith('data:')) return;
      const failure = r.failure()?.errorText ?? 'failed';
      this.reqs.push({ url: r.url(), ok: false, blocked: /blockedbyclient|BLOCKED_BY_CLIENT/i.test(failure), failure });
    });
    page.on('requestfinished', (r) => { if (!r.url().startsWith('data:')) this.reqs.push({ url: r.url(), ok: true, blocked: false }); });
  }

  async load(): Promise<void> {
    if (!fs.existsSync(this.htmlPath)) throw new Error(`no such film: ${this.htmlPath}`);
    this.errs = []; this.reqs = [];
    await this.page.goto(this.url, { waitUntil: 'load' });
    const info = await this.page.evaluate(() => {
      const T = (window as unknown as { T?: { cps: { at: number; label: string; backup?: boolean; id?: string }[]; duration: number } }).T;
      if (!T) return null;
      return { duration: T.duration, cps: T.cps.map((c) => ({ at: c.at, label: c.label, backup: !!c.backup, ...(c.id ? { id: c.id } : {}) })) };
    });
    if (!info) throw new Error(`${this.htmlPath}: no window.T after load${this.errs.length ? ' (' + this.errs[0] + ')' : ''}`);
    this.duration = info.duration;
    this.cps = info.cps.map((c, i) => ({ index: i + 1, ...c }));
    await this.settle();
  }

  holds(): Hold[] { return this.cps.map((c) => ({ ...c })); }
  errors(): string[] { return [...this.errs]; }
  requests(): RequestRecord[] { return this.reqs.map((r) => ({ ...r })); }

  private async settle(): Promise<void> {
    await this.page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }

  async seek(t: number): Promise<void> {
    if (!Number.isFinite(t)) throw new Error(`bad time ${t}`);
    await this.page.evaluate((t) => (window as unknown as { T: { seek(t: number): void } }).T.seek(t), t);
    await this.settle();
  }

  async frame(t: number, opts: FrameOptions = {}): Promise<Buffer> {
    await this.seek(t);
    const png = await this.page.screenshot(opts.path ? { path: opts.path } : {});
    return png;
  }

  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> {
    return (this.page.evaluate as (f: unknown, a: unknown) => Promise<R>)(fn, arg);
  }

  reload(): Promise<void> { return this.load(); }

  async close(): Promise<void> {
    await this.page.close();
    await this.onClose?.();
  }
}

/**
 * Open a film. With `opts.renderer` the page lives in that browser; otherwise a private
 * browser is launched and closed with the film.
 */
export async function openFilm(htmlPath: string, opts: OpenOptions = {}): Promise<Film> {
  const { renderer, ...rest } = opts;
  if (renderer) return renderer.openFilm(htmlPath, rest);
  const own = await Renderer.launch(rest);
  try {
    const film = (await own.openFilm(htmlPath)) as PageFilm;
    film.onClose = () => own.close();
    return film;
  } catch (e) { await own.close(); throw e; }
}

/** `t0012.500.png`: the golden harness's frame name, so folders line up by name. */
export const frameName = (t: number): string => 't' + t.toFixed(3).padStart(8, '0') + '.png';

export interface FramePlan { file: string; t: number; kind: 'hold' | 'before' | 'after' | 'time' | 'beat'; hold?: number; label?: string; backup?: boolean; beat?: string }

/**
 * Which frames to shoot (the golden harness's planFrames): every hold (optionally ±around),
 * plus explicit times; deduplicated by name, times rounded to ms and clamped to the film.
 */
export function planFrames(holds: Hold[], duration: number, o: { holds?: boolean; around?: number; times?: number[]; beats?: string[]; backups?: boolean }): FramePlan[] {
  const frames = new Map<string, FramePlan>();
  const add = (t: number, info: Omit<FramePlan, 'file' | 't'>) => {
    t = Math.round(Math.max(0, Math.min(duration, t)) * 1000) / 1000;
    const file = frameName(t);
    if (!frames.has(file)) frames.set(file, { file, t, ...info });
  };
  if (o.holds) for (const c of holds) {
    if (c.backup && o.backups === false) continue;
    const info = { hold: c.index, label: c.label, backup: c.backup };
    add(c.at, { kind: 'hold', ...info });
    if (o.around) {
      add(c.at - o.around, { kind: 'before', ...info });
      add(c.at + o.around, { kind: 'after', ...info });
    }
  }
  for (const b of o.beats ?? []) {
    const c = holds.find((h) => h.id === b);
    if (!c) throw new Error(`no beat "${b}" in the film (ids are chapter.beat)`);
    add(c.at, { kind: 'beat', hold: c.index, label: c.label, backup: c.backup, beat: b });
  }
  for (const t of o.times ?? []) add(t, { kind: 'time' });
  return [...frames.values()].sort((a, b) => a.t - b.t);
}

export interface ShootOptions extends OpenOptions {
  holds?: boolean;
  around?: number;
  times?: number[];
  beats?: string[];
  backups?: boolean;
  /** Called after each frame is written. */
  onFrame?: (f: FramePlan, i: number, n: number) => void;
}

export interface ShootResult { outDir: string; frames: (FramePlan & { errors?: string[] })[]; duration: number; version: string }

/** Shoot a plan of frames into outDir: one PNG per frame plus manifest.json, as tests/golden. */
export async function shootFilm(htmlPath: string, outDir: string, o: ShootOptions): Promise<ShootResult> {
  const renderer = o.renderer ?? await Renderer.launch(o);
  try {
    const film = await renderer.openFilm(htmlPath, o.query ? { query: o.query } : {});
    try {
      const frames: ShootResult['frames'] = planFrames(film.holds(), film.duration, o);
      fs.mkdirSync(outDir, { recursive: true });
      let seen = film.errors().length;
      for (const [i, f] of frames.entries()) {
        await film.frame(f.t, { path: path.join(outDir, f.file) });
        const errs = film.errors();
        if (errs.length > seen) { f.errors = errs.slice(seen); seen = errs.length; }
        o.onFrame?.(f, i, frames.length);
      }
      const manifest = { html: path.resolve(htmlPath), engine: 'chromium', version: renderer.version, width: renderer.opts.width, height: renderer.opts.height, duration: film.duration, method: 'seek', shotAt: new Date().toISOString(), frames };
      fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      return { outDir, frames, duration: film.duration, version: renderer.version };
    } finally { await film.close(); }
  } finally { if (!o.renderer) await renderer.close(); }
}
