import { webkit } from '../../../tests/golden/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { PNG } from '../../../tests/golden/node_modules/pngjs/lib/png.js';
const html = path.resolve('../../fixtures/issta26-original/index.html');
const b = await webkit.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(pathToFileURL(html).href + '?t=86.5&capture');
const px = async () => { const buf = await p.screenshot({ clip: { x: 649, y: 419, width: 2, height: 2 } }); const png = PNG.sync.read(buf); return png.data[0]; };
console.log('before', await px());
const cands = await p.evaluate(() => { const out = []; document.querySelectorAll('.stage *').forEach((e, i) => { const r = e.getBoundingClientRect(); if (r.left - 40 <= 650 && 650 <= r.right + 40 && r.top - 40 <= 420 && 420 <= r.bottom + 40) { e.dataset.probe = i; out.push(i); } }); return out; });
for (const i of cands.reverse()) {
  await p.evaluate((i) => { document.querySelector(`[data-probe="${i}"]`).style.visibility = 'hidden'; }, i);
  const v = await px();
  await p.evaluate((i) => { document.querySelector(`[data-probe="${i}"]`).style.visibility = ''; }, i);
  if (v === 255) { console.log('culprit', await p.evaluate((i) => { const e = document.querySelector(`[data-probe="${i}"]`); const cs = getComputedStyle(e); return e.outerHTML.slice(0, 200) + ' op=' + cs.opacity + ' filter=' + cs.filter + ' tf=' + cs.transform + ' bg=' + cs.backgroundColor + ' parentOp=' + getComputedStyle(e.parentElement).opacity + ' anims=' + e.getAnimations().map(a=>JSON.stringify(a.effect.getKeyframes().map(k=>k.filter||k.opacity))).join('|'); }, i)); break; }
}
await b.close();
