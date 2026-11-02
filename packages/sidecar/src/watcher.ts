// watcher.ts — the talk folder watcher (PLAN 6.1: the sidecar's watcher is the source of truth
// for reloads, whoever wrote the file: the app, Claude's Edit tool, talkc, or a terminal).
//
// fs.watch(recursive) is FSEvents on macOS. Events are debounced into batches; build/, .sage/,
// node_modules/, .git/ and editor litter are ignored. A path counts as app-originated when the
// sidecar announced the write beforehand (expectWrite) and the file on disk still has exactly
// the announced content; anything else is external. Matching on content rather than on time
// keeps a terminal edit that lands right after an app write from being mislabelled.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Log } from './rpc.ts';

const IGNORED_DIRS = new Set(['build', '.sage', 'node_modules', '.git']);

/** True for talk-relative POSIX paths the watcher never reports. */
export function isIgnored(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  const base = parts[parts.length - 1] ?? '';
  return base === '.DS_Store' || base.endsWith('~') || base.endsWith('.swp') || base.endsWith('.swx') || base.startsWith('.#') || /\.tmp-\d+/.test(base);
}

const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Who announced an expected write. Claude's edits are announced by the bridge (canUseTool, PostToolUse). */
export type WriteAuthor = 'app' | 'claude';

/** `claude` is present only when non-empty. */
export interface WatchBatch { app: string[]; external: string[]; claude?: string[] }

export interface WatcherOptions {
  debounceMs?: number;
  /** How long an announced write stays claimable (ms). */
  expectTtlMs?: number;
  onBatch: (batch: WatchBatch) => void;
  log?: Log;
}

interface Expected { digest: string | null; until: number; author: WriteAuthor }

export class TalkWatcher {
  private fsw: fs.FSWatcher | null = null;
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private expected = new Map<string, Expected>();
  private readonly debounceMs: number;
  private readonly expectTtlMs: number;

  constructor(readonly root: string, private opts: WatcherOptions) {
    this.debounceMs = opts.debounceMs ?? 150;
    this.expectTtlMs = opts.expectTtlMs ?? 5_000;
  }

  get running() { return this.fsw !== null; }

  start() {
    if (this.fsw) return;
    this.fsw = fs.watch(this.root, { recursive: true, persistent: false }, (_event, filename) => {
      if (!filename) return; // some platforms omit it; FSEvents always provides it
      const rel = filename.toString().split(path.sep).join('/');
      if (isIgnored(rel)) return;
      this.dirty.add(rel);
      this.schedule();
    });
    this.fsw.on('error', (e) => {
      this.opts.log?.('error', `watcher error: ${e.message}; restarting`);
      this.stop();
      setTimeout(() => this.start(), 250).unref();
    });
  }

  stop() {
    this.fsw?.close();
    this.fsw = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dirty.clear();
  }

  /** Announces that `author` is about to write `content` to `rel` (null: delete it). */
  expectWrite(rel: string, content: Buffer | string | null, author: WriteAuthor = 'app') {
    this.expected.set(rel, { digest: content === null ? null : hash(content), until: Date.now() + this.expectTtlMs, author });
  }

  /** Forces pending events out now (tests, shutdown). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty.size) return;
    const paths = [...this.dirty].sort();
    this.dirty.clear();
    const batch: WatchBatch = { app: [], external: [] };
    const now = Date.now();
    for (const [k, e] of this.expected) if (e.until < now) this.expected.delete(k);
    for (const rel of paths) {
      const abs = path.join(this.root, rel);
      let st: fs.Stats | null = null;
      try { st = fs.statSync(abs); } catch { /* deleted */ }
      if (st?.isDirectory()) continue; // directory events carry no content change of their own
      const exp = this.expected.get(rel);
      let digest: string | null = null;
      if (st) { try { digest = hash(fs.readFileSync(abs)); } catch { digest = null; } }
      if (exp && exp.digest === digest) {
        if (exp.author === 'claude') (batch.claude ??= []).push(rel);
        else batch.app.push(rel);
      }
      else {
        if (exp) this.expected.delete(rel); // someone else wrote over our write
        batch.external.push(rel);
      }
    }
    if (batch.app.length || batch.external.length || batch.claude?.length) this.opts.onBatch(batch);
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }
}

/**
 * Writes a file atomically on behalf of the app (Phase 3 edits go through here): the content is
 * announced to the watcher, written to a temp file under .sage/tmp (ignored), then renamed.
 */
export function atomicAppWrite(watcher: TalkWatcher | null, root: string, rel: string, content: string | Buffer) {
  watcher?.expectWrite(rel, content);
  const tmpDir = path.join(root, '.sage', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${path.basename(rel)}.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, path.join(root, rel));
}
