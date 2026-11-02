#!/usr/bin/env node
// compare.mjs: diff two folders of frames (matched by file name) and write a contact sheet.
//
//   node compare.mjs <dirA> <dirB> [--out dir] [--threshold 0.1] [--fail-above 0.1]
//                    [--names A,B] [--aa]
//   node compare.mjs <dir> [--out dir]          # contact sheet only (golden review)
//
// --threshold   pixelmatch per-pixel colour threshold (0..1, default 0.1)
// --fail-above  fail (exit 1) if any frame differs in more than this PERCENT of pixels
//               (default 0.1, i.e. 0.1 % of 1920x1080 = ~2074 px)
// --aa          count anti-aliased pixels as differences (default: pixelmatch ignores them)
// Writes <out>/diff/<frame>.png, <out>/report.json and <out>/index.html (sorted worst first).
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const o = { dirs: [], out: null, threshold: 0.1, failAbove: 0.1, names: null, aa: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i];
    if (a === '--out') o.out = v();
    else if (a === '--threshold') o.threshold = Number(v());
    else if (a === '--fail-above') o.failAbove = Number(v());
    else if (a === '--names') o.names = v().split(',');
    else if (a === '--aa') o.aa = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else o.dirs.push(path.resolve(a));
  }
  if (o.dirs.length < 1 || o.dirs.length > 2) {
    console.log('usage: node compare.mjs <dirA> [dirB] [--out dir] [--threshold 0.1] [--fail-above 0.1] [--names A,B] [--aa]');
    process.exit(2);
  }
  o.names ??= o.dirs.map((d) => path.basename(d));
  o.out = path.resolve(o.out ?? (o.dirs.length === 2 ? `${o.dirs[0]}__vs__${path.basename(o.dirs[1])}` : path.join(o.dirs[0], 'sheet')));
  return o;
}

const readManifest = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; } };
const pngs = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function diffOne(fa, fb, fd, o) {
  const a = PNG.sync.read(fs.readFileSync(fa));
  const b = PNG.sync.read(fs.readFileSync(fb));
  if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: `${a.width}x${a.height} vs ${b.width}x${b.height}`, pct: 100 };
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: o.threshold, includeAA: o.aa, alpha: 0.2 });
  fs.writeFileSync(fd, PNG.sync.write(d));
  // Bounding box of differing pixels (pixelmatch paints diffs in red 255,0,0).
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const i = (y * d.width + x) * 4;
    if (d.data[i] === 255 && d.data[i + 1] === 0 && d.data[i + 2] === 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { pixels: n, pct: (100 * n) / (a.width * a.height), bbox: x1 >= 0 ? [x0, y0, x1, y1] : null };
}

function sheet(o, rows, summary) {
  const rel = (p) => path.relative(o.out, p).split(path.sep).join('/');
  const two = o.dirs.length === 2;
  const card = (r) => `
  <figure class="${r.fail ? 'fail' : ''}">
    <figcaption><b>${esc(r.file)}</b> t=${r.t ?? ''} ${r.hold ? `· hold ${r.hold}${r.kind && r.kind !== 'hold' ? ` (${r.kind})` : ''}` : ''} ${r.backup ? '· backup' : ''}
      <span>${esc(r.label)}</span>${two ? `<em>${r.missing ? 'missing in ' + esc(r.missing) : r.pct.toFixed(3) + ' %'}${r.bbox ? ' · bbox ' + r.bbox.join(',') : ''}</em>` : ''}</figcaption>
    <div class="imgs">${r.imgs.map((p, i) => `<a href="${rel(p)}" title="${esc(r.cols[i])}"><img loading="lazy" src="${rel(p)}"><small>${esc(r.cols[i])}</small></a>`).join('')}</div>
  </figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Golden frames</title>
<style>
:root{--bg:#f6f6f7;--fg:#1d1d1f;--mut:#6e6e73;--card:#fff;--bad:#d93b2b}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--card:#1c1c1e}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px -apple-system,system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px} p{color:var(--mut);margin:0 0 16px}
figure{margin:0 0 14px;padding:10px;background:var(--card);border-radius:10px;border-left:4px solid transparent}
figure.fail{border-left-color:var(--bad)} figcaption{margin-bottom:6px} figcaption span{color:var(--mut);margin-left:6px}
figcaption em{float:right;font-style:normal;font-variant-numeric:tabular-nums} .fail em{color:var(--bad);font-weight:600}
.imgs{display:grid;grid-template-columns:repeat(${two ? 3 : 1},minmax(0,1fr));gap:8px} .imgs a{color:var(--mut);text-decoration:none}
img{width:100%;display:block;border:1px solid #8884}
</style></head><body>
<h1>${two ? `${esc(o.names[0])} vs ${esc(o.names[1])}` : esc(o.names[0])}</h1>
<p>${esc(summary)}</p>
${rows.map(card).join('')}
</body></html>`;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.join(o.out, 'diff'), { recursive: true });
  const [A, B] = o.dirs;
  const meta = new Map((readManifest(A)?.frames ?? []).map((f) => [f.file, f]));
  const pct = (xs, q) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1) + 0.5))] : 0;

  if (!B) {
    const rows = pngs(A).map((f) => ({ file: f, ...meta.get(f), imgs: [path.join(A, f)], cols: [o.names[0]] }));
    fs.writeFileSync(path.join(o.out, 'index.html'), sheet(o, rows, `${rows.length} frames`));
    console.log(`contact sheet: ${path.join(o.out, 'index.html')}`);
    return;
  }

  const fa = new Set(pngs(A)), fb = new Set(pngs(B));
  const all = [...new Set([...fa, ...fb])].sort();
  const rows = [];
  for (const f of all) {
    const base = { file: f, ...meta.get(f) };
    if (!fa.has(f) || !fb.has(f)) { rows.push({ ...base, missing: fa.has(f) ? o.names[1] : o.names[0], pct: 100, fail: true, imgs: [], cols: [] }); continue; }
    const fd = path.join(o.out, 'diff', f);
    const r = diffOne(path.join(A, f), path.join(B, f), fd, o);
    rows.push({ ...base, ...r, fail: r.pct > o.failAbove, imgs: [path.join(A, f), path.join(B, f), fd], cols: [...o.names, 'diff'] });
    process.stdout.write('.');
  }
  rows.sort((x, y) => y.pct - x.pct);
  const ps = rows.filter((r) => !r.missing).map((r) => r.pct).sort((x, y) => x - y);
  const failed = rows.filter((r) => r.fail);
  const summary = `${rows.length} frames · median ${pct(ps, 0.5).toFixed(3)} % · p90 ${pct(ps, 0.9).toFixed(3)} % · max ${(ps.at(-1) ?? 0).toFixed(3)} % differing pixels · threshold ${o.threshold} · fail above ${o.failAbove} % · ${failed.length} failing`;
  fs.writeFileSync(path.join(o.out, 'report.json'), JSON.stringify({ a: A, b: B, names: o.names, threshold: o.threshold, failAbove: o.failAbove, summary,
    frames: rows.map(({ imgs, cols, ...r }) => r) }, null, 2));
  fs.writeFileSync(path.join(o.out, 'index.html'), sheet(o, rows, summary));
  console.log(`\n${summary}`);
  for (const r of rows.slice(0, 10)) console.log(`  ${r.pct.toFixed(3).padStart(8)} %  ${r.file}  ${r.hold ? 'hold ' + r.hold : ''} ${r.label ?? ''}${r.missing ? ' (missing in ' + r.missing + ')' : ''}`);
  console.log(`report: ${path.join(o.out, 'index.html')}`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
