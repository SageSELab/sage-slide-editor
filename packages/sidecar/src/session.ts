// session.ts — the open talk: method implementations, build serialization, watcher wiring.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NotATalkError, type CorePort, type LoadedTalk } from './core-port.ts';
import { sageCore as defaultCore } from './sage-core.ts';
import {
  ErrorCode, RpcError,
  type BuildResult, type BuildTrigger, type BuiltParams, type ChangedParams, type LayoutResult, type OpenParams,
  type OpenResult, type TalkKind,
} from './protocol.ts';
import type { Log } from './rpc.ts';
import { TalkWatcher, atomicAppWrite, type WatchBatch } from './watcher.ts';

export interface SessionEvents {
  changed: (p: ChangedParams) => void;
  built: (p: BuiltParams) => void;
}

interface OpenTalk { root: string; kind: TalkKind; watcher: TalkWatcher | null }

export class Session {
  private talk: OpenTalk | null = null;
  private buildChain: Promise<unknown> = Promise.resolve();
  private changeBuildQueued = false;

  constructor(
    private events: SessionEvents,
    private core: CorePort = defaultCore,
    private log: Log = () => {},
    private debounceMs = Number(process.env.SAGE_WATCH_DEBOUNCE_MS ?? 150),
  ) {}

  get root() { return this.talk?.root ?? null; }

  async open({ path: p, watch = true }: OpenParams): Promise<OpenResult> {
    if (!path.isAbsolute(p)) throw new RpcError(ErrorCode.InvalidParams, 'params.path must be absolute');
    await this.close();
    let root: string;
    try { root = fs.realpathSync(p); } catch { throw new RpcError(ErrorCode.NotATalk, `${p} does not exist`); }
    const has = (f: string) => fs.existsSync(path.join(root, f));
    let kind: TalkKind;
    if (has('talk.json')) kind = 'beatFormat';
    else if (has('index.html') && has('talk.js')) kind = 'legacy';
    else throw new RpcError(ErrorCode.NotATalk, `${root} is not a talk folder (expected talk.json, or index.html with talk.js)`);

    this.talk = { root, kind, watcher: null };
    const result: OpenResult = { kind, root, filmURL: pathToFileURL(path.join(root, kind === 'legacy' ? 'index.html' : 'build/index.html')).href };
    if (kind === 'beatFormat') {
      const loaded = await this.load(); // NotATalk if talk.json is unusable
      const built = await this.enqueueBuild('open');
      result.build = { ok: built.ok, diagnostics: built.diagnostics, ms: built.ms };
      result.holds = built.holds ?? (await this.core.layout(loaded)).holds;
    }
    if (watch) this.setWatching(true);
    this.log('info', `opened ${kind} talk ${root}`);
    return result;
  }

  async close() {
    if (!this.talk) return;
    this.talk.watcher?.stop();
    this.log('info', `closed ${this.talk.root}`);
    this.talk = null;
    await this.buildChain.catch(() => {});
  }

  async build(): Promise<BuildResult> {
    this.requireBeatFormat('talk.build');
    const b = await this.enqueueBuild('request');
    return { ok: b.ok, diagnostics: b.diagnostics, ms: b.ms };
  }

  async layout(): Promise<LayoutResult> {
    this.requireBeatFormat('talk.layout');
    return this.core.layout(await this.load());
  }

  setWatching(enabled: boolean): boolean {
    const t = this.requireTalk();
    if (enabled && !t.watcher) {
      t.watcher = new TalkWatcher(t.root, { debounceMs: this.debounceMs, onBatch: (b) => this.onBatch(t, b), log: this.log });
      t.watcher.start();
    } else if (!enabled && t.watcher) {
      t.watcher.stop();
      t.watcher = null;
    }
    return !!t.watcher;
  }

  /** App-originated write (Phase 3 edits): announced to the watcher, then written atomically. */
  writeFile(rel: string, content: string | Buffer) {
    const t = this.requireTalk();
    atomicAppWrite(t.watcher, t.root, rel, content);
  }

  /** Resolves when queued builds have finished (shutdown, tests). */
  idle(): Promise<unknown> { return this.buildChain.catch(() => {}); }

  // -------------------------------------------------------------------------------------

  private requireTalk(): OpenTalk {
    if (!this.talk) throw new RpcError(ErrorCode.NoTalkOpen, 'no talk is open');
    return this.talk;
  }
  private requireBeatFormat(method: string) {
    const t = this.requireTalk();
    if (t.kind !== 'beatFormat') throw new RpcError(ErrorCode.UnsupportedForKind, `${method} is not available for ${t.kind} talks`, { kind: t.kind });
  }

  private async load(): Promise<LoadedTalk> {
    try {
      return await this.core.load(this.requireTalk().root);
    } catch (e) {
      if (e instanceof NotATalkError) throw new RpcError(ErrorCode.NotATalk, e.message);
      throw e;
    }
  }

  private onBatch(t: OpenTalk, b: WatchBatch) {
    if (this.talk !== t) return; // stale watcher of a closed talk
    if (b.external.length) this.events.changed({ paths: b.external, source: 'external' });
    if (b.app.length) this.events.changed({ paths: b.app, source: 'app' });
    if (t.kind === 'beatFormat' && !this.changeBuildQueued) {
      this.changeBuildQueued = true;
      void this.enqueueBuild('change').catch((e) => this.log('error', `rebuild failed: ${(e as Error).message}`));
    }
  }

  /** Builds run one at a time; change-triggered builds coalesce while one is queued. */
  private enqueueBuild(trigger: BuildTrigger): Promise<BuiltParams> {
    const t = this.talk;
    const run = async (): Promise<BuiltParams> => {
      if (trigger === 'change') this.changeBuildQueued = false;
      if (!t || this.talk !== t) return { ok: false, diagnostics: [], ms: 0, trigger };
      let built: BuiltParams;
      try {
        const loaded = await this.core.load(t.root);
        const res = await this.core.compile(loaded);
        built = { ...res, trigger };
        if (res.ok) {
          const lay = await this.core.layout(loaded);
          built.holds = lay.holds;
          built.diagnostics = [...res.diagnostics, ...lay.diagnostics];
        }
      } catch (e) {
        const code = e instanceof NotATalkError ? 'invalid-spine' : 'build-crashed';
        built = { ok: false, diagnostics: [{ severity: 'error', code, message: (e as Error).message, file: 'talk.json' }], ms: 0, trigger };
      }
      if (this.talk === t) this.events.built(built);
      return built;
    };
    const p = this.buildChain.then(run, run);
    this.buildChain = p.catch(() => {});
    return p;
  }
}
