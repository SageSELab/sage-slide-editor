// talk.edit / talk.revert on a temp copy of fixtures/issta26, through Session with the real
// core and the real watcher: every op writes, rebuilds and is labelled 'app'; every inverse
// restores the files byte for byte; a stale inverse is refused.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyInverse, sha256 } from '../src/edit.ts';
import { ErrorCode, editResultCheckers, type BuiltParams, type ChangedParams, type EditParams, type EditResult } from '../src/protocol.ts';
import { sageCore } from '../src/sage-core.ts';
import { Session } from '../src/session.ts';
import { eventually, tempTalk } from './helpers.ts';

const SOURCES = (root: string) => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name), rel = path.relative(root, abs).split(path.sep).join('/');
      if (/^(build|\.sage)(\/|$)/.test(rel)) continue;
      if (e.isDirectory()) walk(abs); else if (!/\.(png|jpe?g|woff2?)$/.test(e.name)) out[rel] = fs.readFileSync(abs, 'utf8');
    }
  };
  walk(root);
  return out;
};

describe('talk.edit on a temp copy', () => {
  let t: ReturnType<typeof tempTalk>;
  let s: Session;
  const changed: ChangedParams[] = [];
  const built: BuiltParams[] = [];
  beforeAll(async () => {
    t = tempTalk();
    s = new Session({ changed: (p) => changed.push(p), built: (p) => built.push(p) }, sageCore, () => {}, 60);
    await s.open({ path: t.root });
    await new Promise((r) => setTimeout(r, 300)); // FSEvents tail of the copy
  }, 60_000);
  afterAll(async () => { await s.close(); t.cleanup(); });

  const cases: { name: string; p: EditParams; check: (r: EditResult, root: string) => void }[] = [
    { name: 'setText', p: { op: 'setText', args: { id: 't-g', html: 'How far <b>are</b> we?' } },
      check: (_r, root) => expect(fs.readFileSync(path.join(root, 'scenes/line.html'), 'utf8')).toContain('>How far <b>are</b> we?</h1>') },
    { name: 'setStyle', p: { op: 'setStyle', args: { id: 'c1-bench', style: { top: 870, height: 150, fontSize: 30 } } },
      check: (_r, root) => expect(fs.readFileSync(path.join(root, 'scenes/line.html'), 'utf8')).toContain('style="position:absolute;left:120px;top:870px;width:1500px;height:150px;font-size:30px"') },
    { name: 'setAttr', p: { op: 'setAttr', args: { id: 'c1-eye', name: 'title', value: 'APR' } },
      check: (_r, root) => expect(fs.readFileSync(path.join(root, 'scenes/line.html'), 'utf8')).toContain('id="c1-eye" data-a style="position:absolute;left:120px;top:110px" title="APR"') },
    { name: 'insertBeat', p: { op: 'insertBeat', args: { chapter: 'line', index: 1, beat: { id: 'beat-1', label: 'New beat', hold: 2 } } },
      check: (r) => { expect(r.changed).toEqual(['beats/line.js', 'talk.json']); expect(r.holds?.[1]).toMatchObject({ beat: 'line.beat-1', at: 7 }); } },
    { name: 'duplicateBeat', p: { op: 'duplicateBeat', args: { ref: 'line.title', newId: 'title-2' } },
      check: (r) => expect(r.holds?.[1]).toMatchObject({ beat: 'line.title-2', at: 10 }) },
    { name: 'moveBeat', p: { op: 'moveBeat', args: { ref: 'line.fifteen', chapter: 'line', index: 0 } },
      check: (r) => expect(r.holds?.[0]?.beat).toBe('line.fifteen') },
    { name: 'deleteBeat', p: { op: 'deleteBeat', args: { ref: 'line.fifteen' } },
      check: (r) => expect(r.holds?.some((h) => h.beat === 'line.fifteen')).toBe(false) },
    { name: 'setHold', p: { op: 'setHold', args: { ref: 'line.title', hold: 5.5 } },
      check: (r) => expect(r.holds?.[0]?.at).toBe(5.5) },
    { name: 'setNotes', p: { op: 'setNotes', args: { ref: 'line.title', notes: 'Shorter notes.' } },
      check: (_r, root) => expect(JSON.parse(fs.readFileSync(path.join(root, 'talk.json'), 'utf8')).chapters[0].beats[0].notes).toBe('Shorter notes.') },
    { name: 'stretchBeat', p: { op: 'stretchBeat', args: { ref: 'line.title', factor: 2 } },
      check: (r) => { expect(r.holds?.[0]?.at).toBe(10); if (r.inverse.patches.length && r.stretch) { expect(r.stretch.stretched).toBeGreaterThan(3); expect(r.stretch.skipped.length).toBeGreaterThan(0); } } },
    { name: 'setBeat', p: { op: 'setBeat', args: { ref: 'line.title', props: { label: 'Opening', backup: true } } },
      check: (r) => expect(r.holds?.[0]).toMatchObject({ label: 'Opening', backup: true }) },
    { name: 'setChapter', p: { op: 'setChapter', args: { chapter: 'line', props: { label: 'The line (renamed)', dark: true } } },
      check: (_r, root) => expect(JSON.parse(fs.readFileSync(path.join(root, 'talk.json'), 'utf8')).chapters[0]).toMatchObject({ label: 'The line (renamed)', dark: true }) },
  ];

  it.each(cases)('$name: writes as the app, rebuilds, and the inverse restores every byte', async ({ p, check }) => {
    const before = SOURCES(t.root);
    const nChanged = changed.length, nBuilt = built.length;
    const r = await s.edit(p);
    expect(editResultCheckers['talk.edit'](r)).toEqual([]);
    if (p.op === 'stretchBeat') expect(r.stretch?.stretched).toBeGreaterThan(3);
    expect(r.ok).toBe(true);
    expect(r.changed.length).toBeGreaterThan(0);
    for (const f of r.changed) expect(r.inverse.digests[f]).toBe(sha256(fs.readFileSync(path.join(t.root, f))));
    expect(built.slice(nBuilt).map((b) => b.trigger)).toEqual(['edit']);
    check(r, t.root);
    const note = await eventually(() => changed.slice(nChanged).find((c) => r.changed.every((f) => c.paths.includes(f))), 8000, 'talk.changed');
    expect(note.source).toBe('app');

    const back = await s.revert(r.inverse);
    expect(SOURCES(t.root)).toEqual(before);
    expect(back.changed).toEqual(r.changed);
    await eventually(() => changed.slice(nChanged).filter((c) => c.source === 'app').length >= 2, 8000, 'revert talk.changed');
    expect(changed.slice(nChanged).every((c) => c.source === 'app')).toBe(true);
    // redo: the revert's inverse re-applies the edit
    const redo = await s.revert(back.inverse);
    check(redo, t.root);
    await s.revert(redo.inverse);
    expect(SOURCES(t.root)).toEqual(before);
    await new Promise((r2) => setTimeout(r2, 250)); // let the watcher drain before the next case
    expect(built.slice(nBuilt).every((b) => b.trigger === 'edit')).toBe(true);
  }, 30_000);

  it('an edit that changes nothing writes nothing and does not build', async () => {
    const nBuilt = built.length;
    const r = await s.edit({ op: 'setStyle', args: { id: 'c1-eye', style: { left: 120 } } });
    expect(r).toEqual({ inverse: { patches: [], digests: {} }, changed: [], ok: true, diagnostics: [] });
    expect(built.length).toBe(nBuilt);
  });

  it('refuses a stale inverse (conflict) and leaves the external edit alone', async () => {
    const r = await s.edit({ op: 'setText', args: { id: 'c1-eye', html: 'Sixteen years' } });
    const scene = path.join(t.root, 'scenes/line.html');
    const external = fs.readFileSync(scene, 'utf8').replace('Sixteen years', 'Seventeen years');
    fs.writeFileSync(scene, external);
    await expect(s.revert(r.inverse)).rejects.toMatchObject({ code: ErrorCode.EditConflict, data: { files: ['scenes/line.html'] } });
    expect(fs.readFileSync(scene, 'utf8')).toBe(external);
    const ext = await eventually(() => changed.find((c) => c.source === 'external' && c.paths.includes('scenes/line.html')), 8000, 'external change');
    expect(ext.source).toBe('external');
  });

  it('reports core errors as EditFailed with the core code', async () => {
    await expect(s.edit({ op: 'setText', args: { id: 'c1-dots', html: 'x' } })).rejects.toMatchObject({ code: ErrorCode.EditFailed, data: { code: 'no-element' } });
    await expect(s.edit({ op: 'setHold', args: { ref: 'line.nope', hold: 1 } })).rejects.toMatchObject({ code: ErrorCode.EditFailed, data: { code: 'no-beat' } });
    await expect(s.edit({ op: 'setText', args: { id: 'c1-eye', html: 'x', scene: 'scenes/nope.html' } })).rejects.toMatchObject({ code: ErrorCode.EditFailed, data: { code: 'no-scene' } });
  });

  it('refuses inverses that reach outside the talk or lack digests', () => {
    expect(() => applyInverse(t.root, null, { patches: [{ file: '../x.html', range: [0, 0], newText: 'x' }], digests: { '../x.html': 'a'.repeat(64) } })).toThrow(/not a source file/);
    expect(() => applyInverse(t.root, null, { patches: [{ file: 'build/index.html', range: [0, 0], newText: 'x' }], digests: { 'build/index.html': 'a'.repeat(64) } })).toThrow(/not a source file/);
    expect(() => applyInverse(t.root, null, { patches: [{ file: 'talk.json', range: [0, 0], newText: 'x' }], digests: {} })).toThrow(/no digest/);
  });
});
