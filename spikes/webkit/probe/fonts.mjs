import { webkit, chromium } from '../../../tests/golden/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const html = path.resolve('../../fixtures/issta26-original/index.html');
for (const bt of [webkit, chromium]) {
  const b = await bt.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(pathToFileURL(html).href + '?t=86.5&capture');
  await p.evaluate(() => document.fonts.ready);
  const r = await p.evaluate(() => {
    const s = 'Callbacks when the screen is paused, destroyed';
    const fams = ['var(--text)', 'var(--display)', 'var(--mono)', '-apple-system', 'system-ui', '"SF Pro Text"', 'ui-monospace', 'Menlo', '"SF Mono"', 'Manrope', 'serif'];
    const out = fams.map((f) => { const d = document.createElement('span'); d.style.cssText = `font:500 23px ${f};white-space:nowrap;position:absolute`; d.textContent = s; document.body.appendChild(d); const w = d.getBoundingClientRect().width; d.remove(); return `${f}=${w.toFixed(1)}`; });
    // what is at the stray-dot positions
    const at = [[650, 420], [560, 640], [1360, 640], [1270, 420]].map(([x, y]) => document.elementsFromPoint(x, y).slice(0, 4).map((e) => e.tagName + '#' + e.id + '.' + [...e.classList].join('.') + ' op=' + getComputedStyle(e).opacity + ' f=' + getComputedStyle(e).filter).join(' > '));
    return out.join('  ') + '\n' + at.join('\n') + '\nfonts: ' + [...document.fonts].map((f) => f.family + ':' + f.status).join(',');
  });
  console.log(bt.name(), r);
  await b.close();
}
