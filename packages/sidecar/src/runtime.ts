// runtime.ts — where the sidecar's files are: in this repository (development) or inside
// SAGE Talk.app (bundled, docs/packaging.md). Pure functions over an injectable file system so
// both layouts are unit-tested; main.ts and the talkc entry call `applyRuntime` at startup.
//
// Bundled layout (Contents/Resources/sidecar, written by apps/mac/scripts/package.sh):
//   manifest.json              marks the bundle; versions (sage-sidecar/1)
//   dist/main.mjs, talkc.mjs   esbuild bundles of src/main.ts and @sage/core's cli
//   engine/                    packages/engine/src (talk.js, talk.css, edit.js, ...)
//   plugin/                    packages/sidecar/plugin, symlinks resolved (skills/academic-talk-film)
//   bin/talkc                  shim on Claude's PATH: the bundled node + dist/talkc.mjs
//   node_modules/              what cannot be bundled: the Agent SDK + its native claude binary, playwright-core
//
// Development layout: src/main.ts in packages/sidecar; engine in packages/engine/src; plugin in
// packages/sidecar/plugin. Development changes no environment (it stays exactly as before).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUNDLE_ID = 'io.sagelab.talk';
export const MANIFEST_FORMAT = 'sage-sidecar/1';
/** Engine files core copies or inlines (compile + publish). */
export const ENGINE_REQUIRED = ['talk.js', 'talk.css', 'edit.js', 'talk-layout.js'];
export const SKILL_NAME = 'academic-talk-film';

export interface Manifest {
  format: typeof MANIFEST_FORMAT;
  /** `git describe` of the build. */
  version: string;
  node: string;
  agentSdk: string;
  playwright: string;
  /** Playwright's chromium-headless-shell revision (browsers.json), for the first-use download. */
  chromiumRevision: string;
}

export type RuntimeMode = 'bundled' | 'development';

export interface Runtime {
  mode: RuntimeMode;
  /** The sidecar folder: Contents/Resources/sidecar, or packages/sidecar. */
  root: string;
  engineDir: string;
  pluginDir: string;
  skillDir: string;
  /** Folder put first on PATH for Claude (bin/talkc); bundled only. */
  binDir: string | null;
  /** playwright-core's folder, when it can be found (its cli installs browsers). */
  playwrightCore: string | null;
  /** ~/Library/Application Support/io.sagelab.talk, or SAGE_APP_SUPPORT. */
  appSupport: string;
  /** Where downloaded browsers go (PLAYWRIGHT_BROWSERS_PATH); bundled only. */
  browsersPath: string | null;
  manifest: Manifest | null;
}

/** The file system calls the resolver makes (tests pass a fake). */
export interface Fsx {
  exists(p: string): boolean;
  readText(p: string): string | null;
  realpath(p: string): string;
}

export const realFs: Fsx = {
  exists: (p) => fs.existsSync(p),
  readText: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
  realpath: (p) => { try { return fs.realpathSync(p); } catch { return p; } },
};

export interface ResolveInput {
  /** Absolute path of the running entry module (src/main.ts or dist/main.mjs). */
  entry: string;
  env?: NodeJS.ProcessEnv;
  home?: string | undefined;
  fsx?: Fsx;
}

function parseManifest(text: string | null): Manifest | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Partial<Manifest>;
    return m && m.format === MANIFEST_FORMAT ? (m as Manifest) : null;
  } catch { return null; }
}

/** Finds the sidecar's files for the entry that is running. */
export function resolveRuntime(input: ResolveInput): Runtime {
  const env = input.env ?? process.env;
  const fsx = input.fsx ?? realFs;
  const home = input.home ?? os.homedir();
  // Both layouts keep the entry one folder below the sidecar root (src/ or dist/).
  const root = path.dirname(path.dirname(fsx.realpath(input.entry)));
  const manifest = parseManifest(fsx.readText(path.join(root, 'manifest.json')));
  const appSupport = env.SAGE_APP_SUPPORT || path.join(home, 'Library', 'Application Support', BUNDLE_ID);
  if (manifest) {
    const pluginDir = env.SAGE_PLUGIN_DIR || path.join(root, 'plugin');
    return {
      mode: 'bundled',
      root,
      engineDir: env.SAGE_ENGINE_DIR || path.join(root, 'engine'),
      pluginDir,
      skillDir: path.join(pluginDir, 'skills', SKILL_NAME),
      binDir: path.join(root, 'bin'),
      playwrightCore: path.join(root, 'node_modules', 'playwright-core'),
      appSupport,
      browsersPath: env.PLAYWRIGHT_BROWSERS_PATH || path.join(appSupport, 'ms-playwright'),
      manifest,
    };
  }
  const packages = path.dirname(root);
  const pluginDir = env.SAGE_PLUGIN_DIR || path.join(root, 'plugin');
  return {
    mode: 'development',
    root,
    engineDir: env.SAGE_ENGINE_DIR || path.join(packages, 'engine', 'src'),
    pluginDir,
    skillDir: path.join(pluginDir, 'skills', SKILL_NAME),
    binDir: null,
    playwrightCore: devPlaywrightCore(packages, fsx),
    appSupport,
    browsersPath: env.PLAYWRIGHT_BROWSERS_PATH || null,
    manifest: null,
  };
}

/** pnpm keeps playwright-core under the render package's playwright; follow the links. */
function devPlaywrightCore(packages: string, fsx: Fsx): string | null {
  const pw = fsx.realpath(path.join(packages, 'render', 'node_modules', 'playwright'));
  for (const c of [path.join(path.dirname(pw), 'playwright-core'), path.join(pw, 'node_modules', 'playwright-core')]) {
    if (fsx.exists(path.join(c, 'package.json'))) return c;
  }
  return null;
}

/** What is missing from a runtime, as sentences for the onboarding sheet; empty when complete. */
export function runtimeProblems(rt: Runtime, fsx: Fsx = realFs): string[] {
  const out: string[] = [];
  for (const f of ENGINE_REQUIRED) {
    if (!fsx.exists(path.join(rt.engineDir, f))) out.push(`engine file ${f} is missing from ${rt.engineDir}`);
  }
  if (!fsx.exists(path.join(rt.pluginDir, '.claude-plugin', 'plugin.json'))) out.push(`the plugin manifest is missing from ${rt.pluginDir}`);
  if (!fsx.exists(path.join(rt.skillDir, 'SKILL.md'))) out.push(`the ${SKILL_NAME} skill is missing from ${rt.pluginDir}`);
  if (rt.binDir && !fsx.exists(path.join(rt.binDir, 'talkc'))) out.push(`talkc is missing from ${rt.binDir}`);
  return out;
}

// ---------------------------------------------------------------------------------------
// Render browser (talk_frame, talkc shoot): an installed Google Chrome when there is one,
// else Playwright's chromium-headless-shell downloaded into Application Support on first use.
// ---------------------------------------------------------------------------------------

export const CHROME_APP = 'Google Chrome.app/Contents/MacOS/Google Chrome';

export type BrowserState = 'chrome' | 'installed' | 'missing';

export interface BrowserChoice {
  state: BrowserState;
  /** The browser binary, or the folder it would be installed in. */
  path?: string;
  /** Environment for @sage/render's browserLaunchOptions (empty: Playwright's default lookup). */
  env: Record<string, string>;
}

/** The headless-shell revision playwright-core expects (browsers.json). */
export function chromiumRevision(playwrightCore: string | null, fsx: Fsx = realFs): string | null {
  if (!playwrightCore) return null;
  try {
    const j = JSON.parse(fsx.readText(path.join(playwrightCore, 'browsers.json')) ?? '') as { browsers: { name: string; revision: string }[] };
    return j.browsers.find((b) => b.name === 'chromium-headless-shell')?.revision ?? null;
  } catch { return null; }
}

/** The folder Playwright installs the headless shell into; complete once INSTALLATION_COMPLETE exists. */
export const shellDir = (browsersPath: string, revision: string) => path.join(browsersPath, `chromium_headless_shell-${revision}`);

export interface BrowserInput {
  browsersPath: string | null;
  revision: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string | undefined;
  fsx?: Fsx;
}

/**
 * Chooses the render browser. `SAGE_RENDER_BROWSER=chromium` skips Chrome (to test the download
 * path); `=chrome` insists on it. Chrome in /Applications is launched by Playwright's channel
 * 'chrome'; one in ~/Applications by path.
 */
export function chooseBrowser(input: BrowserInput): BrowserChoice {
  const env = input.env ?? process.env;
  const fsx = input.fsx ?? realFs;
  const home = input.home ?? os.homedir();
  const force = env.SAGE_RENDER_BROWSER;
  if (force !== 'chromium') {
    const system = path.join('/Applications', CHROME_APP);
    if (fsx.exists(system)) return { state: 'chrome', path: system, env: { SAGE_RENDER_CHANNEL: 'chrome' } };
    const user = path.join(home, 'Applications', CHROME_APP);
    if (fsx.exists(user)) return { state: 'chrome', path: user, env: { SAGE_RENDER_EXECUTABLE: user } };
  }
  const browsersEnv: Record<string, string> = input.browsersPath ? { PLAYWRIGHT_BROWSERS_PATH: input.browsersPath } : {};
  if (force !== 'chrome' && input.browsersPath && input.revision) {
    const dir = shellDir(input.browsersPath, input.revision);
    if (fsx.exists(path.join(dir, 'INSTALLATION_COMPLETE'))) return { state: 'installed', path: dir, env: browsersEnv };
    return { state: 'missing', path: dir, env: browsersEnv };
  }
  return { state: 'missing', env: browsersEnv };
}

/**
 * Exports a bundled runtime into the environment, which child processes inherit (Claude, its
 * Bash, talkc): the engine and plugin folders, the browser choice, and bin/ first on PATH.
 * A development runtime changes nothing. Values already set win.
 */
export function applyRuntime(rt: Runtime, env: NodeJS.ProcessEnv = process.env, fsx: Fsx = realFs, home?: string): BrowserChoice | null {
  if (rt.mode !== 'bundled') return null;
  env.SAGE_ENGINE_DIR ||= rt.engineDir;
  env.SAGE_PLUGIN_DIR ||= rt.pluginDir;
  env.SAGE_NODE ||= process.execPath;
  if (rt.binDir) {
    const parts = (env.PATH ?? '').split(':').filter(Boolean);
    if (parts[0] !== rt.binDir) env.PATH = [rt.binDir, ...parts.filter((p) => p !== rt.binDir)].join(':');
  }
  return applyBrowser(rt, env, fsx, home);
}

/**
 * Re-chooses the browser (after an install) and exports the choice. In development nothing is
 * exported and the report is what the repository's tests use: Playwright's Chromium in its
 * default cache (or PLAYWRIGHT_BROWSERS_PATH).
 */
export function applyBrowser(rt: Runtime, env: NodeJS.ProcessEnv = process.env, fsx: Fsx = realFs, home?: string): BrowserChoice {
  const revision = rt.manifest?.chromiumRevision ?? chromiumRevision(rt.playwrightCore, fsx);
  if (rt.mode !== 'bundled') {
    const cache = rt.browsersPath ?? path.join(home ?? os.homedir(), 'Library', 'Caches', 'ms-playwright');
    const c = chooseBrowser({ browsersPath: cache, revision, env: { SAGE_RENDER_BROWSER: 'chromium' }, fsx, home });
    return { ...c, env: {} };
  }
  const choice = chooseBrowser({ browsersPath: rt.browsersPath, revision, env, fsx, home });
  delete env.SAGE_RENDER_CHANNEL;
  delete env.SAGE_RENDER_EXECUTABLE;
  Object.assign(env, choice.env);
  return choice;
}
