#!/usr/bin/env node
// shoot.mjs: render a talk film at given times and write one PNG per frame.
//
//   node shoot.mjs <index.html> --engine webkit|chromium|chrome-cli --out <dir>
//                  [--times 1,12.5,30] [--holds] [--around 0.5] [--no-backups]
//                  [--width 1920] [--height 1080] [--concurrency 4]
//
// Every frame is a fresh load of file://<index.html>?t=T&capture (the deterministic
// path: render(t) once at boot, controls hidden). We wait for the load event,
// document.fonts.ready and two requestAnimationFrame ticks before the screenshot.
// Frame files are named by time (t0012.500.png) so folders from different engines or
// runs line up by name; manifest.json records hold index, label and kind for each.
//
// --engine chrome-cli shells out to the installed Google Chrome with the exact flags the
// academic-talk-film skill uses today (headless=new, virtual-time-budget), for parity checks.
import { chromium, webkit } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const o = { engine: 'webkit', times: [], holds: false, around: 0, backups: true, width: 1920, height: 1080, concurrency: 4, out: null, html: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--engine') o.engine = v();
    else if (a === '--out') o.out = v();
    else if (a === '--times') o.times.push(...v().split(',').filter(Boolean).map(Number));
    else if (a === '--holds') o.holds = true;
    else if (a === '--around') o.around = Number(v());
    else if (a === '--no-backups') o.backups = false;
    else if (a === '--width') o.width = Number(v());
    else if (a === '--height') o.height = Number(v());
    else if (a === '--concurrency') o.concurrency = Number(v());
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.html = a;
  }
  if (!o.html) { usage(); process.exit(2); }
  if (!['webkit', 'chromium', 'chrome-cli'].includes(o.engine)) throw new Error(`bad --engine ${o.engine}`);
  if (!o.holds && !o.times.length) throw new Error('give --times and/or --holds');
  o.html = path.resolve(o.html);
  o.out = path.resolve(o.out ?? path.join('out', o.engine));
  return o;
}
function usage() {
  console.log('usage: node shoot.mjs <index.html> --engine webkit|chromium|chrome-cli [--out dir] [--times a,b,c] [--holds] [--around 0.5] [--no-backups] [--concurrency 4]');
}

const fileUrl = (html, query) => pathToFileURL(html).href + '?' + query;
export const frameName = (t) => 't' + t.toFixed(3).padStart(8, '0') + '.png';

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

// Read the deck's checkpoints. Prefer window.T.cps (has the backup flag); fall back to ?cplist.
async function readHolds(browser, html) {
  const page = await browser.newPage();
  await page.goto(fileUrl(html, 'cplist&capture'));
  const cps = await page.evaluate(() => {
    if (window.T?.cps) return window.T.cps.map((c) => ({ at: c.at, label: c.label, backup: !!c.backup }));
    const pre = document.getElementById('cplist');
    return pre ? pre.textContent.trim().split('\n').map((l) => { const m = l.match(/^\d+\s+([\d.]+)\s+(.*)$/); return { at: +m[1], label: m[2], backup: false }; }) : [];
  });
  const duration = await page.evaluate(() => window.T?.duration ?? null);
  await page.close();
  return { cps, duration };
}

function planFrames(o, cps, duration) {
  const frames = new Map();
  const add = (t, info) => {
    t = Math.round(Math.max(0, duration != null ? Math.min(duration, t) : t) * 1000) / 1000;
    const k = frameName(t);
    if (!frames.has(k)) frames.set(k, { file: k, t, ...info });
  };
  if (o.holds) {
    cps.forEach((c, i) => {
      if (c.backup && !o.backups) return;
      add(c.at, { kind: 'hold', hold: i + 1, label: c.label, backup: c.backup });
      if (o.around) {
        add(c.at - o.around, { kind: 'before', hold: i + 1, label: c.label, backup: c.backup });
        add(c.at + o.around, { kind: 'after', hold: i + 1, label: c.label, backup: c.backup });
      }
    });
  }
  for (const t of o.times) add(t, { kind: 'time' });
  return [...frames.values()].sort((a, b) => a.t - b.t);
}

async function shootPlaywright(browser, o, frames) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const queue = [...frames];
  const worker = async () => {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    for (let f; (f = queue.shift()); ) {
      await page.goto(fileUrl(o.html, `t=${f.t}&capture`), { waitUntil: 'load' });
      await settle(page);
      await page.screenshot({ path: path.join(o.out, f.file) });
      if (errors.length) { f.errors = errors.splice(0); }
      process.stdout.write('.');
    }
    await page.close();
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  await ctx.close();
}

async function shootChromeCli(o, frames) {
  for (const f of frames) {
    await run(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${o.width},${o.height}`,
      '--virtual-time-budget=3000', `--screenshot=${path.join(o.out, f.file)}`, fileUrl(o.html, `t=${f.t}&capture`)]);
    process.stdout.write('.');
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const bt = o.engine === 'webkit' ? webkit : chromium; // chrome-cli still uses Playwright Chromium to read holds
  const browser = await bt.launch();
  const version = `${bt.name()} ${browser.version()}`;
  const t0 = Date.now();
  const { cps, duration } = await readHolds(browser, o.html); // duration also clamps --times
  const frames = planFrames(o, cps, duration);
  console.log(`${o.engine}: ${frames.length} frames of ${path.relative(process.cwd(), o.html)} -> ${o.out}`);
  if (o.engine === 'chrome-cli') { await browser.close(); await shootChromeCli(o, frames); }
  else { await shootPlaywright(browser, o, frames); await browser.close(); }
  const manifest = { html: o.html, engine: o.engine, version: o.engine === 'chrome-cli' ? 'system Google Chrome (CLI)' : version, width: o.width, height: o.height, duration, shotAt: new Date().toISOString(), frames };
  fs.writeFileSync(path.join(o.out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const errs = frames.filter((f) => f.errors);
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (errs.length ? `; page errors on ${errs.length} frames (see manifest)` : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
