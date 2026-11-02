import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatCplist, layout, r6 } from '../src/layout.ts';
import { SpineSchema, type TalkSpine } from '../src/schema.ts';
import { spineOf, type MiniChapter } from './helpers.ts';

const spine = (chs: MiniChapter[], extra: Record<string, unknown> = {}): TalkSpine => SpineSchema.parse(spineOf(chs, extra));

describe('layout (hand-computed)', () => {
  it('explicit holds chain by the boundary rule', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 5 }, { id: 'y', hold: 8.5 }] }, { id: 'b', beats: [{ id: 'z', hold: 7 }] }]));
    expect(l.beats.map((b) => [b.id, b.start, b.hold, b.at])).toEqual([['a.x', 0, 5, 5], ['a.y', 5, 8.5, 13.5], ['b.z', 13.5, 7, 20.5]]);
    expect(l.duration).toBe(21.5);
  });

  it('seeds an absent hold as lastEnd + holdPad (runtime default pad 1.0)', () => {
    const s = spine([{ id: 'a', beats: [{ id: 'x' }, { id: 'y', hold: 2 }] }]);
    const l = layout(s, { 'a.x': 4.2 });
    expect(l.beats[0]).toMatchObject({ hold: 5.2, auto: true, lastEnd: 4.2, at: 5.2 });
    expect(l.beats[1]).toMatchObject({ start: 5.2, auto: false, at: 7.2 });
  });

  it('uses defaults.tail for the duration (default 1.0)', () => {
    expect(layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 2 }] }], { defaults: { tail: 0.5 } })).duration).toBe(2.5);
  });

  it('honours defaults.holdPad and treats a beat with no motion as lastEnd 0', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x' }] }], { defaults: { holdPad: 1 } }));
    expect(l.beats[0]).toMatchObject({ lastEnd: 0, hold: 1 });
  });

  it('places chapter markers at 0 and first-beat start + 0.1; skips empty chapters', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 27.5 }] }, { id: 'e', beats: [] }, { id: 'b', beats: [{ id: 'y', hold: 1 }] }]));
    expect(l.chapters.map((c) => [c.id, c.at])).toEqual([['a', 0], ['b', 27.6]]);
  });

  it('gives a first chapter without beats no marker, so the next starts at 0.1', () => {
    const l = layout(spine([{ id: 'e', beats: [] }, { id: 'b', beats: [{ id: 'y', hold: 1 }] }]));
    expect(l.chapters).toMatchObject([{ id: 'b', at: 0.1 }]);
  });

  it('snaps float noise only within 1e-9 of a 6-decimal value', () => {
    expect(r6(27.5 + 0.1)).toBe(27.6);
    expect(r6(13.5 + 6 / 7)).toBe(13.5 + 6 / 7);
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 0.1 }, { id: 'y', hold: 0.2 }] }]));
    expect(l.beats[1]!.at).toBe(0.3);
  });

  it('derives dark windows from beat.dark ?? chapter.dark', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 2 }] }, { id: 'd', dark: true, beats: [{ id: 'y', hold: 3 }, { id: 'z', hold: 1, dark: false }] }, { id: 'e', dark: true, beats: [{ id: 'w', hold: 1 }] }]));
    expect(l.darkWindows).toEqual([[2, 5], [6, 8]]);
  });

  it('numbers backups separately', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', hold: 1 }, { id: 'y', hold: 1 }] }, { id: 'k', backup: true, beats: [{ id: 'b1', hold: 1 }, { id: 'b2', hold: 1 }] }]));
    expect(l.beats.map((b) => [b.backup, b.number])).toEqual([[false, 1], [false, 2], [true, 1], [true, 2]]);
  });

  it('public cut drops private chapters, appends the public block, re-lays out', () => {
    const s = spine([{ id: 'a', beats: [{ id: 'x', hold: 3 }] }, { id: 'p', private: true, beats: [{ id: 'y', hold: 9 }] }],
      { public: { id: 'end', label: 'End', tail: 0, beats: [{ id: 'end', label: 'Paper', hold: 4 }] } });
    expect(layout(s).beats.map((b) => b.id)).toEqual(['a.x', 'p.y']);
    const p = layout(s, {}, { public: true });
    expect(p.beats.map((b) => [b.id, b.at])).toEqual([['a.x', 3], ['end.end', 7]]);
    expect(p.duration).toBe(7); // public.tail 0
    expect(layout(s).duration).toBe(13); // full cut: defaults.tail ?? 1.0
    expect(p.beats.every((b) => b.notes === '')).toBe(true); // notes stripped
    expect(p.chapters.map((c) => [c.id, c.at])).toEqual([['a', 0], ['end', 3.1]]);
  });

  it('formats the cplist like the runtime', () => {
    const l = layout(spine([{ id: 'a', beats: [{ id: 'x', label: 'Title', hold: 5 }, { id: 'y', label: 'Next', hold: 8.55 }] }]));
    expect(formatCplist(l)).toBe('1 5.0 Title\n2 13.6 Next');
  });
});

// Random talks: 1..60 beats in up to 6 chapters, random explicit or seeded holds.
const arbTalk = fc.record({
  pad: fc.double({ min: 0.1, max: 3, noNaN: true }),
  chapters: fc.array(fc.array(fc.record({ hold: fc.option(fc.double({ min: 0.1, max: 12, noNaN: true }), { nil: undefined }), end: fc.double({ min: 0, max: 10, noNaN: true }) }), { minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 6 }),
});
function build(t: { pad: number; chapters: { hold: number | undefined; end: number }[][] }) {
  const ends: Record<string, number> = {};
  const chs = t.chapters.map((bs, ci) => ({ id: `c${ci}`, beats: bs.map((b, bi) => { ends[`c${ci}.b${bi}`] = b.end; return { id: `b${bi}`, ...(b.hold !== undefined ? { hold: b.hold } : {}) }; }) }));
  return { s: spine(chs, { defaults: { holdPad: t.pad } }), ends };
}

describe('layout (properties)', () => {
  it('(a) holds strictly increase, (b) each beat starts at the previous hold, (c) markers at first start + 0.1', () => {
    fc.assert(fc.property(arbTalk, (t) => {
      const { s, ends } = build(t);
      const l = layout(s, ends);
      l.beats.forEach((b, i) => {
        if (i) { expect(b.at).toBeGreaterThan(l.beats[i - 1]!.at); expect(b.start).toBe(l.beats[i - 1]!.at); } else expect(b.start).toBe(0);
      });
      l.chapters.forEach((c, i) => {
        const first = l.beats.find((b) => b.chapter === c.id)!;
        expect(c.at).toBe(i === 0 ? 0 : r6(first.start + 0.1));
      });
    }));
  });

  it('(d) inserting a beat leaves every other beat unchanged relative to its own start', () => {
    fc.assert(fc.property(arbTalk, fc.nat(), fc.double({ min: 0.1, max: 9, noNaN: true }), (t, pos, hold) => {
      const { s, ends } = build(t);
      const before = layout(s, ends);
      const ch = s.chapters[pos % s.chapters.length]!;
      ch.beats.splice(pos % (ch.beats.length + 1), 0, { id: 'new', label: 'new', hold });
      const after = layout(s, ends);
      const rel = (l: typeof before) => l.beats.filter((b) => !b.id.endsWith('.new')).map((b) => [b.id, b.hold, b.lastEnd, b.at - b.start]);
      const close = (a: ReturnType<typeof rel>, b: ReturnType<typeof rel>) => a.forEach((x, i) => { expect(x[0]).toBe(b[i]![0]); expect(x[1]).toBe(b[i]![1]); expect(x[2]).toBe(b[i]![2]); expect(x[3] as number).toBeCloseTo(b[i]![3] as number, 6); });
      close(rel(after), rel(before));
    }));
  });

  it('(e) layout is idempotent: writing the computed holds back gives the same layout', () => {
    fc.assert(fc.property(arbTalk, (t) => {
      const { s, ends } = build(t);
      const l1 = layout(s, ends);
      for (const ch of s.chapters) for (const b of ch.beats) b.hold = l1.beats.find((x) => x.id === `${ch.id}.${b.id}`)!.hold;
      const l2 = layout(s, ends);
      expect(l2.beats.map((b) => b.at)).toEqual(l1.beats.map((b) => b.at));
      expect(layout(s, ends)).toEqual(l2);
    }));
  });
});
