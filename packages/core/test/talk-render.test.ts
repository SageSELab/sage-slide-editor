// validate --render: the second ghost clause (PLAN 3.1) — a data-a element visible at a hold
// that no beat has brought in — checked in headless Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import { loadTalk } from '../src/load.ts';
import { elementKey } from '../src/record.ts';
import { validateRendered } from '../src/talk-render.ts';
import { parseHTML } from 'linkedom';
import { ISSTA } from './helpers.ts';

const tmps: string[] = [];
afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

/** A two-beat talk on disk; `y` runs at hold 1 (t = 2), hold 2 is t = 4. */
function talk(scene: string, motion: { x?: string; y?: string } = {}, extra: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkc-ghost-'));
  tmps.push(dir);
  const files: Record<string, string> = {
    'talk.json': JSON.stringify({ format: 'sage-talk/1', title: 'G', lib: extra['lib/gen.js'] ? ['lib/gen.js'] : [], chapters: [{ id: 'c', label: 'C', scene: 'scenes/c.html', beats: [{ id: 'x', label: 'X', notes: 'n', hold: 2 }, { id: 'y', label: 'Y', notes: 'n', hold: 2 }] }] }, null, 2),
    'scenes/c.html': scene,
    'beats/c.js': `Talk.beat('c.x', (B) => { ${motion.x ?? "B.in('#a', 0, { dur: 0.5 });"} });\nTalk.beat('c.y', (B) => { ${motion.y ?? ''} });\n`,
    ...extra,
  };
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); }
  return dir;
}
const check = async (dir: string, pub = false) => validateRendered(loadTalk(dir), { public: pub });
const A = '<h1 id="a" data-a style="position:absolute;left:100px;top:100px">A</h1>';

describe('elementKey', () => {
  it('nearest id, then child indices; stage-rooted without an id', () => {
    const { document } = parseHTML('<div class="stage"><div id="s"><p><i></i><b data-a></b></p></div><div><u></u></div></div>');
    const stage = document.querySelector('.stage')!;
    expect(elementKey(document.querySelector('b')!, stage)).toBe('#s/0/1');
    expect(elementKey(document.querySelector('#s')!, stage)).toBe('#s');
    expect(elementKey(document.querySelector('u')!, stage)).toBe('/1/0');
  });
});

describe('ghost-visible', () => {
  it('negative: a later beat whose first opacity keyframe is visible fills backwards into the earlier hold', async () => {
    const dir = talk(`<div class="scene" id="s">${A}\n<h2 id="g" data-a style="position:absolute;left:100px;top:300px">G</h2></div>`, { y: "B.anim('#g', 0, 1, [{ opacity: 1 }, { opacity: 0 }]);" });
    const ds = await check(dir);
    expect(ds).toMatchObject([{ code: 'ghost-visible', severity: 'error', file: 'scenes/c.html', line: 2, col: 1, beat: 'c.x', message: '#g is visible at hold 1 "X" (t=2, opacity 1) but no beat has brought it in yet' }]);
  }, 60_000);

  it('negative: a theme rule overriding [data-a] shows an element no beat touches, at every hold', async () => {
    const dir = talk(`<div class="scene" id="s">${A}<p id="t" data-a style="position:absolute;left:100px;top:400px">T</p></div>`, {}, { 'theme.css': '#t { opacity: 1; }' });
    const ds = await check(dir);
    expect(ds.map((d) => d.message)).toEqual(['#t is visible at hold 1 "X" (t=2, opacity 1) but no beat has brought it in yet; visible at 2 holds']);
  }, 60_000);

  it('negative: generated DOM without an id is reported by its key', async () => {
    const dir = talk(`<div class="scene" id="s">${A}<div id="box" style="position:absolute;left:300px;top:300px"></div></div>`, {},
      { 'lib/gen.js': "const i = document.createElement('i'); i.setAttribute('data-a', ''); i.textContent = 'x'; i.style.cssText = 'display:block;opacity:1'; document.getElementById('box').appendChild(i);" });
    expect((await check(dir)).map((d) => [d.code, d.message.split(' is visible')[0], d.file])).toEqual([['ghost-visible', 'the data-a element at #box/0', undefined]]);
  }, 60_000);

  it('positive: elements brought in before the hold, hidden by an ancestor, or off the stage are fine', async () => {
    const dir = talk(`<div class="scene" id="s">${A}<p id="late" data-a style="position:absolute;left:100px;top:500px">L</p></div>
<div class="scene" id="z" style="opacity:0"><p id="q" data-a style="opacity:1">hidden by its scene</p></div>
<div class="scene" id="o"><p id="far" data-a style="position:absolute;left:2400px;top:10px;opacity:1">off stage</p><p id="v" data-a style="visibility:hidden;opacity:1">invisible</p></div>`,
    { x: "B.in('#a', 0, { dur: 0.5 }); B.anim('#late', 0.2, 0.5, [{ opacity: 1 }, { opacity: 1 }]);", y: "B.out('#a', 0); B.in('#late', 0.5);" });
    expect(await check(dir)).toEqual([]);
  }, 60_000);

  it('the real deck has no visible ghost, presented or public', async () => {
    const t = loadTalk(ISSTA);
    expect(await validateRendered(t)).toEqual([]);
    expect(await validateRendered(t, { public: true })).toEqual([]);
  }, 120_000);
});

describe('talkc validate --render', () => {
  const io = () => { const o = { out: [] as string[], err: [] as string[] }; return { o, io: { out: (s: string) => o.out.push(s), err: (s: string) => o.err.push(s) } }; };
  it('off by default; exit 1 on a ghost; skipped when static errors exist', async () => {
    const dir = talk(`<div class="scene" id="s">${A}<h2 id="g" data-a>G</h2></div>`, { y: "B.anim('#g', 0, 1, [{ opacity: 1 }, { opacity: 0 }]);" });
    expect(await main(['validate', dir], io().io)).toBe(0);
    const a = io();
    expect(await main(['validate', dir, '--render'], a.io)).toBe(1);
    expect(a.o.out).toEqual([expect.stringMatching(/^scenes\/c\.html:1:\d+: error ghost-visible: #g is visible at hold 1 "X"/), '1 errors, 0 warnings, 0 infos']);
    const b = io();
    expect(await main(['validate', dir, '--render', '--json'], b.io)).toBe(1);
    expect(JSON.parse(b.o.out[0]!)).toMatchObject({ ok: false, diagnostics: [{ code: 'ghost-visible' }] });
    fs.writeFileSync(path.join(dir, 'beats/c.js'), "Talk.beat('c.x', (B) => { B.in('#a', -1); });");
    const c = io();
    expect(await main(['validate', dir, '--render'], c.io)).toBe(1);
    expect(c.o.err).toEqual(['talkc: render checks skipped: fix the errors first']);
  }, 60_000);
});
