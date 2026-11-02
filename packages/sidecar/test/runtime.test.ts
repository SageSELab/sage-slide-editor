// The runtime resolver: where engine, plugin, talkc and the render browser are, in the repo
// and inside a packaged app (docs/packaging.md), without the repository being present.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyBrowser, applyRuntime, chooseBrowser, chromiumRevision, resolveRuntime, runtimeProblems, shellDir,
  CHROME_APP, MANIFEST_FORMAT, type Fsx,
} from '../src/runtime.ts';
import { REPO_ROOT } from './helpers.ts';

/** An in-memory file system: path -> content (directories are implied). */
function fakeFs(files: Record<string, string>): Fsx {
  return {
    exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(p + '/')),
    readText: (p) => files[p] ?? null,
    realpath: (p) => p,
  };
}

const APP = '/Volumes/Elsewhere/SAGE Talk.app/Contents/Resources/sidecar';
const MANIFEST = JSON.stringify({ format: MANIFEST_FORMAT, version: 'v0.6.0-3-gabc', node: 'v24.11.0', agentSdk: '0.3.316', playwright: '1.64.1', chromiumRevision: '1248' });
const bundled = (extra: Record<string, string> = {}) => fakeFs({
  [`${APP}/manifest.json`]: MANIFEST,
  [`${APP}/dist/main.mjs`]: '',
  [`${APP}/engine/talk.js`]: '', [`${APP}/engine/talk.css`]: '', [`${APP}/engine/edit.js`]: '', [`${APP}/engine/talk-layout.js`]: '',
  [`${APP}/plugin/.claude-plugin/plugin.json`]: '{}',
  [`${APP}/plugin/skills/academic-talk-film/SKILL.md`]: '',
  [`${APP}/bin/talkc`]: '',
  ...extra,
});

describe('resolveRuntime, bundled', () => {
  it('finds everything inside the app from the entry alone (no repo, no env)', () => {
    const fsx = bundled();
    const rt = resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/Users/k', fsx });
    expect(rt).toEqual({
      mode: 'bundled',
      root: APP,
      engineDir: `${APP}/engine`,
      pluginDir: `${APP}/plugin`,
      skillDir: `${APP}/plugin/skills/academic-talk-film`,
      binDir: `${APP}/bin`,
      playwrightCore: `${APP}/node_modules/playwright-core`,
      appSupport: '/Users/k/Library/Application Support/io.sagelab.talk',
      browsersPath: '/Users/k/Library/Application Support/io.sagelab.talk/ms-playwright',
      manifest: JSON.parse(MANIFEST),
    });
    expect(runtimeProblems(rt, fsx)).toEqual([]);
  });

  it('the talkc entry resolves the same runtime', () => {
    const a = resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/h', fsx: bundled() });
    const b = resolveRuntime({ entry: `${APP}/dist/talkc.mjs`, env: {}, home: '/h', fsx: bundled() });
    expect(b).toEqual(a);
  });

  it('honours the environment overrides', () => {
    const rt = resolveRuntime({
      entry: `${APP}/dist/main.mjs`, home: '/h', fsx: bundled(),
      env: { SAGE_ENGINE_DIR: '/e', SAGE_PLUGIN_DIR: '/p', SAGE_APP_SUPPORT: '/as', PLAYWRIGHT_BROWSERS_PATH: '/pw' },
    });
    expect([rt.engineDir, rt.pluginDir, rt.skillDir, rt.appSupport, rt.browsersPath]).toEqual(['/e', '/p', '/p/skills/academic-talk-film', '/as', '/pw']);
  });

  it('lists what is missing', () => {
    const fsx = fakeFs({ [`${APP}/manifest.json`]: MANIFEST, [`${APP}/engine/talk.js`]: '' });
    const rt = resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/h', fsx });
    expect(runtimeProblems(rt, fsx)).toEqual([
      `engine file talk.css is missing from ${APP}/engine`,
      `engine file edit.js is missing from ${APP}/engine`,
      `engine file talk-layout.js is missing from ${APP}/engine`,
      `the plugin manifest is missing from ${APP}/plugin`,
      `the academic-talk-film skill is missing from ${APP}/plugin`,
      `talkc is missing from ${APP}/bin`,
    ]);
  });

  it('a manifest of another format is not a bundle', () => {
    const fsx = fakeFs({ [`${APP}/manifest.json`]: '{"format":"other"}' });
    expect(resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/h', fsx }).mode).toBe('development');
  });
});

describe('resolveRuntime, development', () => {
  it('is this repository, complete, with Playwright found through the render package', () => {
    const rt = resolveRuntime({ entry: path.join(REPO_ROOT, 'packages/sidecar/src/main.ts'), env: {}, home: '/h' });
    expect(rt.mode).toBe('development');
    expect(rt.root).toBe(path.join(REPO_ROOT, 'packages/sidecar'));
    expect(rt.engineDir).toBe(path.join(REPO_ROOT, 'packages/engine/src'));
    expect(rt.pluginDir).toBe(path.join(REPO_ROOT, 'packages/sidecar/plugin'));
    expect(rt.binDir).toBeNull();
    expect(rt.browsersPath).toBeNull();
    expect(runtimeProblems(rt)).toEqual([]);
    expect(rt.playwrightCore && fs.existsSync(path.join(rt.playwrightCore, 'cli.js'))).toBe(true);
    expect(chromiumRevision(rt.playwrightCore)).toMatch(/^\d+$/);
  });

  it('changes no environment', () => {
    const rt = resolveRuntime({ entry: path.join(REPO_ROOT, 'packages/sidecar/src/main.ts'), env: {}, home: '/h' });
    const env = { PATH: '/usr/bin' };
    expect(applyRuntime(rt, env)).toBeNull();
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});

describe('chooseBrowser', () => {
  const pw = '/as/ms-playwright';
  const done = `${shellDir(pw, '1248')}/INSTALLATION_COMPLETE`;
  it('prefers Google Chrome in /Applications (channel chrome)', () => {
    const fsx = fakeFs({ [`/Applications/${CHROME_APP}`]: '', [done]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: {}, home: '/h', fsx }))
      .toEqual({ state: 'chrome', path: `/Applications/${CHROME_APP}`, env: { SAGE_RENDER_CHANNEL: 'chrome' } });
  });
  it('then Chrome in ~/Applications (by path)', () => {
    const fsx = fakeFs({ [`/h/Applications/${CHROME_APP}`]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: {}, home: '/h', fsx }))
      .toEqual({ state: 'chrome', path: `/h/Applications/${CHROME_APP}`, env: { SAGE_RENDER_EXECUTABLE: `/h/Applications/${CHROME_APP}` } });
  });
  it('then the downloaded headless shell, once its install completed', () => {
    const fsx = fakeFs({ [done]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: {}, home: '/h', fsx }))
      .toEqual({ state: 'installed', path: shellDir(pw, '1248'), env: { PLAYWRIGHT_BROWSERS_PATH: pw } });
    const partial = fakeFs({ [`${shellDir(pw, '1248')}/chrome-headless-shell`]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: {}, home: '/h', fsx: partial }).state).toBe('missing');
  });
  it('a different revision does not count', () => {
    const fsx = fakeFs({ [`${shellDir(pw, '1234')}/INSTALLATION_COMPLETE`]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: {}, home: '/h', fsx }))
      .toEqual({ state: 'missing', path: shellDir(pw, '1248'), env: { PLAYWRIGHT_BROWSERS_PATH: pw } });
  });
  it('SAGE_RENDER_BROWSER forces one or the other', () => {
    const fsx = fakeFs({ [`/Applications/${CHROME_APP}`]: '', [done]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: { SAGE_RENDER_BROWSER: 'chromium' }, home: '/h', fsx }).state).toBe('installed');
    const noChrome = fakeFs({ [done]: '' });
    expect(chooseBrowser({ browsersPath: pw, revision: '1248', env: { SAGE_RENDER_BROWSER: 'chrome' }, home: '/h', fsx: noChrome }).state).toBe('missing');
  });
});

describe('applyRuntime, bundled', () => {
  it('exports engine, plugin, node, PATH and the browser choice; set values win', () => {
    const fsx = bundled({ [`/Applications/${CHROME_APP}`]: '' });
    const rt = resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/h', fsx });
    const env: NodeJS.ProcessEnv = { PATH: `/usr/bin:${APP}/bin:/bin`, SAGE_PLUGIN_DIR: '/mine' };
    const choice = applyRuntime(rt, env, fsx, '/h');
    expect(choice?.state).toBe('chrome');
    expect(env).toEqual({
      PATH: `${APP}/bin:/usr/bin:/bin`,
      SAGE_ENGINE_DIR: `${APP}/engine`,
      SAGE_PLUGIN_DIR: '/mine',
      SAGE_NODE: process.execPath,
      SAGE_RENDER_CHANNEL: 'chrome',
    });
  });

  it('after an install, re-applying switches to the downloaded browser', () => {
    const files: Record<string, string> = {};
    const fsx = bundled();
    const base = fsx.exists;
    const live: Fsx = { ...fsx, exists: (p) => p in files || base(p) };
    const rt = resolveRuntime({ entry: `${APP}/dist/main.mjs`, env: {}, home: '/h', fsx });
    const env: NodeJS.ProcessEnv = { SAGE_RENDER_EXECUTABLE: '/stale' };
    expect(applyRuntime(rt, env, live, '/h')?.state).toBe('missing');
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(rt.browsersPath);
    expect(env.SAGE_RENDER_EXECUTABLE).toBeUndefined();
    files[`${shellDir(rt.browsersPath!, '1248')}/INSTALLATION_COMPLETE`] = '';
    expect(applyBrowser(rt, env, live, '/h').state).toBe('installed');
  });
});

describe('resolveRuntime on a real copied layout', () => {
  it('resolves through a symlinked app path to the real files', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-runtime-')));
    try {
      const side = path.join(base, 'App.app/Contents/Resources/sidecar');
      fs.mkdirSync(path.join(side, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(side, 'manifest.json'), MANIFEST);
      fs.writeFileSync(path.join(side, 'dist/main.mjs'), '');
      fs.symlinkSync(path.join(base, 'App.app'), path.join(base, 'Link.app'));
      const rt = resolveRuntime({ entry: path.join(base, 'Link.app/Contents/Resources/sidecar/dist/main.mjs'), env: {}, home: '/h' });
      expect(rt.mode).toBe('bundled');
      expect(rt.root).toBe(side);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
