#!/usr/bin/env -S node --import tsx
// main.ts — the SAGE sidecar process. Speaks NDJSON JSON-RPC 2.0 on stdin/stdout (docs/rpc.md);
// logs to stderr only. Exits 0 on app.shutdown or when stdin closes (the app quit or crashed).
//
// Phase 5: talk.publish, talk.export, site.stage and site.commit (src/publish/).
// Phase 4: the Agent SDK bridge (src/claude/bridge.ts) answers the `claude.*` methods, reports
// `claude.*` notifications, and asks the app through `app.ask|state|goto` requests.
// First: exports a bundled runtime (engine, plugin, talkc, browser) into the environment that
// Claude and talkc inherit, before any other module runs (src/runtime.ts).
import { runtime } from './runtime-env.ts';
import { ClaudeBridge } from './claude/bridge.ts';
import {
  PROTOCOL_VERSION, RpcError, ErrorCode, paramCheckers, claudeParamCheckers, setupParamCheckers,
  type ClaudeMethodName, type ClaudeSendParams, type SetupMethodName, type SetupCheckParams, type MethodName, type OpenParams, type WatchParams, type EditParams, type Inverse,
} from './protocol.ts';
import { Publisher } from './publish/index.ts';
import { publishParamCheckers, type PublishMethodName } from './protocol.ts';
import { RpcPeer, type Log } from './rpc.ts';
import { Session } from './session.ts';
import { checkSetup, installBrowser } from './setup.ts';

const VERSION = '0.0.0';
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const minLevel = LEVELS[(process.env.SAGE_LOG as keyof typeof LEVELS) ?? 'info'] ?? LEVELS.info;
const log: Log = (level, msg) => {
  if (LEVELS[level] >= minLevel) process.stderr.write(`[sidecar ${process.pid}] ${level}: ${msg}\n`);
};
// stdout is the protocol channel: keep stray console output (ours or a dependency's) off it.
console.log = console.info = console.debug = (...a: unknown[]) => log('info', a.map(String).join(' '));
console.warn = (...a: unknown[]) => log('warn', a.map(String).join(' '));

const peer = new RpcPeer(process.stdin, process.stdout, log);
const session = new Session(
  {
    changed: (p) => peer.notify('talk.changed', p),
    built: (p) => peer.notify('talk.built', p),
  },
  undefined,
  log,
);

let shuttingDown = false;
let stopping = false;
async function shutdown(reason: string, code = 0) {
  if (stopping) return;
  stopping = true;
  log('info', `shutting down: ${reason}`);
  const deadline = new Promise((r) => setTimeout(r, 3_000).unref());
  // Answer every request already received before refusing new work: a client that pipelines
  // requests and then closes stdin must still get its responses (responses may be written
  // after the input side closes). Requests arriving from here on get ShuttingDown.
  await Promise.race([peer.drain(), deadline]);
  shuttingDown = true;
  await Promise.race([closeBridge().then(() => session.close()).then(() => session.idle()), deadline]);
  process.stdout.write('', () => process.exit(code));
}

function method<M extends MethodName>(name: M, fn: (params: never) => unknown, opts: { concurrent?: boolean } = {}) {
  peer.handle(name, (params) => {
    if (shuttingDown && name !== 'app.ping') throw new RpcError(ErrorCode.ShuttingDown, 'sidecar is shutting down');
    const problems = paramCheckers[name](params);
    if (problems.length) throw new RpcError(ErrorCode.InvalidParams, problems.join('; '), { problems });
    return fn(params as never);
  }, opts);
}

method('app.ping', () => ({ pong: true, protocol: PROTOCOL_VERSION, version: VERSION, pid: process.pid }), { concurrent: true });
method('app.shutdown', () => {
  // Reply first, then exit once the reply has been flushed.
  setImmediate(() => void shutdown('app.shutdown'));
  return {};
});
method('talk.open', async (p: OpenParams) => { await closeBridge(); return session.open(p); });
method('talk.close', async () => { await closeBridge(); await session.close(); return {}; });
method('talk.build', () => session.build());
method('talk.layout', () => session.layout());
method('talk.watch', (p: WatchParams) => ({ watching: session.setWatching(p.enabled) }));
// Editing (Phase 3)
method('talk.edit', (p: EditParams) => session.edit(p));
method('talk.revert', (p: Inverse) => session.revert(p));

// --- Claude bridge (Phase 4) ---------------------------------------------------------------
// One bridge per open talk, created on the first claude.* call and closed with the talk.
let bridge: ClaudeBridge | null = null;
async function closeBridge() {
  const b = bridge;
  bridge = null;
  await b?.close().catch((e: Error) => log('warn', `closing the Claude bridge: ${e.message}`));
}
function claudeBridge(): ClaudeBridge {
  const root = session.root;
  if (!root) throw new RpcError(ErrorCode.NoTalkOpen, 'no talk is open');
  if (session.kind !== 'beatFormat') throw new RpcError(ErrorCode.UnsupportedForKind, 'Claude works on sage-talk/1 talks', { kind: session.kind });
  bridge ??= new ClaudeBridge({
    root,
    spine: () => session.spine(),
    layout: () => session.layout(),
    build: () => session.build(),
    edit: (p) => session.edit(p, 'claude'),
    expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
    notify: (m, p) => peer.notify(m, p),
    request: (m, p, timeoutMs) => peer.request(m, p, timeoutMs),
    log,
  });
  return bridge;
}
function claudeMethod<M extends ClaudeMethodName>(name: M, fn: (params: never) => unknown) {
  peer.handle(name, (params) => {
    if (shuttingDown) throw new RpcError(ErrorCode.ShuttingDown, 'sidecar is shutting down');
    const problems = claudeParamCheckers[name](params);
    if (problems.length) throw new RpcError(ErrorCode.InvalidParams, problems.join('; '), { problems });
    return fn(params as never);
  }, { concurrent: true }); // never queued behind a build, so Stop works mid-request
}
claudeMethod('claude.send', (p: ClaudeSendParams) => claudeBridge().send(p));
claudeMethod('claude.interrupt', () => (bridge ? bridge.interrupt() : { interrupted: false }));
claudeMethod('claude.reset', async () => { await claudeBridge().reset(); return {}; });

// --- Publish and export (Phase 5) -----------------------------------------------------------
// Queued like builds and edits (an export renders the film the last build wrote).
const publisher = new Publisher({
  get root() { return session.root; },
  get kind() { return session.kind; },
  build: () => session.build(),
  spine: () => session.spine(),
  notifyProgress: (p) => peer.notify('talk.exportProgress', p),
  writeFile: (rel, content) => session.writeFile(rel, content),
});
function publishMethod<M extends PublishMethodName>(name: M, fn: (params: never) => unknown) {
  peer.handle(name, (params) => {
    if (shuttingDown) throw new RpcError(ErrorCode.ShuttingDown, 'sidecar is shutting down');
    const problems = publishParamCheckers[name](params);
    if (problems.length) throw new RpcError(ErrorCode.InvalidParams, problems.join('; '), { problems });
    return fn(params as never);
  });
}
publishMethod('talk.publish', (p) => publisher.publish(p));
publishMethod('talk.export', (p) => publisher.export(p));
publishMethod('site.stage', (p) => publisher.stage(p));
publishMethod('site.commit', (p) => publisher.commit(p));
publishMethod('talk.qr', (p) => publisher.qr(p));

// --- Setup (Phase 6): the onboarding sheet's checks; no talk needed -----------------------
function setupMethod<M extends SetupMethodName>(name: M, fn: (params: never) => unknown) {
  peer.handle(name, (params) => {
    if (shuttingDown) throw new RpcError(ErrorCode.ShuttingDown, 'sidecar is shutting down');
    const problems = setupParamCheckers[name](params);
    if (problems.length) throw new RpcError(ErrorCode.InvalidParams, problems.join('; '), { problems });
    return fn(params as never);
  }, { concurrent: true });
}
setupMethod('setup.check', (p: SetupCheckParams | undefined) => checkSetup(runtime, { auth: p?.auth ?? false }));
let installing: ReturnType<typeof installBrowser> | null = null;
setupMethod('setup.installBrowser', () => {
  installing ??= installBrowser(runtime, { onProgress: (p) => peer.notify('setup.progress', p) }).finally(() => { installing = null; });
  return installing;
});

peer.onClose(() => void shutdown('stdin closed'));
process.stdout.on('error', () => void shutdown('stdout closed', 0));
// If the app died, its end of the log pipe is gone too. Without a listener every log line then
// raises EPIPE as an uncaught exception, whose handler logs again, and the sidecar never exits.
process.stderr.on('error', () => {});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (e) => { log('error', `uncaught: ${e.stack ?? e}`); });
process.on('unhandledRejection', (e) => { log('error', `unhandled rejection: ${(e as Error)?.stack ?? e}`); });
log('info', `ready (protocol ${PROTOCOL_VERSION}, node ${process.version}, ${runtime.mode}${runtime.manifest ? ' ' + runtime.manifest.version : ''})`);
