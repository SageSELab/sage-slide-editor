// Setup (Phase 6): the protocol fixtures in tests/rpc/setup, the auth classification, the
// installer's progress parsing, and setup.check / setup.installBrowser end to end.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classify, SETUP_METHOD_NAMES, SETUP_NOTIFICATION_NAMES, setupNotificationCheckers, setupParamCheckers, setupResultCheckers,
  type SetupMethodName, type SetupNotificationName, type SetupProgressParams,
} from '../src/protocol.ts';
import { MANIFEST_FORMAT, resolveRuntime, shellDir, type Runtime } from '../src/runtime.ts';
import { checkAuth, checkSetup, classifyAuth, installBrowser, parseInstallLine } from '../src/setup.ts';
import { eventually, REPO_ROOT, RPC_FIXTURES } from './helpers.ts';

function parseFixtureName(file: string) {
  const tokens = path.basename(file, '.json').split('.');
  const k = tokens.findIndex((t) => ['request', 'response', 'notification', 'error'].includes(t));
  return { method: tokens.slice(0, k).join('.'), kind: tokens[k] };
}
const DIR = path.join(RPC_FIXTURES, 'setup');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const load = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

describe('tests/rpc/setup fixtures', () => {
  it.each(files)('%s', (f) => {
    const { method, kind } = parseFixtureName(f);
    const c = classify(load(f));
    expect(c.type, `${f} envelope`).toBe(kind);
    if (c.type === 'request') expect(setupParamCheckers[method as SetupMethodName](c.msg.params)).toEqual([]);
    else if (c.type === 'response') expect(setupResultCheckers[method as SetupMethodName](c.msg.result)).toEqual([]);
    else if (c.type === 'notification') expect(setupNotificationCheckers[method as SetupNotificationName](c.msg.params)).toEqual([]);
    else throw new Error(`${f}: unexpected ${c.type}`);
  });

  it('cover every setup method and notification', () => {
    const seen = files.map(parseFixtureName);
    for (const m of SETUP_METHOD_NAMES) {
      expect(seen).toContainEqual({ method: m, kind: 'request' });
      expect(seen).toContainEqual({ method: m, kind: 'response' });
    }
    for (const n of SETUP_NOTIFICATION_NAMES) expect(seen).toContainEqual({ method: n, kind: 'notification' });
  });

  it('reject drift', () => {
    expect(setupParamCheckers['setup.check']({ auth: 'yes' })).toEqual(['params.auth: expected a boolean']);
    expect(setupNotificationCheckers['setup.progress']({ task: 'browser', fraction: 1.5, message: '' })).toEqual(['params.fraction: expected a number in 0...1']);
    const r = (load('setup.check.response.json') as { result: Record<string, unknown> }).result;
    expect(setupResultCheckers['setup.check']({ ...r, auth: { state: 'maybe' } })).toEqual(['result.auth.state: bad value']);
    expect(setupResultCheckers['setup.check']({ ...r, browser: { state: 'chrome' } })).toEqual(["result.browser: missing 'canInstall'", 'result.browser.canInstall: expected a boolean']);
  });
});

describe('classifyAuth', () => {
  it('a Claude login (what this machine reports with a Team login)', () => {
    expect(classifyAuth({ email: 'a@b.edu', organization: 'Lab', subscriptionType: 'Claude Team', apiProvider: 'firstParty' }))
      .toEqual({ state: 'login', account: 'a@b.edu', organization: 'Lab', plan: 'Claude Team', provider: 'firstParty' });
  });
  it('nothing configured (the CLI with an empty HOME)', () => {
    expect(classifyAuth({ tokenSource: 'none', apiProvider: 'firstParty' }))
      .toEqual({ state: 'none', provider: 'firstParty', message: 'No Claude login or API key was found.' });
  });
  it('an API key, from the CLI or only from the environment', () => {
    expect(classifyAuth({ apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' })).toMatchObject({ state: 'apiKey', source: 'ANTHROPIC_API_KEY' });
    expect(classifyAuth({ apiKeySource: 'none' }, { ANTHROPIC_API_KEY: 'sk-x' })).toMatchObject({ state: 'apiKey', source: 'ANTHROPIC_API_KEY' });
    expect(classifyAuth({ apiKeySource: 'none', tokenSource: 'none' })).toMatchObject({ state: 'none' });
  });
  it('third-party providers', () => {
    expect(classifyAuth({ apiProvider: 'bedrock' })).toMatchObject({ state: 'external', provider: 'bedrock' });
  });
  it('a CLI that cannot be asked is unknown, not none', async () => {
    expect(await checkAuth({}, os.tmpdir(), async () => { throw new Error('spawn ENOENT\nmore'); }))
      .toEqual({ state: 'unknown', message: 'The Claude CLI could not be asked: spawn ENOENT' });
    expect(await checkAuth({}, os.tmpdir(), () => new Promise(() => {}), 50))
      .toEqual({ state: 'unknown', message: 'The Claude CLI could not be asked: no answer in 0.05 s' });
  });
});

describe('parseInstallLine', () => {
  it("reads Playwright's non-TTY progress", () => {
    expect(parseInstallLine('Downloading Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248) from https://cdn.playwright.dev/x.zip'))
      .toEqual({ task: 'browser', fraction: 0, message: 'Downloading Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248)' });
    expect(parseInstallLine('|■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■                                                |  40% of 91.2 MiB'))
      .toEqual({ task: 'browser', fraction: 0.4, message: 'Downloading 91.2 MiB' });
    expect(parseInstallLine('Chrome Headless Shell 156.0.8078.4 (playwright chromium-headless-shell v1248) downloaded to /x/chromium_headless_shell-1248'))
      .toMatchObject({ fraction: 1 });
    expect(parseInstallLine('')).toBeNull();
    expect(parseInstallLine('Removing unused browser at /x')).toBeNull();
  });
});

/** A bundled runtime in a temp dir, with a fake installer script standing in for Playwright's. */
function tempBundle(): { rt: Runtime; base: string; fake: string; cleanup: () => void } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-setup-')));
  const side = path.join(base, 'sidecar');
  fs.mkdirSync(path.join(side, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(side, 'manifest.json'), JSON.stringify({ format: MANIFEST_FORMAT, version: 'test', node: process.version, agentSdk: 'x', playwright: 'x', chromiumRevision: '9999' }));
  const rt = resolveRuntime({ entry: path.join(side, 'dist/main.mjs'), env: { SAGE_APP_SUPPORT: path.join(base, 'support') }, home: base });
  const fake = path.join(base, 'fake-install.mjs');
  fs.writeFileSync(fake, [
    "import fs from 'node:fs'; import path from 'node:path';",
    'const dir = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium_headless_shell-9999");',
    'console.log("Downloading Chrome Headless Shell 1 (playwright chromium-headless-shell v9999) from https://example.invalid/x.zip");',
    'for (const p of [0, 50, 100]) console.log(`|${"■".repeat(p / 10)}| ${String(p).padStart(3)}% of 90 MiB`);',
    'if (process.argv[2] === "fail") { console.error("Error: network down"); process.exit(1); }',
    'fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "INSTALLATION_COMPLETE"), "");',
    'console.log(`Chrome Headless Shell 1 downloaded to ${dir}`);',
  ].join('\n'));
  return { rt, base, fake, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

describe('installBrowser', () => {
  it('runs the installer into Application Support, reports progress, and switches the renderer to it', async () => {
    const t = tempBundle();
    try {
      const env: NodeJS.ProcessEnv = { SAGE_RENDER_BROWSER: 'chromium', PATH: process.env.PATH };
      const progress: SetupProgressParams[] = [];
      const r = await installBrowser(t.rt, { onProgress: (p) => progress.push(p), env, command: { file: process.execPath, args: [t.fake] } });
      expect(r).toEqual({ ok: true, browser: { state: 'installed', path: shellDir(t.rt.browsersPath!, '9999'), canInstall: false } });
      expect(progress.map((p) => p.fraction)).toEqual([0, 0, 0, 0.5, 1, 1, 1]);
      expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(path.join(t.base, 'support/ms-playwright'));
    } finally { t.cleanup(); }
  });

  it('reports a failed download with its last lines', async () => {
    const t = tempBundle();
    try {
      const r = await installBrowser(t.rt, { onProgress: () => {}, env: { SAGE_RENDER_BROWSER: 'chromium' }, command: { file: process.execPath, args: [t.fake, 'fail'] } });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/^The download failed \(exit 1\): .*Error: network down$/);
      expect(r.browser).toMatchObject({ state: 'missing', canInstall: true });
    } finally { t.cleanup(); }
  });

  it('is refused in development', async () => {
    const rt = resolveRuntime({ entry: path.join(REPO_ROOT, 'packages/sidecar/src/main.ts'), env: {} });
    const r = await installBrowser(rt, { onProgress: () => {}, env: {} });
    expect(r.ok).toBe(false);
    expect(r.browser.canInstall).toBe(false);
  });
});

describe('checkSetup', () => {
  it('in development: complete, with node, talkc, the claude binary and an injected account', async () => {
    const rt = resolveRuntime({ entry: path.join(REPO_ROOT, 'packages/sidecar/src/main.ts'), env: {} });
    const r = await checkSetup(rt, { auth: true, env: {}, accountInfo: async () => ({ email: 'k@x.io', apiProvider: 'firstParty' }) });
    expect(setupResultCheckers['setup.check'](r)).toEqual([]);
    expect(r).toMatchObject({ mode: 'development', version: 'development', node: process.version, problems: [], auth: { state: 'login', account: 'k@x.io' } });
    expect(r.talkc).toBe(path.join(REPO_ROOT, 'packages/core/src/cli.ts'));
    expect(r.claudeBinary && fs.existsSync(r.claudeBinary)).toBe(true);
  });
  it('answers over the wire with no talk open', async () => {
    const proc = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: path.join(REPO_ROOT, 'packages/sidecar') });
    try {
      let out = '';
      proc.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'setup.check' }) + '\n');
      const line = await eventually(() => out.includes('\n') && out.split('\n')[0], 15_000, 'setup.check');
      const c = classify(JSON.parse(line));
      expect(c.type).toBe('response');
      const result = (c as { msg: { result: unknown } }).msg.result;
      expect(setupResultCheckers['setup.check'](result)).toEqual([]);
      expect(result).toMatchObject({ mode: 'development', problems: [] });
    } finally { proc.kill('SIGKILL'); }
  });
  it('without auth it does not ask', async () => {
    const rt = resolveRuntime({ entry: path.join(REPO_ROOT, 'packages/sidecar/src/main.ts'), env: {} });
    const r = await checkSetup(rt, { auth: false, env: {}, accountInfo: async () => { throw new Error('asked'); } });
    expect(r.auth).toBeUndefined();
  });
});
