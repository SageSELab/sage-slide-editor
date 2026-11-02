// Text the film rewrites while it plays (counters, typewriters, B.set text steps) must not be
// edited in place: the app would capture whatever the runtime showed and save it to the source.
import { applyPatches, loadTalk } from '@sage/core';
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

describe('element addresses (elements without an id)', () => {
  const apply = (p: Parameters<typeof computeEdit>[1]) => {
    const e = computeEdit(talk, p);
    const f = talk.chapters.flatMap((c) => (c.scene ? [c.scene] : [])).find((s) => s.path === e.patches[0]!.file)!;
    return { e, text: applyPatches(f.text, e.patches, f.path) };
  };

  it('gives the element an id and edits it, in one patch', () => {
    const { e, text } = apply({ op: 'setText', args: { id: 'c1-bench>p.sub:1', html: 'Success was set by unit tests.' } });
    expect(e.assigned).toBe('c1-bench-sub');
    expect(e.patches).toHaveLength(1);
    expect(text).toContain('<p id="c1-bench-sub" class="sub" style="margin-top:10px;font-size:34px">Success was set by unit tests.</p>');
    const st = apply({ op: 'setStyle', args: { id: 'c1-bench>p.sub', style: { color: '#ff2d78' } } }).text;
    expect(st).toContain('<p id="c1-bench-sub" class="sub" style="color:#ff2d78;font-weight:600;font-size:40px">');
  });

  it('keeps the runtime-text guard for addressed elements', () => {
    expect(refusal(() => setText('verd>span.verdict:2', 'X'))).toBe('runtime-text');
  });

  it('refuses an address the source does not have', () => {
    expect(refusal(() => setText('c1-bench>p.sub:5', 'X'))).toBe('stale-path');
    expect(refusal(() => setText('nope>p', 'X'))).toBe('no-element');
  });
});
