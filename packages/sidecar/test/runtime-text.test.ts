// Text the film rewrites while it plays (counters, typewriters, B.set text steps) must not be
// edited in place: the app would capture whatever the runtime showed and save it to the source.
import { loadTalk } from '@sage/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeEdit, runtimeTextKeys } from '../src/edit.ts';
import { RpcError } from '../src/protocol.ts';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/issta26');
const talk = loadTalk(fixture);
const setText = (id: string, html: string) => computeEdit(talk, { op: 'setText', args: { id, html } });
const refusal = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof RpcError ? (e.data as { code?: string } | undefined)?.code : 'other'; }
  return undefined;
};

describe('runtime-rewritten text', () => {
  const keys = runtimeTextKeys(talk);

  it('finds counters, B.set text steps and descendants of named elements', () => {
    expect(keys).toContain('#n50'); // B.count
    expect(keys).toContain('#yr'); // B.set text glitch
    expect(keys.some((k) => k.startsWith('#verd/'))).toBe(true); // unnamed children of #verd
  });

  it('refuses editing a counter in place', () => {
    expect(refusal(() => setText('n50', '12'))).toBe('runtime-text');
  });

  it('refuses editing a parent whose unnamed child is rewritten', () => {
    expect(refusal(() => setText('verd', '<span>x</span>'))).toBe('runtime-text');
  });

  it('refuses editing a parent whose html carries a rewritten named child', () => {
    expect(refusal(() => setText('fifty-n', '<span class="stat-num" id="n50">50</span>'))).toBe('runtime-text');
  });

  it('still allows ordinary text', () => {
    expect(refusal(() => setText('t-h', '<span class="w">Automated </span><span class="w">repair</span>'))).toBeUndefined();
  });
});
