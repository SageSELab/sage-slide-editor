import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ErrorCode, RpcError } from '../src/protocol.ts';
import { RpcPeer } from '../src/rpc.ts';
import { eventually } from './helpers.ts';

function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const out: Record<string, unknown>[] = [];
  let buf = '';
  output.on('data', (c: Buffer) => {
    buf += c.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { out.push(JSON.parse(buf.slice(0, nl))); buf = buf.slice(nl + 1); }
  });
  const peer = new RpcPeer(input, output);
  const send = (v: unknown) => input.write(typeof v === 'string' ? v : JSON.stringify(v) + '\n');
  return { peer, input, out, send };
}

describe('RpcPeer', () => {
  it('answers requests and wraps undefined results as {}', async () => {
    const { peer, out, send } = harness();
    peer.handle('a.echo', (p) => p);
    peer.handle('a.void', () => undefined);
    send({ jsonrpc: '2.0', id: 1, method: 'a.echo', params: { x: 'é' } });
    send({ jsonrpc: '2.0', id: 2, method: 'a.void' });
    await eventually(() => out.length === 2);
    expect(out).toEqual([{ jsonrpc: '2.0', id: 1, result: { x: 'é' } }, { jsonrpc: '2.0', id: 2, result: {} }]);
  });

  it('reassembles lines split across chunks, including inside a UTF-8 sequence', async () => {
    const { peer, out, input } = harness();
    peer.handle('a.echo', (p) => p);
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'a.echo', params: { s: 'é·' } }) + '\r\n');
    const cut = bytes.indexOf(Buffer.from('é')) + 1;
    input.write(bytes.subarray(0, cut));
    input.write(bytes.subarray(cut));
    await eventually(() => out.length === 1);
    expect(out[0]).toEqual({ jsonrpc: '2.0', id: 3, result: { s: 'é·' } });
  });

  it('serializes requests in arrival order; concurrent handlers skip the queue', async () => {
    const { peer, out, send } = harness();
    const order: string[] = [];
    peer.handle('slow', async () => { await new Promise((r) => setTimeout(r, 60)); order.push('slow'); return {}; });
    peer.handle('fast', () => { order.push('fast'); return {}; });
    peer.handle('ping', () => { order.push('ping'); return {}; }, { concurrent: true });
    send({ jsonrpc: '2.0', id: 1, method: 'slow' });
    send({ jsonrpc: '2.0', id: 2, method: 'fast' });
    send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    await eventually(() => out.length === 3);
    expect(order).toEqual(['ping', 'slow', 'fast']);
  });

  it('reports structured errors', async () => {
    const { peer, out, send } = harness();
    peer.handle('bad', () => { throw new RpcError(ErrorCode.NoTalkOpen, 'no talk is open', { hint: 1 }); });
    peer.handle('boom', () => { throw new Error('kaput'); });
    send('{not json\n');
    send({ jsonrpc: '2.0', id: 5, method: 'nope' });
    send({ jsonrpc: '2.0', id: 6, method: 'bad' });
    send({ jsonrpc: '2.0', id: 7, method: 'boom' });
    send({ jsonrpc: '1.0', id: 8, method: 'bad' });
    await eventually(() => out.length === 5);
    const byId = (id: unknown) => out.find((m) => m.id === id) as { error: { code: number; data?: unknown } };
    expect(byId(null).error.code).toBe(ErrorCode.ParseError);
    expect(byId(5).error.code).toBe(ErrorCode.MethodNotFound);
    expect(byId(6).error).toEqual({ code: ErrorCode.NoTalkOpen, message: 'no talk is open', data: { hint: 1 } });
    expect(byId(7).error).toEqual({ code: ErrorCode.InternalError, message: 'kaput' });
    expect(byId(8).error.code).toBe(ErrorCode.InvalidRequest);
  });

  it('sends its own requests and matches responses by id (Phase 4 direction)', async () => {
    const { peer, out, send } = harness();
    const a = peer.request('app.ask', { tool: 'Write' });
    const b = peer.request('app.frame', { t: 1 });
    await eventually(() => out.length === 2);
    send({ jsonrpc: '2.0', id: out[1]!.id, result: { png: '/tmp/f.png' } });
    send({ jsonrpc: '2.0', id: out[0]!.id, error: { code: -32000, message: 'denied' } });
    await expect(b).resolves.toEqual({ png: '/tmp/f.png' });
    await expect(a).rejects.toMatchObject({ code: -32000, message: 'denied' });
  });

  it('times out outgoing requests and fails pending ones on close', async () => {
    const { peer, input } = harness();
    await expect(peer.request('app.slow', undefined, 30)).rejects.toMatchObject({ code: ErrorCode.Timeout });
    const p = peer.request('app.never');
    let closed = false;
    peer.onClose(() => (closed = true));
    input.end();
    await expect(p).rejects.toMatchObject({ code: ErrorCode.ShuttingDown });
    expect(closed).toBe(true);
  });

  it('delivers notifications to handlers', async () => {
    const { peer, send } = harness();
    const got: unknown[] = [];
    peer.onNotification('app.state', (p) => got.push(p));
    send({ jsonrpc: '2.0', method: 'app.state', params: { beat: 3 } });
    await eventually(() => got.length === 1);
    expect(got).toEqual([{ beat: 3 }]);
  });
});
