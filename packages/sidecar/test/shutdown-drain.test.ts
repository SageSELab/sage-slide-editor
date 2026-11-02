// Regression: requests pipelined before stdin closes must all be answered (found in integration,
// 2026-11-01: the sidecar used to close the session immediately and drop queued responses).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const fixture = path.resolve(pkg, '../../fixtures/issta26');

it('answers queued requests when stdin closes right after them', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-drain-'));
  const talk = path.join(tmp, 'issta26');
  fs.cpSync(fixture, talk, { recursive: true, filter: (src) => !src.includes(`${path.sep}build`) });
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: pkg, stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'talk.open', params: { path: talk, watch: false } },
    { jsonrpc: '2.0', id: 2, method: 'talk.layout' },
    { jsonrpc: '2.0', id: 3, method: 'app.ping' },
  ];
  child.stdin.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const code = await new Promise<number | null>((r) => child.on('exit', r));
  const msgs = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(msgs.filter((m) => 'id' in m).map((m) => [m.id, m]));
  expect(code).toBe(0);
  expect([...byId.keys()].sort()).toEqual([1, 2, 3]);
  expect(byId.get(2).result.holds.length).toBeGreaterThan(50);
  fs.rmSync(tmp, { recursive: true, force: true });
}, 60_000);
