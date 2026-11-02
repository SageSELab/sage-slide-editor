// Which property makes WebKit flatten the exploded-layers rig at t=36?
import { webkit, chromium } from '../../../tests/golden/node_modules/playwright/index.mjs';
import { PNG } from '../../../tests/golden/node_modules/pngjs/lib/png.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const html = path.resolve(process.argv[2] ?? '../../fixtures/issta26-original/index.html');
const tweaks = {
  baseline: '',
  freezeRig: `const e=document.querySelector('#rig');const cs=getComputedStyle(e);const o=cs.opacity,t=cs.transform;e.getAnimations().forEach(a=>a.cancel());e.style.opacity=o;e.style.transform=t;`,
  freezeTilt: `const e=document.querySelector('#tilt');const t=getComputedStyle(e).transform;e.getAnimations().forEach(a=>a.cancel());e.style.transform=t;`,
  freezeLays: `document.querySelectorAll('.lay').forEach(e=>{const cs=getComputedStyle(e);const o=cs.opacity,t=cs.transform;e.getAnimations().forEach(a=>a.cancel());e.style.opacity=o;e.style.transform=t;});`,
  freezeAll3: `['#rig','#tilt','.lay'].forEach(s=>document.querySelectorAll(s).forEach(e=>{const cs=getComputedStyle(e);const o=cs.opacity,t=cs.transform;e.getAnimations().forEach(a=>a.cancel());e.style.opacity=o;e.style.transform=t;}));`,
  rigNoOpacityAnim: `const e=document.querySelector('#rig');e.getAnimations().forEach(a=>{if(a.effect.getKeyframes().some(k=>'opacity' in k)) a.cancel();});e.style.opacity=1;`,
  noBackface: `document.querySelectorAll('.lay').forEach(e=>e.style.backfaceVisibility='visible');`,
  deviceHidden: `document.querySelector('.device').style.display='none';`,
  layNoPreserve: `document.querySelectorAll('.lay').forEach(e=>e.style.transformStyle='flat');`,
  stageNoOverflow: `document.querySelector('.stage').style.overflow='visible';`,
};
for (const bt of [webkit, chromium]) {
  const b = await bt.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [k, js] of Object.entries(tweaks)) {
    await p.goto(pathToFileURL(html).href + '?t=36&capture');
    await p.evaluate(js); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = PNG.sync.read(await p.screenshot({ clip: { x: 250, y: 120, width: 500, height: 300 } }));
    let n = 0; for (let i = 0; i < png.data.length; i += 4) if (png.data[i] < 240 || png.data[i + 1] < 240 || png.data[i + 2] < 240) n++;
    console.log(bt.name().padEnd(9), k.padEnd(18), 'coloured px in upper region:', n);
  }
  await b.close();
}
