// scripts/bundle.ts: the packaged sidecar's two ESM files work from a folder laid out like
// Contents/Resources/sidecar, away from the repository (the full app is checked by
// apps/mac/scripts/package-smoke.sh).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MANIFEST_FORMAT } from '../src/runtime.ts';
import { eventually, FIXTURE, REPO_ROOT } from './helpers.ts';

const run = promisify(execFile);
const PKG = path.join(REPO_ROOT, 'packages/sidecar');
let base = '', side = '';

beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-bundle-')));
  side = path.join(base, 'Resources/sidecar');
  await run(process.execPath, ['scripts/bundle.ts', side], { cwd: PKG });
  fs.writeFileSync(path.join(side, 'manifest.json'), JSON.stringify({ format: MANIFEST_FORMAT, version: 'test', node: process.version, agentSdk: 'x', playwright: 'x', chromiumRevision: '1' }));
  // A relocated engine with a marker, to prove the bundle reads it rather than packages/engine.
  fs.cpSync(path.join(REPO_ROOT, 'packages/engine/src'), path.join(side, 'engine'), { recursive: true });
  fs.appendFileSync(path.join(side, 'engine/talk.js'), '\n/* bundled engine */\n');
  fs.cpSync(path.join(PKG, 'plugin'), path.join(side, 'plugin'), { recursive: true, dereference: true });
  // The externals, from this checkout's pnpm store (package.sh copies them the same way).
  const nm = path.join(side, 'node_modules');
  fs.mkdirSync(path.join(nm, '@anthropic-ai'), { recursive: true });
  const sdk = fs.realpathSync(path.join(PKG, 'node_modules/@anthropic-ai/claude-agent-sdk'));
  fs.symlinkSync(sdk, path.join(nm, '@anthropic-ai/claude-agent-sdk'));
  const pw = fs.realpathSync(path.join(REPO_ROOT, 'packages/render/node_modules/playwright'));
  fs.symlinkSync(path.join(path.dirname(pw), 'playwright-core'), path.join(nm, 'playwright-core'));
}, 60_000);
afterAll(() => { if (base) fs.rmSync(base, { recursive: true, force: true }); });

describe('the bundle', () => {
  it('has only the Agent SDK and playwright-core as external packages', () => {
    const main = fs.readFileSync(path.join(side, 'dist/main.mjs'), 'utf8');
    const pkgs = new Set([...main.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]!).filter((s) => !s.startsWith('node:') && !/^[a-z_]+$/.test(s)));
    expect([...pkgs].sort()).toEqual(['@anthropic-ai/claude-agent-sdk', 'playwright-core']);
  });

  it('talkc.mjs builds and publishes a talk with the engine next to it, from another cwd, once', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-bundle-talk-'));
    try {
      const talk = path.join(tmp, 'issta26');
      fs.cpSync(FIXTURE, talk, { recursive: true, filter: (s) => !s.includes(`${path.sep}build`) });
      const env = { HOME: os.homedir(), PATH: '/usr/bin:/bin' };
      const lay = await run(process.execPath, [path.join(side, 'dist/talkc.mjs'), 'layout', talk], { cwd: tmp, env });
      expect(lay.stdout.split('\n')[0]).toBe('1 5.0 Title');
      expect(lay.stdout.match(/^1 5\.0 Title$/gm)).toHaveLength(1); // main() ran exactly once
      await run(process.execPath, [path.join(side, 'dist/talkc.mjs'), 'build', talk], { cwd: tmp, env });
      expect(fs.readFileSync(path.join(talk, 'build/talk.js'), 'utf8')).toContain('/* bundled engine */');
      const pub = await run(process.execPath, [path.join(side, 'dist/talkc.mjs'), 'publish', talk, 'issta26'], { cwd: tmp, env });
      expect(pub.stderr).toBe('');
      const html = fs.readFileSync(path.join(talk, 'build/public/issta26.html'), 'utf8');
      expect(html).toContain('/* bundled engine */');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  it('main.mjs answers app.ping and setup.check as a bundled sidecar', async () => {
    const proc = spawn(process.execPath, [path.join(side, 'dist/main.mjs')], { cwd: base, env: { HOME: os.homedir(), PATH: '/usr/bin:/bin' } });
    try {
      let out = '', err = '';
      proc.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
      proc.stderr.on('data', (c: Buffer) => { err += c.toString('utf8'); });
      proc.stdin.write('{"jsonrpc":"2.0","id":1,"method":"app.ping"}\n{"jsonrpc":"2.0","id":2,"method":"setup.check"}\n');
      await eventually(() => out.split('\n').length > 2, 15_000, 'two responses');
      const [ping, check] = out.trim().split('\n').map((l) => JSON.parse(l) as { result: Record<string, unknown> });
      expect(ping!.result.pong).toBe(true);
      expect(check!.result).toMatchObject({ mode: 'bundled', version: 'test', problems: [`talkc is missing from ${side}/bin`] });
      expect(err).toContain('bundled test');
      expect(err).not.toContain('usage: talkc');
    } finally { proc.kill('SIGKILL'); }
  });
});
