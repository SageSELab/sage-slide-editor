// setup.ts — the first-run checks behind the onboarding sheet (setup.check) and the render
// browser download (setup.installBrowser). docs/rpc.md "Setup", docs/packaging.md.
//
// The Claude auth check never sends a prompt: it starts the Agent SDK in streaming-input mode
// with an input stream that yields nothing, asks the CLI for `accountInfo()` (answered from the
// local initialize handshake), and closes it. No model call, so no cost.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { query, type AccountInfo, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AuthStatus, BrowserStatus, SetupCheckResult, SetupInstallResult, SetupProgressParams } from './protocol.ts';
import { applyBrowser, runtimeProblems, type Runtime } from './runtime.ts';

/** Sorts what accountInfo() reports into the states the onboarding sheet explains. */
export function classifyAuth(info: AccountInfo, env: NodeJS.ProcessEnv = {}): AuthStatus {
  const base: AuthStatus = { state: 'none' };
  if (info.email) base.account = info.email;
  if (info.organization) base.organization = info.organization;
  if (info.subscriptionType) base.plan = info.subscriptionType;
  if (info.apiProvider) base.provider = info.apiProvider;
  if (info.apiProvider && info.apiProvider !== 'firstParty') {
    return { ...base, state: 'external', message: `Claude is reached through ${info.apiProvider}; its credentials come from that provider.` };
  }
  const keySource = info.apiKeySource && info.apiKeySource !== 'none' ? info.apiKeySource : undefined;
  if (keySource) return { ...base, state: 'apiKey', source: keySource };
  const token = info.tokenSource && info.tokenSource !== 'none' ? info.tokenSource : undefined;
  if (info.email || info.subscriptionType || token) return { ...base, state: 'login', ...(token ? { source: token } : {}) };
  if (env.ANTHROPIC_API_KEY) return { ...base, state: 'apiKey', source: 'ANTHROPIC_API_KEY' };
  return { ...base, state: 'none', message: 'No Claude login or API key was found.' };
}

export type AccountInfoFn = (env: NodeJS.ProcessEnv, cwd: string) => Promise<AccountInfo>;

/** accountInfo() from a CLI that is never sent a message. */
export const sdkAccountInfo: AccountInfoFn = async (env, cwd) => {
  let release: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>((r) => { release = r; }),
      return: async () => ({ value: undefined, done: true }),
    }),
  };
  const options: Options = { env: { ...env }, cwd, settingSources: [], strictMcpConfig: true, persistSession: false };
  const q = query({ prompt, options });
  try {
    return await q.accountInfo();
  } finally {
    q.close();
    (release as ((r: IteratorResult<SDKUserMessage>) => void) | null)?.({ value: undefined, done: true });
  }
};

export async function checkAuth(env: NodeJS.ProcessEnv, cwd: string, fn: AccountInfoFn = sdkAccountInfo, timeoutMs = 30_000): Promise<AuthStatus> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const info = await Promise.race([
      fn(env, cwd),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs); }),
    ]);
    return classifyAuth(info, env);
  } catch (e) {
    return { state: 'unknown', message: `The Claude CLI could not be asked: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    clearTimeout(timer);
  }
}

/** The SDK's native claude binary for this platform, when installed. */
export function claudeBinary(from: string = import.meta.url): string | null {
  try {
    const sdk = createRequire(from).resolve('@anthropic-ai/claude-agent-sdk');
    return createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch { return null; }
}

export interface CheckOptions {
  auth: boolean;
  env?: NodeJS.ProcessEnv;
  accountInfo?: AccountInfoFn;
  cwd?: string;
}

/** The browser choice as the wire reports it. */
export function browserStatus(rt: Runtime, env: NodeJS.ProcessEnv = process.env): BrowserStatus {
  const choice = applyBrowser(rt, env);
  const out: BrowserStatus = { state: choice.state, canInstall: choice.state === 'missing' && !!rt.playwrightCore && !!rt.browsersPath };
  if (choice.path) out.path = choice.path;
  return out;
}

export async function checkSetup(rt: Runtime, opts: CheckOptions): Promise<SetupCheckResult> {
  const env = opts.env ?? process.env;
  const out: SetupCheckResult = {
    mode: rt.mode,
    version: rt.manifest?.version ?? 'development',
    node: process.version,
    nodePath: process.execPath,
    problems: runtimeProblems(rt),
    talkc: rt.binDir ? path.join(rt.binDir, 'talkc') : path.join(path.dirname(rt.root), 'core', 'src', 'cli.ts'),
    browser: browserStatus(rt, env),
  };
  const bin = claudeBinary();
  if (bin) out.claudeBinary = bin;
  if (opts.auth) out.auth = await checkAuth(env, opts.cwd ?? os.tmpdir(), opts.accountInfo);
  return out;
}

// ---------------------------------------------------------------------------------------
// Browser download: Playwright's own installer (`playwright install chromium --only-shell`)
// into rt.browsersPath, with its progress lines turned into setup.progress notifications.
// ---------------------------------------------------------------------------------------

/** One line of the installer's non-TTY output as progress, or null for noise. */
export function parseInstallLine(line: string): SetupProgressParams | null {
  const t = line.trim();
  if (!t) return null;
  const pct = /\|\s*(\d{1,3})% of (.+)$/.exec(t);
  if (pct) return { task: 'browser', fraction: Math.min(1, Number(pct[1]) / 100), message: `Downloading ${pct[2]!.trim()}` };
  const dl = /^Downloading (.+?)(?: from .*)?$/.exec(t);
  if (dl) return { task: 'browser', fraction: 0, message: `Downloading ${dl[1]}` };
  const done = /^(.+?) downloaded to /.exec(t);
  if (done) return { task: 'browser', fraction: 1, message: `${done[1]} installed` };
  return null;
}

export interface InstallOptions {
  onProgress: (p: SetupProgressParams) => void;
  /** Overrides the installer command (tests). */
  command?: { file: string; args: string[] };
  env?: NodeJS.ProcessEnv;
}

export async function installBrowser(rt: Runtime, opts: InstallOptions): Promise<SetupInstallResult> {
  const env = opts.env ?? process.env;
  const fail = (message: string): SetupInstallResult => ({ ok: false, message, browser: browserStatus(rt, env) });
  if (!rt.browsersPath) return fail('Browsers are only downloaded by the packaged app; run `playwright install chromium` in the repository.');
  const cmd = opts.command ?? (rt.playwrightCore
    ? { file: process.execPath, args: [path.join(rt.playwrightCore, 'cli.js'), 'install', 'chromium', '--only-shell'] }
    : null);
  if (!cmd) return fail('playwright-core is missing from the app');
  opts.onProgress({ task: 'browser', fraction: 0, message: 'Starting the download' });
  const tail: string[] = [];
  const code = await new Promise<number>((resolve) => {
    const child = spawn(cmd.file, cmd.args, {
      env: { ...env, PLAYWRIGHT_BROWSERS_PATH: rt.browsersPath!, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop() ?? '';
      for (const l of lines) {
        if (l.trim()) { tail.push(l.trim()); if (tail.length > 5) tail.shift(); }
        const p = parseInstallLine(l);
        if (p) opts.onProgress(p);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { tail.push(e.message); resolve(-1); });
    child.on('close', (c) => resolve(c ?? -1));
  });
  const browser = browserStatus(rt, env);
  if (code === 0 && browser.state !== 'missing') {
    opts.onProgress({ task: 'browser', fraction: 1, message: 'The render browser is installed' });
    return { ok: true, browser };
  }
  return { ok: false, message: `The download failed (exit ${code}): ${tail.join(' / ') || 'no output'}`, browser };
}

