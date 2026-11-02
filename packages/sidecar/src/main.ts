#!/usr/bin/env -S node --import tsx
// main.ts — the SAGE sidecar process. Speaks NDJSON JSON-RPC 2.0 on stdin/stdout (docs/rpc.md);
// logs to stderr only. Exits 0 on app.shutdown or when stdin closes (the app quit or crashed).
//
// Phase 4 adds the Agent SDK bridge here: a `claude.*` method family (send, interrupt,
// approve) and `claude.*` notifications (stream deltas, tool rows, cost), plus sidecar -> app
// requests (`app.ask` for the approval sheet, `app.frame` for talk_frame) through peer.request().
import { PROTOCOL_VERSION, RpcError, ErrorCode, paramCheckers, type MethodName, type OpenParams, type WatchParams } from './protocol.ts';
import { RpcPeer, type Log } from './rpc.ts';
import { Session } from './session.ts';

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
  await Promise.race([session.close().then(() => session.idle()), deadline]);
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
method('talk.open', (p: OpenParams) => session.open(p));
method('talk.close', async () => { await session.close(); return {}; });
method('talk.build', () => session.build());
method('talk.layout', () => session.layout());
method('talk.watch', (p: WatchParams) => ({ watching: session.setWatching(p.enabled) }));

peer.onClose(() => void shutdown('stdin closed'));
process.stdout.on('error', () => void shutdown('stdout closed', 0));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (e) => { log('error', `uncaught: ${e.stack ?? e}`); });
process.on('unhandledRejection', (e) => { log('error', `unhandled rejection: ${(e as Error)?.stack ?? e}`); });
log('info', `ready (protocol ${PROTOCOL_VERSION}, node ${process.version})`);
