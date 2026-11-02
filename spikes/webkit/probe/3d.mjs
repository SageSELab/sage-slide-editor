import { webkit, chromium } from '../../../tests/golden/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const html = path.resolve('../../fixtures/issta26-original/index.html');
for (const bt of [webkit, chromium]) {
  const b = await bt.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(pathToFileURL(html).href + '?t=36&capture');
  const r = await p.evaluate(() => ['#rig', '#tilt', '.lay.wire', '.lay.life'].map((s) => { const e = document.querySelector(s); const cs = getComputedStyle(e); return `${s} op=${cs.opacity} tf=${cs.transform} ts=${cs.transformStyle} filter=${cs.filter} vis=${cs.visibility} persp=${cs.perspective} bb=${JSON.stringify(e.getBoundingClientRect().toJSON?.() ?? '')}`; }).join('\n'));
  console.log(bt.name(), '\n' + r);
  await b.close();
}
