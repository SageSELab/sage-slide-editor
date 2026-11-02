import { describe, expect, it } from 'vitest';
import { spineSources } from '../src/edit-spine.ts';
import { loadTalk, loadTalkFrom, memoryHost, talkFiles } from '../src/load.ts';
import { applyToTexts } from '../src/patch.ts';
import { recordTalk } from '../src/record.ts';
import { stretchBeat } from '../src/stretch.ts';
import { ISSTA, oneChapter } from './helpers.ts';

const SCENE = '<div class="scene"><h1 id="h">x</h1><p class="r">1</p><p class="r">2</p></div>';
const BODY = `  B.in('#h', 0.5, { dur: 1.5, y: 20 });
  B.anim('.r', 1, 0.5, [{ opacity: 1 }], { stagger: 0.25, ease: 'out' });
  B.set('#h', 2, { text: 'y' });
  B.tween(-0.5, 1, () => {});
  for (let i = 0; i < 2; i++) B.in('#h', 0.4 + i * 0.1);
  B.lib.helper(B, 3);
  B.T.in('#h', 9);
  const o = { dur: 1 }; B.out('#h', 4, o);`;

describe('stretchBeat', () => {
  const t = oneChapter([['x', BODY, { hold: 5 }]], SCENE, { lib: { 'lib/h.js': 'Talk.lib.helper = () => {};' } });
  const texts = Object.fromEntries(talkFiles(t).map((f) => [f.path, f.text]));
  const r = stretchBeat(spineSources(t), 'c.x', 2);
  const out = applyToTexts(texts, r.patches);

  it('scales literal times, durations, stagger and the hold', () => {
    const js = out['beats/c.js']!;
    expect(js).toContain("B.in('#h', 1, { dur: 3, y: 20 });");
    expect(js).toContain("B.anim('.r', 2, 1, [{ opacity: 1 }], { stagger: 0.5, ease: 'out' });");
    expect(js).toContain("B.set('#h', 4, { text: 'y' });");
    expect(js).toContain('B.tween(-1, 2, () => {});');
    expect(JSON.parse(out['talk.json']!).chapters[0].beats[0].hold).toBe(10);
    expect(r.stretched).toBe(4);
  });

  it('reports the forms it cannot stretch and leaves them untouched', () => {
    expect(r.skipped.map((s) => [s.line, s.reason])).toEqual([
      [6, 'argument 2 is not a numeric literal'],
      [7, 'helper call receives B; its time arguments are unknown'],
      [8, 'B.T call uses absolute times'],
      [9, 'options argument is not an object literal'],
    ]);
    expect(out['beats/c.js']).toContain('B.in(\'#h\', 0.4 + i * 0.1)');
  });

  it('inverts byte-for-byte', () => {
    expect(applyToTexts(out, r.inverse)).toEqual(texts);
  });

  it('doubles the recorded motion end when every call is literal with explicit durations', () => {
    const lit = oneChapter([['x', "B.in('#h', 0.5, { dur: 1.5 });\nB.anim('.r', 1, 0.5, [{ opacity: 1 }], { stagger: 0.25 });"]], SCENE);
    const tx = Object.fromEntries(talkFiles(lit).map((f) => [f.path, f.text]));
    const e = stretchBeat(spineSources(lit), 'c.x', 2);
    const after = loadTalkFrom(memoryHost(applyToTexts(tx, e.patches)));
    expect(recordTalk(after).beats.get('c.x')!.lastEnd).toBe(2 * recordTalk(lit).beats.get('c.x')!.lastEnd);
  });

  it('runs on every ISSTA beat: round trips, and lists what it skipped', () => {
    const it = loadTalk(ISSTA), src = spineSources(it);
    const texts = Object.fromEntries(talkFiles(it).map((f) => [f.path, f.text]));
    const reasons = new Map<string, number>();
    for (const ch of it.spine!.chapters) for (const b of ch.beats) {
      const e = stretchBeat(src, `${ch.id}.${b.id}`, 1.25);
      expect(applyToTexts(applyToTexts(texts, e.patches), e.inverse)).toEqual(texts);
      for (const s of e.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    }
    console.log('[stretch] skipped on ISSTA: ' + JSON.stringify(Object.fromEntries(reasons)));
  });

  it('rejects a non-positive factor', () => {
    expect(() => stretchBeat(spineSources(t), 'c.x', 0)).toThrow(/positive/);
  });
});
