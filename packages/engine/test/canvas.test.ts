// canvas.js in Playwright WebKit (PLAN 12.4): hit testing, drag with and without snapping,
// resize keeping the opposite edge, in-place text commit/cancel/refusal, keyboard-only
// operation, and the exact messages the host receives. A synthetic stage gives exact geometry;
// the compiled ISSTA fixture checks hit testing against real motion and text.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { webkit, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const SRC = path.join(REPO, 'packages/engine/src');
const CANVAS_JS = path.join(SRC, 'canvas.js');
const run = promisify(execFile);

type Msg = Record<string, unknown> & { type: string };
let browser: Browser;
let tmp = '';

const SYNTHETIC = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${path.join(SRC, 'talk.css')}">
<style>body{font-size:16px}</style></head><body>
<div class="film"><div class="stage">
  <div class="scene" id="s1">
    <div id="a" style="position:absolute;left:100px;top:100px;width:200px;height:100px;background:#c33"></div>
    <div id="b" style="position:absolute;left:600px;top:400px;width:300px;height:200px;background:#33c"></div>
    <div id="ghost" style="position:absolute;left:100px;top:100px;width:200px;height:100px;opacity:0;background:#3c3"></div>
    <h1 id="h" style="position:absolute;left:1000px;top:700px;font-size:60px;margin:0">Hello <b>bold</b> world</h1>
    <div id="blk" style="position:absolute;left:1000px;top:900px"><p style="margin:0">block child</p></div>
    <div style="position:absolute;left:1400px;top:300px"><span id="inner">static child</span></div>
    <div id="wrap" style="position:absolute;left:100px;top:600px;width:300px;height:100px"><span data-a>hidden</span></div>
  </div>
  <div id="black" style="position:absolute;inset:0;background:#000;opacity:0"></div>
</div></div>
<script>
  const stage = document.querySelector('.stage');
  const fit = () => { const s = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')'; };
  fit(); addEventListener('resize', fit);
  window.__clicks = 0; stage.addEventListener('click', () => window.__clicks++);
</script></body></html>`;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-canvas-'));
  fs.writeFileSync(path.join(tmp, 'synthetic.html'), SYNTHETIC);
  await run(process.execPath, [path.join(REPO, 'packages/core/src/cli.ts'), 'build', path.join(REPO, 'fixtures/issta26'), '--out', path.join(tmp, 'build')]);
  browser = await webkit.launch();
});
afterAll(async () => {
  await browser?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** Opens a page with canvas.js enabled; messages are collected in window.__msgs. */
async function open(file: string, { width = 1920, height = 1080 } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('file://' + file);
  await page.waitForFunction(() => !!document.querySelector('.stage'));
  if (file.includes('/build/')) await page.waitForFunction(() => !!(window as any).T?.cps?.length);
  await page.addScriptTag({ path: CANVAS_JS });
  await page.evaluate(() => {
    (window as any).__msgs = [];
    (window as any).SageCanvas.enable({ post: (m: unknown) => (window as any).__msgs.push(m), nudgeDelay: 50 });
  });
  return page;
}
const msgs = (p: Page): Promise<Msg[]> => p.evaluate(() => (window as any).__msgs.splice(0));
const hit = (p: Page, x: number, y: number) => p.evaluate(([x, y]) => (window as any).SageCanvas.hitTest(x, y), [x, y] as const);
/** Client point of a stage point. */
const at = (p: Page, x: number, y: number) => p.evaluate(([x, y]) => {
  const r = document.querySelector('.stage')!.getBoundingClientRect(), k = r.width / 1920;
  return { x: r.left + x * k, y: r.top + y * k };
}, [x, y] as const);
async function drag(p: Page, from: { x: number; y: number }, dx: number, dy: number, meta = false) {
  if (meta) await p.keyboard.down('Meta');
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 3 });
  await p.mouse.move(from.x + dx, from.y + dy, { steps: 3 });
  await p.mouse.up();
  if (meta) await p.keyboard.up('Meta');
}
const handle = (p: Page, h: string) => p.evaluate((h) => {
  const r = document.querySelector(`.sage-canvas-overlay .sc-h[data-h="${h}"]`)!.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, h);
const style = (p: Page, id: string) => p.evaluate((id) => {
  const s = document.getElementById(id)!.style;
  return { left: s.left, top: s.top, width: s.width, height: s.height };
}, id);

describe('hit testing', () => {
  it('picks the topmost visible object with an id, skipping invisible ones and backgrounds', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    expect(await hit(p, 150, 150)).toBe('a'); // #ghost is on top but at opacity 0; #black too
    expect(await hit(p, 700, 500)).toBe('b');
    expect(await hit(p, 1050, 730)).toBe('h'); // the <b> inside #h selects #h
    expect(await hit(p, 1010, 910)).toBe('blk'); // the <p> without an id selects its parent
    expect(await hit(p, 1410, 305)).toBe('inner');
    expect(await hit(p, 50, 1000)).toBeNull(); // empty stage: only the scene and the background
    expect(await hit(p, 150, 650)).toBeNull(); // #wrap draws nothing itself and its content is hidden
    await p.evaluate(() => { document.getElementById('black')!.style.opacity = '1'; document.getElementById('a')!.style.opacity = '0.04'; });
    expect(await hit(p, 150, 150)).toBeNull(); // #a below the threshold; #black is a background
    await p.close();
  });

  it('follows the film: an element that has faded out is not selected (compiled ISSTA)', async () => {
    const p = await open(path.join(tmp, 'build/index.html'));
    const center = (id: string) => p.evaluate((id) => {
      const r = document.getElementById(id)!.getBoundingClientRect(), s = document.querySelector('.stage')!.getBoundingClientRect(), k = s.width / 1920;
      return [(r.left + r.width / 2 - s.left) / k, (r.top + r.height / 2 - s.top) / k] as const;
    }, id);
    await p.evaluate(() => (window as any).T.seek(5)); // hold 1: the title
    const [tx, ty] = await center('t-g');
    expect(await hit(p, tx, ty)).toBe('t-g');
    await p.evaluate(() => (window as any).T.seek(13.5)); // hold 2: the title is gone
    expect(await hit(p, tx, ty)).not.toBe('t-g');
    const [ex, ey] = await center('c1-eye');
    expect(await hit(p, ex, ey)).toBe('c1-eye');
    await p.evaluate(() => (window as any).T.seek(0)); // before #c1-eye comes in
    expect(await hit(p, ex, ey)).not.toBe('c1-eye');
    await p.close();
  });
});

describe('selection, move and resize', () => {
  it('a click selects and reports the object; a stage click no longer advances the film', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    const pt = await at(p, 150, 150);
    await p.mouse.click(pt.x, pt.y);
    expect(await msgs(p)).toEqual([{ type: 'select', id: 'a', tag: 'div', left: 100, top: 100, width: 200, height: 100, fontSize: 16, movable: true, editable: false, html: null, src: null }]);
    expect(await p.evaluate(() => (window as any).__clicks)).toBe(0);
    const empty = await at(p, 50, 1000);
    await p.mouse.click(empty.x, empty.y);
    expect(await msgs(p)).toEqual([{ type: 'select', id: null }]);
    await p.close();
  });

  it('drag moves by the delta: grid snapping, object snapping with a guide, and Cmd for none', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    const from = await at(p, 150, 150);
    await drag(p, from, 37, 3);
    expect(await msgs(p)).toEqual([
      expect.objectContaining({ type: 'select', id: 'a' }),
      { type: 'move', id: 'a', left: 140, top: 100 }, // 137,103 -> 10 px grid
    ]);
    expect(await style(p, 'a')).toMatchObject({ left: '140px', top: '100px' });

    const from2 = await at(p, 190, 150);
    await drag(p, from2, 253, 0); // right edge 140+200+253 = 593, 7 px from #b's left edge
    expect(await msgs(p)).toEqual([{ type: 'move', id: 'a', left: 400, top: 100 }]);

    const from3 = await at(p, 450, 150);
    await drag(p, from3, 37, 3, true); // Cmd: no snapping
    expect(await msgs(p)).toEqual([{ type: 'move', id: 'a', left: 437, top: 103 }]);
    await p.close();
  });

  it('shows a guide while snapping to an object', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    const from = await at(p, 150, 150);
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(from.x + 296, from.y, { steps: 4 }); // right edge 596 -> snaps to 600
    const guide = await p.evaluate(() => { const g = document.querySelector('.sage-canvas-overlay .sc-gx') as HTMLElement; return { display: g.style.display, left: g.style.left }; });
    expect(guide).toEqual({ display: 'block', left: '600px' });
    await p.mouse.up();
    expect((await msgs(p)).at(-1)).toEqual({ type: 'move', id: 'a', left: 400, top: 100 });
    expect(await p.evaluate(() => (document.querySelector('.sage-canvas-overlay .sc-gx') as HTMLElement).style.display)).toBe('none');
    await p.close();
  });

  it('converts screen deltas to stage px when the stage is scaled', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'), { width: 960, height: 540 });
    const from = await at(p, 150, 150);
    await drag(p, from, 20, 10, true); // 0.5 scale: 40, 20 stage px
    expect((await msgs(p)).at(-1)).toEqual({ type: 'move', id: 'a', left: 140, top: 120 });
    await p.close();
  });

  it('resize handles keep the opposite edges fixed', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    const pt = await at(p, 700, 500);
    await p.mouse.click(pt.x, pt.y);
    await msgs(p);
    await drag(p, await handle(p, 'se'), 43, 21); // right 943 -> 940, bottom 621 -> 620
    expect(await msgs(p)).toEqual([{ type: 'resize', id: 'b', left: 600, top: 400, width: 340, height: 220 }]);
    await drag(p, await handle(p, 'nw'), -27, -13, true); // left 573, top 387; right 940 and bottom 620 stay
    expect(await msgs(p)).toEqual([{ type: 'resize', id: 'b', left: 573, top: 387, width: 367, height: 233 }]);
    await drag(p, await handle(p, 'e'), -40, 25, true); // only the right edge moves
    expect(await msgs(p)).toEqual([{ type: 'resize', id: 'b', left: 573, top: 387, width: 327, height: 233 }]);
    await drag(p, await handle(p, 'n'), 30, 20, true); // only the top edge moves
    expect(await msgs(p)).toEqual([{ type: 'resize', id: 'b', left: 573, top: 407, width: 327, height: 213 }]);
    expect(await style(p, 'b')).toEqual({ left: '573px', top: '407px', width: '327px', height: '213px' });
    await p.close();
  });

  it('static elements are selected but not moved; a click without a drag sends no move', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    await drag(p, await at(p, 1410, 305), 50, 50);
    expect(await msgs(p)).toEqual([{ type: 'select', id: 'inner', tag: 'span', left: 0, top: 0, width: expect.any(Number), height: expect.any(Number), fontSize: 16, movable: false, editable: true, html: 'static child', src: null }]);
    const pt = await at(p, 150, 150);
    await p.mouse.click(pt.x, pt.y);
    expect((await msgs(p)).map((m) => m.type)).toEqual(['select']);
    await p.close();
  });
});

describe('in-place text', () => {
  async function editH(p: Page) {
    const pt = await at(p, 1050, 730);
    await p.mouse.dblclick(pt.x, pt.y);
    expect(await p.evaluate(() => document.getElementById('h')!.getAttribute('contenteditable'))).toBe('plaintext-only');
  }

  it('commits on Enter, keeping inline tags', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    await editH(p);
    await p.keyboard.press('ArrowRight'); // collapse to the end
    await p.keyboard.type(' again');
    await p.keyboard.press('Enter');
    expect((await msgs(p)).at(-1)).toEqual({ type: 'text', id: 'h', html: 'Hello <b>bold</b> world again' });
    expect(await p.evaluate(() => document.getElementById('h')!.hasAttribute('contenteditable'))).toBe(false);
    await p.close();
  });

  it('Escape cancels and restores the original', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    await editH(p);
    await p.keyboard.type('replaced');
    await p.keyboard.press('Escape');
    expect(await p.evaluate(() => document.getElementById('h')!.innerHTML)).toBe('Hello <b>bold</b> world');
    expect((await msgs(p)).filter((m) => m.type === 'text')).toEqual([]);
    expect(await p.evaluate(() => (window as any).SageCanvas.selection())).toBe('h'); // still selected
    await p.close();
  });

  it('blur (a click elsewhere) commits; an unchanged edit sends nothing', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    await editH(p);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.type('!');
    const empty = await at(p, 50, 1000);
    await p.mouse.click(empty.x, empty.y);
    expect((await msgs(p)).slice(-2)).toEqual([{ type: 'text', id: 'h', html: 'Hello <b>bold</b> world!' }, { type: 'select', id: null }]);
    await editH(p);
    await p.keyboard.press('Enter');
    expect((await msgs(p)).filter((m) => m.type === 'text')).toEqual([]);
    await p.close();
  });

  it('refuses elements with block children', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    const pt = await at(p, 1010, 910);
    await p.mouse.dblclick(pt.x, pt.y);
    expect((await msgs(p)).at(-1)).toEqual({ type: 'refused', id: 'blk', reason: 'block-children' });
    expect(await p.evaluate(() => document.getElementById('blk')!.hasAttribute('contenteditable'))).toBe(false);
    await p.close();
  });

  it('edits real scene text in the compiled fixture', async () => {
    const p = await open(path.join(tmp, 'build/index.html'));
    await p.evaluate(() => (window as any).T.seek(13.5));
    const r = await p.evaluate(() => { const b = document.getElementById('c1-eye')!.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; });
    await p.mouse.dblclick(r.x, r.y);
    await p.keyboard.press('ArrowRight');
    await p.keyboard.type(', and counting');
    await p.keyboard.press('Enter');
    expect((await msgs(p)).at(-1)).toEqual({ type: 'text', id: 'c1-eye', html: 'Fifteen years of automated program repair, and counting' });
    await p.close();
  });
});

describe('keyboard-only operation', () => {
  it('Tab selects, arrows nudge (one settled move), Enter edits text, Escape deselects', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    await p.keyboard.press('Tab');
    expect((await msgs(p)).map((m) => [m.type, m.id])).toEqual([['select', 'a']]);
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
    await p.keyboard.press('Shift+ArrowDown');
    await p.keyboard.press('Shift+ArrowDown');
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(150);
    expect(await msgs(p)).toEqual([{ type: 'move', id: 'a', left: 102, top: 120 }]);
    expect(await style(p, 'a')).toMatchObject({ left: '102px', top: '120px' });

    await p.keyboard.press('Tab'); // b
    await p.keyboard.press('Tab'); // h (#ghost is invisible)
    expect((await msgs(p)).map((m) => m.id)).toEqual(['b', 'h']);
    await p.keyboard.press('Enter');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.type('!');
    await p.keyboard.press('Enter');
    expect(await msgs(p)).toEqual([{ type: 'text', id: 'h', html: 'Hello <b>bold</b> world!' }]);
    await p.keyboard.press('Escape');
    expect(await msgs(p)).toEqual([{ type: 'select', id: null }]);
    await p.keyboard.press('Shift+Tab');
    expect((await msgs(p)).map((m) => m.id)).toEqual(['inner']);
    await p.close();
  });

  it('keys forwarded by the host go through key(); unhandled ones return false', async () => {
    const p = await open(path.join(tmp, 'synthetic.html'));
    expect(await p.evaluate(() => (window as any).SageCanvas.key('ArrowRight', {}))).toBe(false); // nothing selected
    await p.evaluate(() => (window as any).SageCanvas.select('b'));
    expect(await p.evaluate(() => (window as any).SageCanvas.key('ArrowRight', { shift: true }))).toBe(true);
    await p.waitForTimeout(150);
    expect((await msgs(p)).at(-1)).toEqual({ type: 'move', id: 'b', left: 610, top: 400 });
    // a silent select (restoring the selection after a reload) posts nothing
    await p.evaluate(() => (window as any).SageCanvas.select('a', { silent: true }));
    expect(await msgs(p)).toEqual([]);
    await p.evaluate(() => (window as any).SageCanvas.disable());
    expect(await p.evaluate(() => !!document.querySelector('.sage-canvas-overlay'))).toBe(false);
    await p.close();
  });
});
