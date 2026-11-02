// Browser equivalence on the real fixture (read at test time, since the port is growing):
//  1. layout.ts + record.ts holds == the runtime's ?cplist and Talk.layout in Chrome.
//  2. talkc build == spikes/format/build.mjs: same ?cplist and byte-identical frames.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileTalk } from '../src/compile.ts';
import { formatCplist } from '../src/layout.ts';
import { loadTalk } from '../src/load.ts';
import { recordTalk, type Recording } from '../src/record.ts';
import { browserLayout, hasChrome, shoot } from './chrome.ts';
import { ISSTA, REPO } from './helpers.ts';

const run = promisify(execFile);
let tmp = '', ours = '', spike = '', rec: Recording;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talkc-eq-'));
  // a snapshot of the fixture, so both compilers see the same files even mid-port
  const snap = path.join(tmp, 'issta26');
  fs.cpSync(ISSTA, snap, { recursive: true, filter: (s) => !s.startsWith(path.join(ISSTA, 'build')) });
  const r = compileTalk(snap, { outDir: path.join(tmp, 'talkc') });
  expect(r.ok).toBe(true);
  ours = r.outFile!;
  await run(process.execPath, [path.join(REPO, 'spikes/format/build.mjs'), snap]);
  spike = path.join(snap, 'build/index.html');
  rec = recordTalk(loadTalk(snap));
}, 120_000);
afterAll(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

describe.skipIf(!hasChrome)('browser equivalence (fixtures/issta26)', () => {
  it('computed holds equal the browser ?cplist and Talk.layout', async () => {
    const b = await browserLayout(ours);
    expect(formatCplist(rec.layout)).toBe(b.cplist);
    expect(rec.layout.beats.length).toBe(b.layout.beats.length);
    rec.layout.beats.forEach((x, i) => {
      const y = b.layout.beats[i]!;
      expect([x.id, x.start, x.hold, x.at]).toEqual([y.id, y.start, y.hold, y.at]);
      expect(x.lastEnd).toBeCloseTo(y.lastEnd, 6); // recorder vs instrumented runtime
    });
    expect(rec.layout.duration).toBe(b.layout.duration);
    // the runtime's empty-selector diagnostics are a subset of the recorder's n = 0 calls
    const zero = new Set([...rec.beats.values()].flatMap((r) => r.calls.filter((c) => c.n === 0).map((c) => `${r.id} ${c.sel}`)));
    for (const d of b.layout.diagnostics.filter((d) => d.code === 'empty-selector')) expect(zero.has(`${d.beat} ${d.sel}`)).toBe(true);
    console.log(`[cplist] ${rec.layout.beats.length} holds identical; duration ${rec.layout.duration}`);
  }, 120_000);

  it('talkc build output matches build.mjs: cplist and 5 frames byte-for-byte', async () => {
    const [a, b] = await Promise.all([browserLayout(ours), browserLayout(spike)]);
    expect(a.cplist).toBe(b.cplist);
    const beats = rec.layout.beats, n = beats.length;
    const times = [beats[0]!.at, beats[Math.floor(n / 4)]!.at - 0.5, beats[Math.floor(n / 2)]!.at, beats[Math.floor((3 * n) / 4)]!.start + 0.37, beats[n - 1]!.at];
    // One pair at a time: 10 concurrent Chromes under virtual time occasionally rasterize a
    // frame differently (observed once, 1474 px, not reproducible). A mismatch is re-shot once
    // and the retry is logged, so a real difference still fails.
    const results: { t: number; same: boolean; diff: number; retried: boolean }[] = [];
    for (const [i, t] of times.entries()) {
      let retried = false;
      for (;;) {
        const [x, y] = await Promise.all([shoot(ours, t, path.join(tmp, `a${i}.png`)), shoot(spike, t, path.join(tmp, `b${i}.png`))]);
        const px = PNG.sync.read(x), py = PNG.sync.read(y);
        const r = { t, same: x.equals(y), diff: x.equals(y) ? 0 : pixelmatch(px.data, py.data, null, px.width, px.height, { threshold: 0 }), retried };
        if (r.same || retried) { results.push(r); break; }
        retried = true;
      }
    }
    console.log('[frames]', results.map((r) => `t=${r.t.toFixed(2)} ${r.same ? 'bytes-identical' : r.diff + 'px'}${r.retried ? ' (retried)' : ''}`).join(', '));
    for (const r of results) expect(r.same).toBe(true);
  }, 300_000);
});
