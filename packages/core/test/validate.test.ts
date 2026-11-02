// One positive and one negative case per diagnostic code (PLAN 12.2), with locations.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/diagnostics.ts';
import type { LoadedTalk } from '../src/load.ts';
import { validateTalk } from '../src/validate.ts';
import { mini, oneChapter, spineOf } from './helpers.ts';

const SCENE = `<div class="scene">
  <h1 id="h" data-a>Hi</h1>
  <p id="p" data-a>x</p>
  <img id="i" src="assets/a.png" alt="">
</div>`;
const A = ['assets/a.png'];
const talk = (beats: [string, string, Record<string, unknown>?][], o: { scene?: string; lib?: Record<string, string>; assets?: string[] } = {}) => {
  const t = oneChapter(beats as never, o.scene ?? SCENE, o.lib ? { lib: o.lib } : {});
  return mini(JSON.parse(t.spineFile!.text), Object.fromEntries([...(t.lib ?? []), t.chapters[0]!.scene!, t.chapters[0]!.motion!].map((f) => [f.path, f.text])), o.assets ?? A);
};
const codes = (t: LoadedTalk) => validateTalk(t);
const find = (ds: Diagnostic[], code: string) => ds.filter((d) => d.code === code);

interface Case { code: string; pos: () => LoadedTalk; neg: () => LoadedTalk; at?: Partial<Diagnostic>; lineHas?: string }
const cases: Case[] = [
  { code: 'json-syntax', pos: () => mini('{ "format": '), neg: () => talk([['a', '']]), at: { file: 'talk.json', line: 1 } },
  { code: 'file-missing', pos: () => mini(spineOf([{ id: 'c', scene: 'scenes/nope.html', beats: [{ id: 'a' }] }])), neg: () => talk([['a', '']]), at: { file: 'talk.json' } },
  { code: 'schema-invalid', pos: () => mini(spineOf([{ id: 'c', beats: [{ id: 'a', hold: 'long' as never }] }])), neg: () => talk([['a', '']]), at: { file: 'talk.json' }, lineHas: '"hold": "long"' },
  { code: 'schema-unknown-key', pos: () => mini({ ...spineOf([{ id: 'c', beats: [{ id: 'a' }] }]), colour: 1 }), neg: () => talk([['a', '']]), at: { file: 'talk.json' }, lineHas: '"colour": 1' },
  { code: 'script-syntax', pos: () => talk([['a', 'B.in(#h, 0);']]), neg: () => talk([['a', "B.in('#h', 0);"]]), at: { file: 'beats/c.js', line: 2 } },
  { code: 'record-script-failed', pos: () => talk([['a', '']], { lib: { 'lib/x.js': "document.getElementById('none').remove();" } }), neg: () => talk([['a', '']], { lib: { 'lib/x.js': "document.getElementById('h').remove;" } }), at: { file: 'lib/x.js', line: 1 } },
  { code: 'record-beat-failed', pos: () => talk([['a', 'B.lib.missing.go(B);']]), neg: () => talk([['a', "B.in('#h', 0);"]]), at: { file: 'beats/c.js', line: 2, beat: 'c.a' } },
  { code: 'beat-registered-twice', pos: () => talk([['a', ''], ['b', "}); Talk.beat('c.a', (B) => {"]]), neg: () => talk([['a', ''], ['b', '']]) },
  { code: 'duplicate-chapter-id', pos: () => mini(spineOf([{ id: 'c', beats: [{ id: 'a' }] }, { id: 'c', beats: [{ id: 'b' }] }])), neg: () => mini(spineOf([{ id: 'c', beats: [{ id: 'a' }] }, { id: 'd', beats: [{ id: 'b' }] }])), at: { file: 'talk.json' } },
  { code: 'duplicate-beat-id', pos: () => talk([['a', ''], ['a', '']]), neg: () => talk([['a', ''], ['b', '']]), at: { file: 'talk.json', beat: 'c.a' } },
  { code: 'duplicate-element-id', pos: () => talk([['a', '']], { scene: SCENE.replace('id="p"', 'id="h"') }), neg: () => talk([['a', '']]), at: { file: 'scenes/c.html', line: 3, col: 6 } },
  { code: 'selector-no-match', pos: () => talk([['a', "B.in('#nope', 0);"]]), neg: () => talk([['a', "B.in('#h', 0);"]]), at: { file: 'beats/c.js', line: 2, beat: 'c.a' } },
  { code: 'asset-missing', pos: () => talk([['a', '']], { assets: [] }), neg: () => talk([['a', '']]), at: { file: 'scenes/c.html', line: 4 } },
  { code: 'asset-not-in-build', pos: () => talk([['a', '']], { scene: SCENE.replace('assets/a.png', 'img/a.png'), assets: ['img/a.png'] }), neg: () => talk([['a', '']]), at: { file: 'scenes/c.html', line: 4 } },
  { code: 'notes-missing', pos: () => talk([['a', '', { notes: '' }]]), neg: () => talk([['a', '']]), at: { file: 'talk.json', beat: 'c.a' } },
  { code: 'hold-before-motion-end', pos: () => talk([['a', "B.in('#h', 0, { dur: 2 });", { hold: 1.5 }]]), neg: () => talk([['a', "B.in('#h', 0, { dur: 2 });", { hold: 2 }]]), at: { file: 'talk.json', beat: 'c.a' } },
  { code: 'ghost-entrance', pos: () => talk([['a', "B.in('#h', 0);"], ['b', "B.in('#p', -0.5);"]]), neg: () => talk([['a', "B.in('#h', 0);"], ['b', "B.in('#p', 0);"]]), at: { file: 'beats/c.js', line: 6, beat: 'c.b' } },
  { code: 'first-owner-opacity', pos: () => talk([['a', "B.anim('#p', 0, 0.5, [{ opacity: 0.5 }]);"], ['b', "B.in('#p', 0);"]]), neg: () => talk([['a', "B.in('#p', 0);"], ['b', "B.anim('#p', 0, 0.5, [{ opacity: 0.5 }]);"]]), at: { file: 'beats/c.js', line: 2, beat: 'c.a' } },
  { code: 'escape-hatch', pos: () => talk([['a', "B.T.in('#h', B.at + 1);"]]), neg: () => talk([['a', "B.in('#h', 1);"]]), at: { file: 'beats/c.js', line: 2 } },
  { code: 'beat-no-motion', pos: () => mini(spineOf([{ id: 'c', beats: [{ id: 'a', hold: 1 }] }])), neg: () => talk([['a', '']]), at: { file: 'talk.json', beat: 'c.a' } },
  { code: 'beat-not-in-spine', pos: () => talk([['a', "}); Talk.beat('c.zz', (B) => {"]]), neg: () => talk([['a', '']]) },
];

describe('validate: one positive and one negative per code', () => {
  for (const c of cases) {
    it(`${c.code}: reported`, () => {
      const ds = find(codes(c.pos()), c.code);
      expect(ds.length, JSON.stringify(codes(c.pos()))).toBeGreaterThan(0);
      if (c.at) expect(ds[0]).toMatchObject(c.at);
      if (c.lineHas) expect(c.pos().spineFile!.text.split('\n')[ds[0]!.line! - 1]).toContain(c.lineHas);
    });
    it(`${c.code}: not reported`, () => {
      expect(find(codes(c.neg()), c.code)).toEqual([]);
    });
  }

  it('a clean talk has no diagnostics at all', () => {
    expect(codes(talk([['a', "B.in('#h', 0);"], ['b', "B.words('#p', 0.2); B.set('#p', 1, { text: 'y' });"]], { scene: SCENE.replace('>x<', '><span class="w">x</span><') }))).toEqual([]);
  });

  it('severities follow the spec: ghost is an error, hold-before-motion-end a warning, escape-hatch info', () => {
    const sev = (c: string) => find(codes(cases.find((x) => x.code === c)!.pos()), c)[0]!.severity;
    expect([sev('ghost-entrance'), sev('hold-before-motion-end'), sev('escape-hatch'), sev('first-owner-opacity')]).toEqual(['error', 'warning', 'info', 'warning']);
  });

  it('first-owner check follows registration order after a reorder', () => {
    // same two beats, swapped: only the order where the one-keyframe anim comes first warns
    const ab = talk([['a', "B.in('#p', 0);"], ['b', "B.anim('#p', 0, 0.5, [{ opacity: 0.5 }]);"]]);
    const ba = talk([['b', "B.anim('#p', 0, 0.5, [{ opacity: 0.5 }]);"], ['a', "B.in('#p', 0);"]]);
    expect(find(codes(ab), 'first-owner-opacity')).toEqual([]);
    expect(find(codes(ba), 'first-owner-opacity')).toHaveLength(1);
  });
});
