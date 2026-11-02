import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NotATalkError, stubCore } from '../src/core-port.ts';
import { FIXTURE, spineStats, tempTalk } from './helpers.ts';

describe('stub core port', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('lays out the ISSTA fixture with the Phase 0 hold list', async () => {
    const talk = await stubCore.load(FIXTURE);
    const lay = await stubCore.layout(talk);
    // The opening holds from the Phase 0 port; the rest of the fixture is still being ported.
    expect(lay.holds.map((h) => h.at).slice(0, 13)).toEqual([5, 13.5, 20.5, 27.5, 36, 41, 46, 51, 56.5, 60.5, 62.5, 64.5, 66.5]);
    const stats = spineStats(FIXTURE);
    expect(lay.holds).toHaveLength(stats.beats);
    expect(lay.holds.map((h) => h.index)).toEqual(lay.holds.map((_, i) => i + 1));
    expect(lay.holds[0]).toEqual({ index: 1, at: 5, label: 'Title', backup: false, beat: 'line.title', chapter: 'line', auto: false });
    if (stats.explicitDuration !== null) expect(lay.duration).toBeCloseTo(stats.explicitDuration, 6);
    expect(await stubCore.validate(talk)).toEqual([]);
  });

  it('rejects non-talks', async () => {
    await expect(stubCore.load(path.join(FIXTURE, 'scenes'))).rejects.toBeInstanceOf(NotATalkError);
  });

  it('compiles a temp copy, and reports a syntax error as a failed build', async () => {
    const t = tempTalk();
    cleanup = t.cleanup;
    const talk = await stubCore.load(t.root);
    const ok = await stubCore.compile(talk);
    expect(ok).toMatchObject({ ok: true, diagnostics: [] });
    expect(fs.existsSync(path.join(t.root, 'build/index.html'))).toBe(true);
    fs.appendFileSync(path.join(t.root, 'beats/line.js'), '\n}}}\n');
    const bad = await stubCore.compile(talk);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0]).toMatchObject({ severity: 'error', code: 'build-failed' });
    expect(bad.diagnostics[0]!.message).toMatch(/SyntaxError/);
  });

  it('reports missing referenced files without running the compiler', async () => {
    const t = tempTalk();
    cleanup = t.cleanup;
    fs.rmSync(path.join(t.root, 'scenes/phone.html'));
    const res = await stubCore.compile(await stubCore.load(t.root));
    expect(res.ok).toBe(false);
    expect(res.diagnostics).toEqual([expect.objectContaining({ code: 'missing-file', file: 'scenes/phone.html' })]);
  });
});
