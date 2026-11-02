// @sage/render against the golden harness: frames rendered by seeking one long-lived page must
// be byte-identical to tests/golden/shoot.mjs (a fresh `?t=T&capture` load per frame) in
// Playwright Chromium, on five holds of the real ISSTA fixture.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameName, openFilm, planFrames, Renderer, shootFilm, type Film } from '../src/index.ts';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const PKG = path.resolve(HERE, '..');
let tmp = '', html = '', renderer: Renderer, film: Film;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-render-'));
  await run(process.execPath, [path.join(REPO, 'packages/core/src/cli.ts'), 'build', path.join(REPO, 'fixtures/issta26'), '--out', path.join(tmp, 'build')]);
  html = path.join(tmp, 'build/index.html');
  renderer = await Renderer.launch();
  film = await renderer.openFilm(html);
}, 120_000);
afterAll(async () => {
  await film?.close(); await renderer?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('openFilm', () => {
  it('reads the holds and duration from the page', () => {
    const h = film.holds();
    expect(h.length).toBe(61);
    expect(h[0]).toEqual({ index: 1, at: 5, label: 'Title', backup: false, id: 'line.title' });
    expect(h.filter((x) => x.backup).length).toBe(8);
    expect(film.duration).toBeGreaterThan(h.at(-1)!.at);
  });

  it('frames are 1920x1080 PNGs, deterministic across seek order', async () => {
    const a = await film.frame(36);
    await film.frame(200);
    const b = await film.frame(36);
    const png = PNG.sync.read(a);
    expect([png.width, png.height]).toEqual([1920, 1080]);
    expect(Buffer.compare(a, b)).toBe(0);
    expect(film.errors()).toEqual([]);
  }, 60_000);

  it('a missing file is an error, and a private renderer closes with its film', async () => {
    await expect(openFilm(path.join(tmp, 'nope.html'), { renderer })).rejects.toThrow(/no such film/);
    const f = await openFilm(html);
    expect(f.holds().length).toBe(61);
    await f.close();
  }, 60_000);
});

describe('planFrames', () => {
  const holds = [{ index: 1, at: 5, label: 'A', backup: false, id: 'c.a' }, { index: 2, at: 9, label: 'B', backup: true, id: 'c.b' }];
  it('holds, around, times, beats; deduplicated, clamped and sorted', () => {
    const p = planFrames(holds, 10, { holds: true, around: 0.5, times: [9, 12], beats: ['c.a'] });
    expect(p.map((f) => [f.file, f.kind])).toEqual([['t0004.500.png', 'before'], ['t0005.000.png', 'hold'], ['t0005.500.png', 'after'], ['t0008.500.png', 'before'], ['t0009.000.png', 'hold'], ['t0009.500.png', 'after'], ['t0010.000.png', 'time']]);
    expect(planFrames(holds, 10, { holds: true, backups: false }).length).toBe(1);
    expect(() => planFrames(holds, 10, { beats: ['c.zz'] })).toThrow(/no beat/);
    expect(frameName(244.8)).toBe('t0244.800.png');
  });
});

describe('byte-identical to tests/golden/shoot.mjs (Chromium)', () => {
  it('five holds of fixtures/issta26', async () => {
    const holds = film.holds();
    const pick = [1, 7, 20, 38, 49].map((i) => holds[i - 1]!.at); // title, exploded (3D), DroidFixBench, results, summary
    // shoot.mjs resolves `playwright` from its own folder; run a copy that sees this package's.
    const shootDir = path.join(PKG, 'node_modules/.golden');
    fs.mkdirSync(shootDir, { recursive: true });
    fs.copyFileSync(path.join(REPO, 'tests/golden/shoot.mjs'), path.join(shootDir, 'shoot.mjs'));
    const gold = path.join(tmp, 'golden'), ours = path.join(tmp, 'ours');
    await run(process.execPath, [path.join(shootDir, 'shoot.mjs'), html, '--engine', 'chromium', '--times', pick.join(','), '--out', gold], { timeout: 180_000 });
    const r = await shootFilm(html, ours, { renderer, times: pick });
    expect(r.frames.length).toBe(5);
    expect(new Set(r.frames.map((f) => fs.readFileSync(path.join(ours, f.file)).toString('base64'))).size).toBe(5); // not vacuous
    for (const f of r.frames) {
      const g = fs.readFileSync(path.join(gold, f.file)), o = fs.readFileSync(path.join(ours, f.file));
      expect(Buffer.compare(g, o), f.file).toBe(0);
    }
    const m = JSON.parse(fs.readFileSync(path.join(ours, 'manifest.json'), 'utf8'));
    expect(m).toMatchObject({ engine: 'chromium', method: 'seek', width: 1920, height: 1080 });
  }, 240_000);
});
