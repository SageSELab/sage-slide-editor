// Spawns the real sidecar (node --import tsx src/main.ts) on a temp copy of fixtures/issta26.
// Every message the sidecar sends is checked against the protocol validators.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ErrorCode, classify, notificationCheckers, resultCheckers,
  type BuiltParams, type ChangedParams, type EditResult, type LayoutResult, type MethodName, type NotificationName, type OpenResult,
} from '../src/protocol.ts';
import { eventually, spineStats, tempTalk } from './helpers.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class Client {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly notes: { method: string; params: unknown }[] = [];
  readonly stderr: string[] = [];
  readonly problems: string[] = [];
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdoutEnded = false;
  private pending = new Map<number, { method: MethodName; resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  private buf = '';

  constructor(env: Record<string, string> = {}) {
    this.proc = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: PKG, env: { ...process.env, SAGE_WATCH_DEBOUNCE_MS: '100', ...env } });
    this.proc.stdout.on('data', (c: Buffer) => this.feed(c.toString('utf8')));
    this.proc.stdout.on('end', () => (this.stdoutEnded = true));
    this.proc.stderr.on('data', (c: Buffer) => this.stderr.push(c.toString('utf8')));
    this.exited = new Promise((r) => this.proc.on('exit', (code, signal) => r({ code, signal })));
  }

  request<R = unknown>(method: MethodName | string, params?: unknown): Promise<R> {
    const id = this.nextId++;
    const msg = params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
    this.proc.stdin.write(JSON.stringify(msg) + '\n');
    return new Promise((resolve, reject) => this.pending.set(id, { method: method as MethodName, resolve: resolve as (v: unknown) => void, reject }));
  }

  waitFor<P>(method: NotificationName, pred: (p: P) => boolean = () => true, timeoutMs = 10_000): Promise<P> {
    return eventually(() => this.notes.find((n) => n.method === method && pred(n.params as P))?.params as P, timeoutMs, method);
  }

  private feed(text: string) {
    this.buf += text;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const c = classify(JSON.parse(line));
      if (c.type === 'notification') {
        this.problems.push(...notificationCheckers[c.msg.method as NotificationName](c.msg.params).map((p) => `${c.msg.method}: ${p}`));
        this.notes.push({ method: c.msg.method, params: c.msg.params });
      } else if (c.type === 'response' || c.type === 'error') {
        const p = this.pending.get(c.msg.id as number);
        if (!p) { this.problems.push(`unmatched response ${line}`); continue; }
        this.pending.delete(c.msg.id as number);
        if (c.type === 'response') {
          this.problems.push(...(resultCheckers[p.method]?.(c.msg.result) ?? []).map((x) => `${p.method}: ${x}`));
          p.resolve(c.msg.result);
        } else p.reject(c.msg.error);
      } else this.problems.push(`unexpected ${c.type}: ${line}`);
    }
  }
}

describe('sidecar process', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
  function setup() {
    const t = tempTalk();
    const c = new Client();
    cleanups.push(() => { c.proc.kill('SIGKILL'); t.cleanup(); });
    return { root: t.root, c };
  }

  it('opens, lays out, rebuilds on an external edit, and shuts down', async () => {
    const { root, c } = setup();
    const ping = await c.request<{ pong: boolean; pid: number }>('app.ping');
    expect(ping).toMatchObject({ pong: true, pid: c.proc.pid });

    const open = await c.request<OpenResult>('talk.open', { path: root });
    expect(open.kind).toBe('beatFormat');
    expect(open.root).toBe(root);
    expect(open.filmURL).toBe(`file://${root}/build/index.html`);
    expect(open.build?.ok).toBe(true);
    expect(open.holds).toHaveLength(spineStats(root).beats);
    expect(fs.existsSync(path.join(root, 'build/index.html'))).toBe(true);
    await c.waitFor<BuiltParams>('talk.built', (p) => p.trigger === 'open');

    const layout = await c.request<LayoutResult>('talk.layout');
    expect(layout.holds.map((h) => h.at).slice(0, 4)).toEqual([5, 13.5, 20.5, 27.5]);
    expect(layout.holds).toEqual(open.holds);

    // Let FSEvents settle after the open-time build, then edit a scene "from a terminal".
    await new Promise((r) => setTimeout(r, 300));
    fs.appendFileSync(path.join(root, 'scenes/line.html'), '\n<!-- edited externally -->\n');
    const changed = await c.waitFor<ChangedParams>('talk.changed', (p) => p.paths.includes('scenes/line.html'));
    expect(changed.source).toBe('external');
    expect(changed.paths.every((p) => !p.startsWith('build/'))).toBe(true);
    const built = await c.waitFor<BuiltParams>('talk.built', (p) => p.trigger === 'change');
    expect(built.ok).toBe(true);
    expect(built.holds).toEqual(open.holds);
    expect(fs.readFileSync(path.join(root, 'build/index.html'), 'utf8')).toContain('edited externally');

    // A broken spine surfaces as a failed build, not a crash.
    fs.writeFileSync(path.join(root, 'talk.json'), '{ "format": ');
    const broken = await c.waitFor<BuiltParams>('talk.built', (p) => p.trigger === 'change' && !p.ok);
    expect(broken.diagnostics[0]).toMatchObject({ code: 'invalid-spine', file: 'talk.json' });

    await expect(c.request('talk.watch', { enabled: false })).resolves.toEqual({ watching: false });
    await expect(c.request('app.shutdown')).resolves.toEqual({});
    expect(await c.exited).toEqual({ code: 0, signal: null });
    expect(c.problems).toEqual([]);
    expect(c.stderr.join('')).toContain('shutting down: app.shutdown');
  });

  it('edits over RPC: talk.edit writes as the app, talk.revert undoes, a stale inverse conflicts', async () => {
    const { root, c } = setup();
    await c.request('talk.open', { path: root });
    await new Promise((r) => setTimeout(r, 300));
    const scene = path.join(root, 'scenes/line.html');
    const original = fs.readFileSync(scene, 'utf8');

    const ed = await c.request<EditResult>('talk.edit', { op: 'setStyle', args: { id: 'c1-eye', style: { left: 160 } } });
    expect(ed.changed).toEqual(['scenes/line.html']);
    expect(ed.ok).toBe(true);
    expect(fs.readFileSync(scene, 'utf8')).toContain('id="c1-eye" data-a style="position:absolute;left:160px;top:110px"');
    expect(c.notes.some((n) => n.method === 'talk.built' && (n.params as BuiltParams).trigger === 'edit')).toBe(true);
    const changed = await c.waitFor<ChangedParams>('talk.changed', (p) => p.paths.includes('scenes/line.html'));
    expect(changed.source).toBe('app');
    // The edit's own build covers the watcher's report: no change-triggered rebuild follows.
    await new Promise((r) => setTimeout(r, 400));
    expect(c.notes.filter((n) => n.method === 'talk.built' && (n.params as BuiltParams).trigger === 'change')).toEqual([]);

    const redo = await c.request<EditResult>('talk.revert', ed.inverse);
    expect(fs.readFileSync(scene, 'utf8')).toBe(original);

    // Someone else edits the file; the redo inverse no longer applies.
    await new Promise((r) => setTimeout(r, 300));
    fs.appendFileSync(scene, '\n<!-- claude was here -->\n');
    await expect(c.request('talk.revert', redo.inverse)).rejects.toMatchObject({ code: ErrorCode.EditConflict, data: { files: ['scenes/line.html'] } });
    expect(fs.readFileSync(scene, 'utf8')).toBe(original + '\n<!-- claude was here -->\n');
    await expect(c.request('talk.edit', { op: 'setText', args: { id: 'nope', html: 'x' } })).rejects.toMatchObject({ code: ErrorCode.EditFailed, data: { code: 'no-element' } });
    expect(c.problems).toEqual([]);
  });

  it('returns structured errors', async () => {
    const { root, c } = setup();
    await expect(c.request('talk.layout')).rejects.toMatchObject({ code: ErrorCode.NoTalkOpen });
    await expect(c.request('talk.open', { path: path.join(root, 'scenes') })).rejects.toMatchObject({ code: ErrorCode.NotATalk });
    await expect(c.request('talk.open', {})).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('talk.open', { path: 'relative/path' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('talk.frobnicate')).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    expect(c.problems).toEqual([]);
  });

  it('opens a .talk package like any talk folder', async () => {
    const { root, c } = setup();
    // The temp copy renamed as the app converts a folder; cleanup removes its parent.
    const pkg = path.join(path.dirname(root), 'ISSTA Talk.talk');
    fs.renameSync(root, pkg);
    const open = await c.request<OpenResult>('talk.open', { path: pkg, watch: false });
    expect(open.kind).toBe('beatFormat');
    expect(open.root).toBe(pkg);
    expect(open.build?.ok).toBe(true);
    expect(open.holds).toHaveLength(spineStats(pkg).beats);
    expect(fs.existsSync(path.join(pkg, 'build/index.html'))).toBe(true);
    expect(c.problems).toEqual([]);
  });

  it('opens a legacy deck read-only', async () => {
    const { root, c } = setup();
    const legacy = path.join(path.dirname(root), 'legacy');
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(legacy, 'talk.js'), '');
    const open = await c.request<OpenResult>('talk.open', { path: legacy, watch: false });
    expect(open).toEqual({ kind: 'legacy', root: fs.realpathSync(legacy), filmURL: `file://${fs.realpathSync(legacy)}/index.html` });
    await expect(c.request('talk.layout')).rejects.toMatchObject({ code: ErrorCode.UnsupportedForKind });
    await expect(c.request('talk.close')).resolves.toEqual({});
  });

  it('exits 0 when stdin closes', async () => {
    const { root, c } = setup();
    await c.request('talk.open', { path: root });
    c.proc.stdin.end();
    expect(await c.exited).toEqual({ code: 0, signal: null });
    expect(c.stdoutEnded).toBe(true);
  });

  it('crash: kill -9 is seen by the client as EOF on stdout', async () => {
    const { root, c } = setup();
    await c.request('talk.open', { path: root });
    const inflight = c.request('talk.build');
    c.proc.kill('SIGKILL');
    expect(await c.exited).toEqual({ code: null, signal: 'SIGKILL' });
    await eventually(() => c.stdoutEnded, 2000, 'stdout EOF');
    // The in-flight request never resolves; a real client fails it on EOF (see SidecarClient).
    const outcome = await Promise.race([inflight.then(() => 'answered', () => 'errored'), new Promise((r) => setTimeout(() => r('pending'), 100))]);
    expect(['pending', 'answered']).toContain(outcome);
  });
});
