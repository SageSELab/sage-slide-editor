import { describe, expect, it } from 'vitest';
import { lastEnds, recordTalk } from '../src/record.ts';
import { layout } from '../src/layout.ts';
import { oneChapter } from './helpers.ts';

const SCENE = `<div class="scene"><h1 id="h" data-a><span class="w">a</span><span class="w">b</span><span class="w">c</span></h1>
<p class="row">1</p><p class="row">2</p><p class="row">3</p><svg><path id="p" d="M0 0"/></svg><b id="n">0</b></div>`;
const end = (body: string, scene = SCENE) => recordTalk(oneChapter([['x', body]], scene)).beats.get('c.x')!.lastEnd;

describe('recorder end-time rules (talk-layout.js instrument)', () => {
  it('anim: t + stagger·(n−1) + dur, using the element count', () => {
    expect(end(`B.anim('.row', 1, 0.5, [{opacity:1}], { stagger: 0.25 });`)).toBe(2);
  });
  it('in/out defaults: dur 1 and 0.6', () => {
    expect(end(`B.in('#h', 0.5);`)).toBe(1.5);
    expect(end(`B.out('.row', 0, { stagger: 0.1 });`)).toBe(0.8);
  });
  it('words: show(sel) plus in(sel .w) with stagger 0.09 and dur 0.9', () => {
    expect(end(`B.words('#h', 0.6);`)).toBe(1.68);
  });
  it('show/hide: 0.01; draw/count/type/tween: t + dur; set: t', () => {
    expect(end(`B.show('#h', 2);`)).toBe(2.01);
    expect(end(`B.draw('#p', 1, 2, 0, 1);`)).toBe(3);
    expect(end(`B.count('#n', 1, 1.5, 10);`)).toBe(2.5);
    expect(end(`B.type('#n', 0.5, 1);`)).toBe(1.5);
    expect(end(`B.tween(0.2, 0.3, () => {});`)).toBe(0.5);
    expect(end(`B.set('#n', 4, { text: 'x' });`)).toBe(4);
  });
  it('a selector matching nothing adds no end time (but is recorded with n = 0)', () => {
    const r = recordTalk(oneChapter([['x', `B.in('#nope', 3);`]], SCENE));
    expect(r.beats.get('c.x')).toMatchObject({ lastEnd: 0, calls: [{ method: 'in', n: 0, sel: '#nope' }] });
  });
  it('B.T registers at absolute times; B.at is the beat start; both are noted as escapes', () => {
    const r = recordTalk(oneChapter([['x', ''], ['y', `B.T.in('#h', B.at + 1);`]], SCENE));
    const y = r.beats.get('c.y')!;
    expect(y.start).toBe(5);
    expect(y.lastEnd).toBe(2);
    expect(y.escapes.map((e) => e.what)).toEqual(['B.T', 'B.at']);
  });
  it('records call locations in the motion file and through lib helpers', () => {
    const lib = { 'lib/h.js': `Talk.lib.h = { pop: (B, t) => {\n  B.in('#h', t);\n} };\n` };
    const r = recordTalk(oneChapter([['x', `  B.lib.h.pop(B, 1);`]], SCENE, { lib }));
    const c = r.beats.get('c.x')!.calls[0]!;
    expect(c.loc).toMatchObject({ file: 'lib/h.js', line: 2 });
    expect(c.beatLoc).toMatchObject({ file: 'beats/c.js', line: 2 });
  });
  it('lib scripts may generate DOM that beats then animate', () => {
    const lib = { 'lib/g.js': `const s = document.querySelector('.scene'); for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.className = 'gen'; s.appendChild(d); }` };
    const r = recordTalk(oneChapter([['x', `B.in('.gen', 0, { stagger: 0.5 });`]], SCENE, { lib }));
    expect(r.beats.get('c.x')!.lastEnd).toBe(2.5);
  });
  it('a script that cannot run headless is a diagnostic, not a crash', () => {
    const lib = { 'lib/bad.js': `document.getElementById('missing').appendChild(null);` };
    const r = recordTalk(oneChapter([['x', `B.in('#h', 0); undefinedHelper();`]], SCENE, { lib }));
    expect(r.diagnostics.map((d) => d.code)).toEqual(['record-script-failed', 'record-beat-failed']);
    expect(r.beats.get('c.x')!.lastEnd).toBe(1);
  });
  it('feeds the pure layout the same lastEnds it walked with', () => {
    const t = oneChapter([['x', `B.in('#h', 1);`, { hold: undefined }], ['y', `B.in('#h', 0.2);`]], SCENE);
    const r = recordTalk(t);
    expect(layout(t.spine!, lastEnds(r))).toEqual(r.layout);
    expect(r.layout.beats[0]!.hold).toBe(3); // lastEnd 2.0 + default holdPad 1.0
  });
});

describe('Talk.lib usage (for the public cut)', () => {
  it('records what each lib defines and reads at load, and what each beat reads', () => {
    const t = oneChapter([['x', "B.lib.b.go(B, '#h', 0);"], ['y', '']], SCENE, { lib: {
      'lib/a.js': 'Talk.lib.a = { enter: (B, s, t) => B.in(s, t) };',
      'lib/b.js': 'const A = Talk.lib.a; Talk.lib.b = { go: (B, s, t) => A.enter(B, s, t) }; Talk.lib.nope;',
      'lib/c.js': 'Talk.ready(() => {});',
    } });
    const r = recordTalk(t);
    expect(Object.fromEntries(r.lib.defines)).toEqual({ 'lib/a.js': ['a'], 'lib/b.js': ['b'], 'lib/c.js': [] });
    expect(Object.fromEntries([...r.lib.loadUses].map(([k, v]) => [k, [...v]]))).toEqual({ 'lib/a.js': [], 'lib/b.js': ['a'], 'lib/c.js': [] });
    expect(Object.fromEntries([...r.lib.beatUses].map(([k, v]) => [k, [...v]]))).toEqual({ 'c.x': ['b'], 'c.y': [] });
    expect(r.beats.get('c.x')!.lastEnd).toBe(1);
  });
});
