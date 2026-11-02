// Beat edits on talk.json + motion files. A model check: every operation's result parses to
// exactly what the same operation does to the plain object (key order included), keeps the
// file canonically formatted, and inverts byte-for-byte.
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deleteBeat, duplicateBeat, insertBeat, moveBeat, setBeatProps, setChapterProps, setHold, setNotes, spineSources, type SpineSources } from '../src/edit-spine.ts';
import { loadTalk, loadTalkFrom, memoryHost, talkFiles } from '../src/load.ts';
import { applyToTexts, type Edit } from '../src/patch.ts';
import { recordTalk } from '../src/record.ts';
import { validateTalk } from '../src/validate.ts';
import { ISSTA } from './helpers.ts';

type Spine = { chapters: { id: string; beats: Record<string, unknown>[] }[] };
const fixture = () => { const t = loadTalk(ISSTA); return { t, texts: Object.fromEntries(talkFiles(t).map((f) => [f.path, f.text])) }; };

function roundTrip(texts: Record<string, string>, e: Edit) {
  const out = applyToTexts(texts, e.patches);
  const back = applyToTexts(out, e.inverse);
  for (const f of Object.keys(texts)) expect(back[f]).toBe(texts[f]);
  // every patch's bytes outside its range are untouched
  for (const p of e.patches) {
    const before = texts[p.file]!, after = out[p.file]!;
    if (e.patches.filter((q) => q.file === p.file).length === 1) {
      expect(after.slice(0, p.range[0])).toBe(before.slice(0, p.range[0]));
      expect(after.slice(p.range[0] + p.newText.length)).toBe(before.slice(p.range[1]));
    }
  }
  return out;
}

const canonical = (text: string) => JSON.stringify(JSON.parse(text), null, 2) + '\n';

describe('beat edits on the ISSTA fixture (model check, property)', () => {
  const { t, texts } = fixture();
  const src = spineSources(t);
  const model = JSON.parse(texts['talk.json']!) as Spine;
  const refs = model.chapters.flatMap((c) => c.beats.map((b, i) => ({ ch: c.id, id: b.id as string, i })));
  const chIds = model.chapters.map((c) => c.id);
  type Op = { name: string; run: (s: SpineSources) => Edit; apply: (m: Spine) => void };
  const ref = fc.constantFrom(...refs);
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.tuple(ref, fc.option(fc.double({ min: 0, max: 30, noNaN: true }).map((v) => +v.toFixed(3)), { nil: null })).map(([r, h]): Op => ({
      name: `setHold ${r.ch}.${r.id} ${h}`, run: (s) => setHold(s, `${r.ch}.${r.id}`, h),
      apply: (m) => { const b = m.chapters.find((c) => c.id === r.ch)!.beats[r.i]!; if (h === null) delete b.hold; else b.hold = h; },
    })),
    fc.tuple(ref, fc.option(fc.string({ maxLength: 20 }), { nil: null })).map(([r, n]): Op => ({
      name: `setNotes ${r.ch}.${r.id}`, run: (s) => setNotes(s, `${r.ch}.${r.id}`, n),
      apply: (m) => { const b = m.chapters.find((c) => c.id === r.ch)!.beats[r.i]!; if (n === null) delete b.notes; else b.notes = n; },
    })),
    fc.tuple(fc.constantFrom(...chIds), fc.nat(20)).map(([ch, k]): Op => ({
      name: `insertBeat ${ch} ${k}`, run: (s) => insertBeat(s, ch, k % (model.chapters.find((c) => c.id === ch)!.beats.length + 1), { id: 'zz-new', label: 'New "beat"', hold: 2 }),
      apply: (m) => { const bs = m.chapters.find((c) => c.id === ch)!.beats; bs.splice(k % (bs.length + 1), 0, { id: 'zz-new', label: 'New "beat"', hold: 2 }); },
    })),
    ref.map((r): Op => ({
      name: `deleteBeat ${r.ch}.${r.id}`, run: (s) => deleteBeat(s, `${r.ch}.${r.id}`),
      apply: (m) => { m.chapters.find((c) => c.id === r.ch)!.beats.splice(r.i, 1); },
    })),
    ref.map((r): Op => ({
      name: `duplicateBeat ${r.ch}.${r.id}`, run: (s) => duplicateBeat(s, `${r.ch}.${r.id}`, 'zz-copy'),
      apply: (m) => { const bs = m.chapters.find((c) => c.id === r.ch)!.beats; bs.splice(r.i + 1, 0, { ...bs[r.i]!, id: 'zz-copy' }); },
    })),
    fc.tuple(ref, fc.constantFrom(...chIds), fc.nat(20)).map(([r, to, k]): Op => ({
      name: `moveBeat ${r.ch}.${r.id} -> ${to}@${k}`,
      run: (s) => moveBeat(s, `${r.ch}.${r.id}`, to, k % (model.chapters.find((c) => c.id === to)!.beats.length + (to === r.ch ? 0 : 1))),
      apply: (m) => {
        const from = m.chapters.find((c) => c.id === r.ch)!.beats, [b] = from.splice(r.i, 1);
        const dst = m.chapters.find((c) => c.id === to)!.beats;
        dst.splice(k % (dst.length + (to === r.ch ? 1 : 1)), 0, b!);
      },
    })),
  );

  it('result == model, canonical formatting kept, inverse restores', () => {
    expect(canonical(texts['talk.json']!)).toBe(texts['talk.json']);
    fc.assert(fc.property(op, (o) => {
      const exp = structuredClone(model);
      let e: Edit;
      try { e = o.run(src); } catch (err) {
        // a cross-chapter move into a chapter that already has that beat id is refused
        expect((err as Error).message).toMatch(/exists/);
        return;
      }
      o.apply(exp);
      const out = roundTrip(texts, e);
      expect(JSON.stringify(JSON.parse(out['talk.json']!)), o.name).toBe(JSON.stringify(exp));
      expect(out['talk.json']).toBe(canonical(out['talk.json']!));
    }), { numRuns: 200 });
  });
});

describe('beat edits and motion files', () => {
  const { t, texts } = fixture();
  const src = spineSources(t);
  const reload = (files: Record<string, string>) => {
    const extra = fs.readdirSync(path.join(ISSTA, 'assets'), { recursive: true }).map((p) => path.posix.join('assets', String(p)));
    return loadTalkFrom(memoryHost(files, extra));
  };

  it('insertBeat adds a Talk.beat stub after the previous beat\'s registration', () => {
    const e = insertBeat(src, 'line', 1, { id: 'extra', label: 'Extra', notes: 'x' });
    const out = roundTrip(texts, e);
    const js = out['beats/line.js']!;
    expect(js.indexOf("Talk.beat('line.extra'")).toBeGreaterThan(js.indexOf("Talk.beat('line.title'"));
    expect(js.indexOf("Talk.beat('line.extra'")).toBeLessThan(js.indexOf("Talk.beat('line.fifteen'"));
    const r = recordTalk(reload(out));
    expect(r.beats.get('line.extra')).toMatchObject({ registered: true, lastEnd: 0 });
    expect(r.layout.beats.find((b) => b.id === 'line.extra')).toMatchObject({ auto: true, hold: 0.3 });
  });

  it('deleteBeat removes the spine entry and the registration; the talk still validates', () => {
    const out = roundTrip(texts, deleteBeat(src, 'phone.layout'));
    expect(out['beats/phone.js']).not.toContain("'phone.layout'");
    const ds = validateTalk(reload(out));
    expect(ds.filter((d) => d.code === 'beat-not-in-spine' || d.code === 'beat-no-motion' || d.code === 'script-syntax')).toEqual([]);
  });

  it('duplicateBeat copies the registration under the new id with identical motion', () => {
    const out = roundTrip(texts, duplicateBeat(src, 'line.title', 'title2', 'Title again'));
    const r = recordTalk(reload(out));
    expect(r.beats.get('line.title2')!.lastEnd).toBe(r.beats.get('line.title')!.lastEnd);
    expect(JSON.parse(out['talk.json']!).chapters[0].beats[1]).toMatchObject({ id: 'title2', label: 'Title again' });
  });

  it('moveBeat across chapters moves and renames the registration; its motion is unchanged', () => {
    const before = recordTalk(t).beats.get('line.never')!;
    const out = roundTrip(texts, moveBeat(src, 'line.never', 'phone', 0));
    expect(out['beats/line.js']).not.toContain("'line.never'");
    expect(out['beats/phone.js']).toContain("Talk.beat('phone.never'");
    const after = recordTalk(reload(out)).beats.get('phone.never')!;
    expect(after.lastEnd).toBe(before.lastEnd);
    expect(after.start).toBe(before.start); // first beat of the next chapter = same position
  });

  it('refuses bad input with stable codes', () => {
    expect(() => insertBeat(src, 'line', 0, { id: 'title', label: 'x' })).toThrow(/exists/);
    expect(() => insertBeat(src, 'nope', 0, { id: 'q', label: 'x' })).toThrow(/no chapter/);
    expect(() => setHold(src, 'line.nope', 1)).toThrow(/no beat/);
    expect(() => setHold(src, 'line.title', -1)).toThrow(/non-negative/);
    expect(() => moveBeat(src, 'line.title', 'line', 99)).toThrow(/out of range/);
  });
});

describe('beat edits on odd formatting', () => {
  const odd = `{"format":"sage-talk/1","title":"T",
    "chapters": [ { "id": "a", "label": "A",
        "beats": [{"id":"x","label":"X","hold":1}, {"id":"y","label":"Y"}] },
      {"id":"b","label":"B","beats":[]} ] }`;
  const src: SpineSources = { spine: { path: 'talk.json', text: odd } };
  const texts = { 'talk.json': odd };
  it('setHold on a single-line object keeps it single-line', () => {
    const out = roundTrip(texts, setHold(src, 'a.y', 2.5));
    expect(out['talk.json']).toContain('{"id":"y","label":"Y", "hold":2.5}');
    expect(roundTrip(texts, setHold(src, 'a.x', 3))['talk.json']).toContain('"hold":3}');
  });
  it('moveBeat between a single-line array and an empty one', () => {
    const out = roundTrip(texts, moveBeat(src, 'a.x', 'b', 0));
    expect(JSON.parse(out['talk.json']!).chapters.map((c: { beats: { id: string }[] }) => c.beats.map((b) => b.id))).toEqual([['y'], ['x']]);
    expect(out['talk.json']!.startsWith('{"format":"sage-talk/1","title":"T",\n    "chapters": [ { "id": "a", "label": "A",\n        "beats": [{"id":"y","label":"Y"}] }')).toBe(true);
  });
  it('setNotes removes and adds members without touching the rest', () => {
    const out = roundTrip(texts, setNotes(src, 'a.x', 'He said "hi" — ok'));
    expect(JSON.parse(out['talk.json']!).chapters[0].beats[0].notes).toBe('He said "hi" — ok');
  });
});

describe('setBeatProps and setChapterProps', () => {
  const odd = `{"format":"sage-talk/1","title":"T",
    "chapters": [ { "id": "a", "label": "A", "dark": true,
        "beats": [{"id":"x","label":"X","hold":1}, {"id":"y","label":"Y", "backup": true}] },
      {"id":"b","label":"B","beats":[]} ] }`;
  const src: SpineSources = { spine: { path: 'talk.json', text: odd } };
  const texts = { 'talk.json': odd };
  type Parsed = { chapters: (Record<string, unknown> & { beats: Record<string, unknown>[] })[] };
  const parsed = (t: Record<string, string>) => JSON.parse(t['talk.json']!) as Parsed;
  it('sets a label and adds a flag in one edit, inverse restores', () => {
    const out = roundTrip(texts, setBeatProps(src, 'a.x', { label: 'Ex "1"', backup: true }));
    expect(parsed(out).chapters[0]!.beats[0]).toEqual({ id: 'x', label: 'Ex "1"', hold: 1, backup: true });
    expect(out['talk.json']).toContain('{"id":"x","label":"Ex \\"1\\"","hold":1, "backup":true}');
  });
  it('removes a flag with null and leaves the rest of the object alone', () => {
    const out = roundTrip(texts, setBeatProps(src, 'a.y', { backup: null }));
    expect(out['talk.json']).toContain('{"id":"y","label":"Y"}');
  });
  it('sets chapter label, dark and private', () => {
    const out = roundTrip(texts, setChapterProps(src, 'a', { label: 'Alpha', dark: null, private: true }));
    const ch = parsed(out).chapters[0]!;
    expect([ch.label, ch.dark, ch.private]).toEqual(['Alpha', undefined, true]);
    expect(roundTrip(texts, setChapterProps(src, 'b', { dark: true }))['talk.json']).toContain('{"id":"b","label":"B","beats":[], "dark":true}');
  });
  it('no-op edits are empty; bad input has stable codes', () => {
    expect(setBeatProps(src, 'a.x', { label: 'X' }).patches).toEqual([]);
    expect(() => setBeatProps(src, 'a.x', { hold: 2 } as never)).toThrow(expect.objectContaining({ code: 'bad-prop' }));
    expect(() => setBeatProps(src, 'a.x', { backup: 'yes' } as never)).toThrow(expect.objectContaining({ code: 'bad-value' }));
    expect(() => setChapterProps(src, 'zz', { dark: true })).toThrow(expect.objectContaining({ code: 'no-chapter' }));
    expect(() => setBeatProps(src, 'a.zz', { dark: true })).toThrow(expect.objectContaining({ code: 'no-beat' }));
  });
  it('round trips on the ISSTA fixture', () => {
    const { t, texts: tx } = fixture();
    const s = spineSources(t);
    roundTrip(tx, setBeatProps(s, 'line.title', { label: 'Opening', dark: true }));
    roundTrip(tx, setChapterProps(s, 'line', { label: 'The line, renamed', private: true }));
  });
});
