// rpc.ts — a symmetric NDJSON JSON-RPC 2.0 peer over a Readable/Writable pair.
//
// Incoming requests are dispatched to registered handlers, one at a time in arrival order
// (talk.open then talk.layout sent back to back must not race), except for handlers registered
// as `concurrent` (app.ping), which answer immediately. Outgoing requests (sidecar -> app, used
// from Phase 4 for permission prompts and frame requests) are matched to responses by id.
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { ErrorCode, JSONRPC, RpcError, classify, type ErrorObject, type Message } from './protocol.ts';

export type Handler = (params: unknown) => unknown | Promise<unknown>;
export type Log = (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

export class RpcPeer {
  private handlers = new Map<string, { fn: Handler; concurrent: boolean }>();
  private notificationHandlers = new Map<string, (params: unknown) => void>();
  private queue: Promise<void> = Promise.resolve();
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = '';
  private decoder = new StringDecoder('utf8');
  private closed = false;
  private closeListeners: Array<() => void> = [];

  constructor(private input: Readable, private output: Writable, private log: Log = () => {}) {
    input.on('data', (chunk: Buffer | string) => this.feed(typeof chunk === 'string' ? chunk : this.decoder.write(chunk)));
    input.on('end', () => this.close('input ended'));
    input.on('error', (e) => this.close(`input error: ${e.message}`));
    output.on('error', (e) => this.close(`output error: ${e.message}`));
  }

  /** Registers a request handler. Handlers throw RpcError for structured errors. */
  handle(method: string, fn: Handler, opts: { concurrent?: boolean } = {}) {
    this.handlers.set(method, { fn, concurrent: !!opts.concurrent });
  }
  onNotification(method: string, fn: (params: unknown) => void) { this.notificationHandlers.set(method, fn); }
  onClose(fn: () => void) { this.closeListeners.push(fn); }
  get isClosed() { return this.closed; }

  notify(method: string, params?: unknown) {
    this.write(params === undefined ? { jsonrpc: JSONRPC, method } : { jsonrpc: JSONRPC, method, params });
  }

  /** Sends a request to the other side and resolves with its result. */
  request(method: string, params?: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new RpcError(ErrorCode.ShuttingDown, 'connection closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(ErrorCode.Timeout, `${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write(params === undefined ? { jsonrpc: JSONRPC, id, method } : { jsonrpc: JSONRPC, id, method, params });
    });
  }

  /** Resolves once every queued request has been answered. */
  drain(): Promise<void> { return this.queue; }

  close(reason: string) {
    if (this.closed) return;
    this.closed = true;
    this.log('info', `rpc closed: ${reason}`);
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new RpcError(ErrorCode.ShuttingDown, 'connection closed')); }
    this.pending.clear();
    for (const fn of this.closeListeners) fn();
  }

  private write(msg: Message) {
    if (this.closed && !('id' in msg)) return;
    try {
      this.output.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      this.close(`write failed: ${(e as Error).message}`);
    }
  }

  private feed(text: string) {
    this.buffer += text;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim()) this.receive(line);
    }
  }

  private replyError(id: number | null, err: ErrorObject) {
    this.write({ jsonrpc: JSONRPC, id, error: err });
  }

  private receive(line: string) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (e) {
      this.log('warn', `unparsable line: ${line.slice(0, 200)}`);
      return this.replyError(null, { code: ErrorCode.ParseError, message: `parse error: ${(e as Error).message}` });
    }
    const c = classify(value);
    switch (c.type) {
      case 'invalid': {
        const id = typeof (value as { id?: unknown })?.id === 'number' ? ((value as { id: number }).id) : null;
        return this.replyError(id, { code: ErrorCode.InvalidRequest, message: `invalid request: ${c.reason}` });
      }
      case 'notification': {
        const fn = this.notificationHandlers.get(c.msg.method);
        if (fn) fn(c.msg.params); else this.log('debug', `ignored notification ${c.msg.method}`);
        return;
      }
      case 'response':
      case 'error': {
        const id = c.msg.id;
        const p = id === null ? undefined : this.pending.get(id);
        if (!p) return this.log('warn', `response for unknown id ${id}`);
        this.pending.delete(id!);
        clearTimeout(p.timer);
        if (c.type === 'response') p.resolve(c.msg.result);
        else p.reject(new RpcError(c.msg.error.code, c.msg.error.message, c.msg.error.data));
        return;
      }
      case 'request': {
        const { id, method, params } = c.msg;
        const h = this.handlers.get(method);
        if (!h) return this.replyError(id, { code: ErrorCode.MethodNotFound, message: `no such method: ${method}` });
        const run = async () => {
          try {
            const result = await h.fn(params);
            this.write({ jsonrpc: JSONRPC, id, result: result ?? {} });
          } catch (e) {
            if (e instanceof RpcError) return this.replyError(id, e.toObject());
            this.log('error', `${method} failed: ${(e as Error).stack ?? e}`);
            this.replyError(id, { code: ErrorCode.InternalError, message: (e as Error).message ?? String(e) });
          }
        };
        if (h.concurrent) void run();
        else this.queue = this.queue.then(run);
        return;
      }
    }
  }
}
