// diff.mjs — frame-diff harness for the format spike (not the permanent tests/golden one).
// Shoots the original deck and the beat-format port with headless Chrome at every ported
// hold, hold ± 0.5 s and a set of mid-motion times, diffs the PNGs with pixelmatch, and
// compares the ?cplist output and the slide counter text.
// Usage: node diff.mjs [--only 13.5,20] [--keep] [--holds N]   (default: every hold, backups included)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ORIG = process.argv.includes('--orig') ? path.resolve(process.argv[process.argv.indexOf('--orig') + 1]) : path.join(root, 'fixtures/issta26-original/index.html');
const PORT = path.join(root, 'fixtures/issta26/build/index.html');
const OUT = path.join(here, process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const N_HOLDS = process.argv.includes('--holds') ? +process.argv[process.argv.indexOf('--holds') + 1] : Infinity; // 13 = Title .. Navigation (the Phase 0 slice)

const run1 = (args, cwd) => new Promise((res, rej) => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fmtspike-'));
  execFile(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080', '--virtual-time-budget=3000', `--user-data-dir=${prof}`, '--no-first-run', ...args],
    { cwd, timeout: 60000, maxBuffer: 64 << 20 }, (err, stdout) => { fs.rmSync(prof, { recursive: true, force: true }); err ? rej(err) : res(stdout); });
});
// Headless Chrome is occasionally killed under load (SIGKILL); retry twice before failing.
const run = async (args, cwd) => { for (let k = 0; ; k++) { try { return await run1(args, cwd); } catch (e) { if (k >= 2) throw e; } } };
const url = (file, q) => 'file://' + file + '?' + q;
const shoot = (file, t, png) => run([`--screenshot=${png}`, url(file, `t=${t}&capture&hide=%23slideno`)], path.dirname(file));
const dump = (file, q) => run(['--dump-dom', url(file, q)], path.dirname(file));
const pre = (dom, id) => (dom.match(new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`)) || [])[1]?.replace(/&amp;/g, '&') ?? null;
const slidenoDark = (dom) => /<div id="slideno"[^>]*class="[^"]*\bdark\b/.test(dom);
const slideno = (dom) => (dom.match(/<div id="slideno"[^>]*>([^<]*)<\/div>/) || [])[1] ?? null;

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').map(Number) : null;
fs.mkdirSync(OUT, { recursive: true });

// 1. Hold lists.
const [domO, domP] = await Promise.all([dump(ORIG, 't=0&capture&cplist'), dump(PORT, 't=0&capture&cplist&layout')]);
const listO = pre(domO, 'cplist').split('\n').slice(0, N_HOLDS), listP = pre(domP, 'cplist').split('\n').slice(0, N_HOLDS);
const layout = JSON.parse(pre(domP, 'layout').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
console.log('== cplist (original first %d vs port)', Math.min(N_HOLDS, listO.length));
let cpOk = listO.length === listP.length;
listO.forEach((l, i) => { const same = l === listP[i]; cpOk &&= same; console.log(same ? '  =' : '  ≠', l.padEnd(32), same ? '' : listP[i]); });
console.log(cpOk ? 'cplist: identical' : 'cplist: DIFFERENT');
const holds = listO.map((l) => parseFloat(l.split(' ')[1]));

// 2. Times.
const mid = [1.2, 2.8, 3.5, 8.0, 10.3, 15.0, 17.0, 23.0, 25.5, 29.0, 30.6, 31.8, 38.2, 39.6, 43.3, 47.6, 48.0, 49.2, 52.5, 53.47, 53.7, 58.0, 58.01, 58.3, 59.1, 61.5, 62.55, 63.0, 65.0];
let times = new Set(mid);
// Step times (B.set steps vs the original's 0.01 s tweens / inclusive windows): a frame sampled
// exactly on one compares two equally valid sides of the step, so such times are skipped.
const tAt = (i) => 273.3 + 1.6 + i * 1.25 + (i >= 11 ? 1.4 : 0) + (i >= 15 ? 1.4 : 0);
const STEPS = [30.5, 58.0, 47.9, 49.1, 53.45, 53.5, 60.7, 62.6, 93.9, 94.1, 94.3, 94.5, 94.7, 221.5, 225.3, 229.9, ...Array.from({ length: 19 }, (_, i) => tAt(i))];
const onStep = (t) => STEPS.some((s) => Math.abs(s - t) < 0.015);
holds.forEach((h, i) => { times.add(h); times.add(+(h - 0.5).toFixed(2)); if (i < holds.length - 1) times.add(+(h + 0.5).toFixed(2)); });
const skipped = [...times].filter(onStep); skipped.forEach((t) => times.delete(t));
if (skipped.length) console.log('skipped (on a step):', skipped.join(', '));
times = [...times].sort((a, b) => a - b);
if (only) times = only;

// 3. Shoot and diff.
const rows = await pool(times, 6, async (t) => {
  const a = path.join(OUT, `orig-${t}.png`), b = path.join(OUT, `port-${t}.png`);
  await Promise.all([shoot(ORIG, t, a), shoot(PORT, t, b)]);
  const A = PNG.sync.read(fs.readFileSync(a)), Bp = PNG.sync.read(fs.readFileSync(b));
  const D = new PNG({ width: A.width, height: A.height });
  const n = pixelmatch(A.data, Bp.data, D.data, A.width, A.height, { threshold: 0 }); // exact
  let exact = 0; for (let k = 0; k < A.data.length; k += 4) if (A.data[k] !== Bp.data[k] || A.data[k + 1] !== Bp.data[k + 1] || A.data[k + 2] !== Bp.data[k + 2]) exact++;
  if (n) fs.writeFileSync(path.join(OUT, `diff-${t}.png`), PNG.sync.write(D));
  else if (!args.includes('--keep')) { fs.rmSync(a); fs.rmSync(b); }
  const kind = holds.includes(t) ? 'hold' : holds.some((h) => Math.abs(h - t) === 0.5) ? '±0.5' : 'mid';
  return { t, kind, diffPx: n, rawPx: exact };
});
console.log('\n== frames (pixelmatch threshold 0; rawPx = any RGB byte differs)');
rows.forEach((r) => console.log(`  t=${String(r.t).padEnd(6)} ${r.kind.padEnd(5)} diff=${r.diffPx} raw=${r.rawPx}`));
const bad = rows.filter((r) => r.rawPx);
console.log(`${rows.length} frames, ${bad.length} with differences, max raw ${Math.max(...rows.map((r) => r.rawPx))} px`);

// 4. Slide counter at each hold: pane number and chapter must match; the total differs by design.
console.log('\n== #slideno at holds');
const sl = await pool(holds, 6, async (h) => {
  const [o, p] = await Promise.all([dump(ORIG, `t=${h}&capture`), dump(PORT, `t=${h}&capture`)]);
  const so = slideno(o), sp = slideno(p);
  const strip = (s) => s?.replace(/\/ \d+/, '/ N');
  return { h, so, sp, ok: strip(so) === strip(sp), dark: [slidenoDark(o), slidenoDark(p)] };
});
sl.forEach((r) => console.log(`  ${r.ok ? '=' : '≠'} ${String(r.h).padEnd(5)} orig "${r.so}"  port "${r.sp}"${r.dark[0] !== r.dark[1] ? '  DARK MISMATCH' : r.dark[0] ? '  (dark)' : ''}`));

// 5. Auto-hold analysis: what an auto hold (lastEnd + holdPad) would give per beat.
console.log('\n== auto-hold vs explicit (relative to beat start)');
for (const b of layout.beats) console.log(`  ${b.id.padEnd(18)} start=${String(b.start).padEnd(5)} lastEnd=${b.lastEnd.toFixed(2).padStart(5)} hold=${String(b.hold).padEnd(4)} slack=${(b.hold - b.lastEnd).toFixed(2)}`);
console.log('diagnostics:', JSON.stringify(layout.diagnostics));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ cplist: { orig: listO, port: listP, identical: cpOk }, frames: rows, slideno: sl, layout }, null, 2));
