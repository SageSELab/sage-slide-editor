// Contract tests: every fixture in tests/rpc is a valid message of the kind and method its file
// name says. apps/mac/Tests/SageTalkCoreTests/RPCFixtureTests.swift decodes the same files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EDIT_OPS, ErrorCode, METHOD_NAMES, NOTIFICATION_NAMES, classify, checkErrorObject, notificationCheckers, paramCheckers, resultCheckers,
  type MethodName, type NotificationName,
} from '../src/protocol.ts';
import { RPC_FIXTURES } from './helpers.ts';

const KINDS = ['request', 'response', 'notification', 'error'] as const;
type Kind = (typeof KINDS)[number];

export function parseFixtureName(file: string): { method: string; kind: Kind } {
  const tokens = path.basename(file, '.json').split('.');
  const k = tokens.findIndex((t) => (KINDS as readonly string[]).includes(t));
  if (k < 0) throw new Error(`${file}: name has no kind token`);
  return { method: tokens.slice(0, k).join('.'), kind: tokens[k] as Kind };
}

const files = fs.readdirSync(RPC_FIXTURES).filter((f) => f.endsWith('.json')).sort();
const load = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(RPC_FIXTURES, f), 'utf8'));

describe('tests/rpc fixtures', () => {
  it('exist', () => expect(files.length).toBeGreaterThan(20));

  it.each(files)('%s', (f) => {
    const { method, kind } = parseFixtureName(f);
    const msg = load(f);
    const c = classify(msg);
    expect(c.type, `${f} envelope`).toBe(kind);
    switch (c.type) {
      case 'request':
        expect(c.msg.method).toBe(method);
        expect(paramCheckers[method as MethodName](c.msg.params)).toEqual([]);
        break;
      case 'response':
        expect(resultCheckers[method as MethodName](c.msg.result)).toEqual([]);
        break;
      case 'notification':
        expect(c.msg.method).toBe(method);
        expect(notificationCheckers[method as NotificationName](c.msg.params)).toEqual([]);
        break;
      case 'error':
        expect(checkErrorObject(c.msg.error)).toEqual([]);
        expect(Object.values(ErrorCode)).toContain(c.msg.error.code);
        break;
      default:
        throw new Error(`${f}: ${c.reason}`);
    }
  });

  it('cover every method, notification and wire error code', () => {
    const seen = files.map(parseFixtureName);
    for (const m of METHOD_NAMES) {
      expect(seen, `${m} request`).toContainEqual({ method: m, kind: 'request' });
      expect(seen, `${m} response`).toContainEqual({ method: m, kind: 'response' });
    }
    for (const n of NOTIFICATION_NAMES) expect(seen, n).toContainEqual({ method: n, kind: 'notification' });
    const codes = new Set(files.filter((f) => parseFixtureName(f).kind === 'error').map((f) => (load(f) as { error: { code: number } }).error.code));
    for (const [name, code] of Object.entries(ErrorCode)) if (name !== 'Timeout') expect(codes, name).toContain(code);
  });
});

describe('editing fixtures', () => {
  it('cover every talk.edit op', () => {
    const ops = files.filter((f) => f.startsWith('talk.edit.request.')).map((f) => (load(f) as { params: { op: string } }).params.op);
    for (const op of EDIT_OPS) expect(ops, op).toContain(op);
  });
  it('reject bad args', () => {
    const check = paramCheckers['talk.edit'];
    expect(check({ op: 'setHold', args: { ref: 'a.b', hold: -1 } })).toEqual(['params.args.hold: expected a non-negative number or null']);
    expect(check({ op: 'nope', args: {} })[0]).toMatch(/^params.op: expected one of/);
    expect(check({ op: 'setStyle', args: { id: 'x', style: { position: 'fixed' } } })).toHaveLength(1);
    expect(check({ op: 'setStyle', args: { id: 'x', style: { color: 5 } } })).toHaveLength(1);
    expect(check({ op: 'setStyle', args: { id: 'x', style: { color: '#fff', textAlign: 'center', fontWeight: 700, fontStyle: null } } })).toEqual([]);
    expect(check({ op: 'setText', args: { id: 'x', html: 'y', extra: 1 } })).toEqual(["params.args: unexpected 'extra'"]);
    expect(check({ op: 'insertBeat', args: { chapter: 'c', index: 0, beat: { id: 'b' } } })).toHaveLength(1);
    expect(paramCheckers['talk.revert']({ patches: [{ file: '/etc/passwd', range: [0, 1], newText: '' }], digests: {} })).toEqual(['params.patches[0].file: expected a relative path']);
    expect(paramCheckers['talk.revert']({ patches: [], digests: { 'a.html': 'xyz' } })).toEqual(['params.digests: expected {file: sha256 hex}']);
  });
});

describe('validators reject drift', () => {
  it('a renamed result field', () => {
    const r = (load('talk.open.response.json') as { result: Record<string, unknown> }).result;
    const { filmURL, ...rest } = r;
    expect(resultCheckers['talk.open']({ ...rest, filmUrl: filmURL })).toEqual(expect.arrayContaining(["result: missing 'filmURL'", "result: unexpected 'filmUrl'"]));
  });
  it('a bad enum value', () => {
    expect(notificationCheckers['talk.changed']({ paths: [], source: 'robot' })).toEqual(['params.source: bad value']);
  });
  it('a malformed hold', () => {
    const p = resultCheckers['talk.layout']({ holds: [{ index: 0, at: -1, label: 'x', backup: false, beat: 'a.b', chapter: 'a', auto: false }], duration: 1, diagnostics: [] });
    expect(p).toEqual(['result.holds[0].index: expected a positive integer', 'result.holds[0].at: expected a non-negative number']);
  });
  it('envelopes', () => {
    expect(classify({ jsonrpc: '1.0', id: 1, method: 'x' }).type).toBe('invalid');
    expect(classify({ jsonrpc: '2.0', id: 'a', method: 'x' }).type).toBe('invalid');
    expect(classify({ jsonrpc: '2.0', id: 1 }).type).toBe('invalid');
    expect(classify([]).type).toBe('invalid');
  });
});
