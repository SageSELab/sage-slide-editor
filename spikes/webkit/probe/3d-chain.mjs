import { webkit } from '../../../tests/golden/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const html = path.resolve('../../fixtures/issta26-original/index.html');
const b = await webkit.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(pathToFileURL(html).href + '?t=36&capture');
console.log(await p.evaluate(() => { const out = []; for (let e = document.querySelector('.lay.life'); e; e = e.parentElement) { const c = getComputedStyle(e); out.push(`${e.tagName}#${e.id}.${e.className} op=${c.opacity} tf=${c.transform.slice(0,40)} ts=${c.transformStyle} persp=${c.perspective} ov=${c.overflow} filt=${c.filter} iso=${c.isolation} clip=${c.clipPath} mask=${c.maskImage||c.webkitMaskImage} wc=${c.willChange} contain=${c.contain} bfv=${c.backfaceVisibility} pos=${c.position} z=${c.zIndex}`); } return out.join('\n'); }));
// minimal 3D test injected on the same page
await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = `<div style="position:fixed;left:1500px;top:700px;width:300px;height:300px;perspective:800px;z-index:99"><div id="mt" style="position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(58deg)"><div style="position:absolute;inset:0;background:red"></div><div id="mz" style="position:absolute;inset:0;background:rgba(0,0,255,.5);transform:translateZ(150px)"></div></div></div>`; document.body.appendChild(d); });
await p.screenshot({ path: 'out/min3d.png', clip: { x: 1400, y: 550, width: 500, height: 500 } });
await b.close();
