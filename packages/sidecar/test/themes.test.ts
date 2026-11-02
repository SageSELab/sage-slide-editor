// Themes and fonts in the sidecar: the built-in themes, the font catalog (a recorded slice of
// the Fontsource catalog, served by a fake fetch: no network), and theme.apply / theme.extract /
// fonts.add on a real Session over a temp copy of the ISSTA fixture, undone with talk.revert.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TYPE, extractTheme, parseFontFaces, parseTheme, themePackageCss, type Theme } from '@sage/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErrorCode, ThemeErrorCode, type BuiltParams, type ChangedParams } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { FontCatalog, Themer, readThemePackage } from '../src/themes/index.ts';
import { CATALOG_URL } from '../src/themes/fonts.ts';
import { A_WOFF2, BUILTINS, fakeFetch, tempDir } from './theme-helpers.ts';
import { REPO_ROOT, eventually, quiet, tempTalk } from './helpers.ts';

const ENGINE_CSS = fs.readFileSync(path.join(REPO_ROOT, 'packages/engine/src/talk.css'), 'utf8');

describe('built-in themes', () => {
  const names = fs.readdirSync(BUILTINS).filter((n) => n.endsWith('.talktheme')).sort();
  it('are SAGE plus at least two alternatives', () => {
    expect(names).toEqual(expect.arrayContaining(['sage.talktheme', 'paper.talktheme', 'contrast.talktheme', 'slate.talktheme']));
  });
  it.each(names)('%s validates, holds its fonts, and its theme.css is the generated one', (n) => {
    const dir = path.join(BUILTINS, n);
    const r = readThemePackage(dir);
    expect(r.problems).toEqual([]);
    expect(r.missingFonts).toEqual([]);
    expect(`${r.theme!.id}.talktheme`).toBe(n);
    expect(fs.readFileSync(path.join(dir, 'theme.css'), 'utf8')).toBe(themePackageCss(r.theme!));
    // git keeps no empty folders: a theme with only engine/system fonts may have no fonts/ at all.
    const fontsDir = path.join(dir, 'fonts');
    for (const f of (fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : []).filter((x) => x.endsWith('.woff2'))) {
      expect(fs.readFileSync(path.join(dir, 'fonts', f)).subarray(0, 4).toString('latin1'), f).toBe('wOF2');
    }
  });
  it('SAGE is the look a talk has without a theme (talk.css and the starter)', () => {
    const sage = readThemePackage(path.join(BUILTINS, 'sage.talktheme')).theme!;
    const starter = fs.readFileSync(path.join(REPO_ROOT, 'skill/academic-talk-film/assets/starter-v2/theme.css'), 'utf8');
    const { description, author, ...rest } = sage;
    expect(description && author).toBeTruthy();
    expect({ ...extractTheme(ENGINE_CSS, starter, { id: 'sage', name: 'SAGE' }), type: DEFAULT_TYPE }).toEqual(rest);
  });
});

describe('font catalog', () => {
  it('loads once, caches to disk, and offers only embeddable licenses', async () => {
    const cacheDir = tempDir('sage-fonts-');
    const fetch = fakeFetch();
    const cat = new FontCatalog({ cacheDir, fetch });
    const { fonts, source } = await cat.list();
    expect(source).toBe('network');
    expect(fonts.map((f) => f.id)).not.toContain('ubuntu'); // UFL-1.0
    expect(fonts.length).toBe(14);
    expect(fs.existsSync(path.join(cacheDir, 'catalog.json'))).toBe(true);
    const again = new FontCatalog({ cacheDir, fetch });
    expect((await again.list()).source).toBe('cache');
    expect(fetch.calls.filter((u) => u === CATALOG_URL)).toHaveLength(1);
    // Stale and offline: the old copy is used.
    const stale = new FontCatalog({ cacheDir, fetch: fakeFetch({ offline: true }), maxAgeMs: 0 });
    expect((await stale.list()).source).toBe('stale');
    // Offline without a cache: FontError network.
    const none = new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch: fakeFetch({ offline: true }) });
    await expect(none.list()).rejects.toMatchObject({ code: 'network' });
  });
  it('ranks exact, prefix, word-prefix, then substring matches; empty query suggests', async () => {
    const cat = new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch: fakeFetch() });
    expect((await cat.search('inter')).map((f) => f.id)).toEqual(['inter', 'inter-tight']);
    expect((await cat.search('plex')).map((f) => f.id)).toEqual(['ibm-plex-mono', 'ibm-plex-sans']);
    expect((await cat.search('mono')).map((f) => f.id)).toEqual(['roboto-mono', 'ibm-plex-mono', 'jetbrains-mono']);
    expect((await cat.search('', { category: 'serif' })).map((f) => f.id)).toEqual(['fraunces', 'lora', 'playfair-display']);
    expect((await cat.search('')).slice(0, 2).map((f) => f.id)).toEqual(['inter', 'manrope']);
    expect(await cat.search('ubuntu')).toEqual([]);
  });
  it('downloads a file once, and refuses variants the font does not have and non-woff2 bodies', async () => {
    const cacheDir = tempDir('sage-fonts-');
    const fetch = fakeFetch();
    const cat = new FontCatalog({ cacheDir, fetch });
    const a = await cat.file('lora', 'latin', 400, 'italic');
    expect(a.equals(A_WOFF2)).toBe(true);
    await cat.file('lora', 'latin', 400, 'italic');
    expect(fetch.calls.filter((u) => u.endsWith('/lora@latest/latin-400-italic.woff2'))).toHaveLength(1);
    await expect(cat.file('lora', 'latin', 100, 'normal')).rejects.toMatchObject({ code: 'variant' });
    await expect(cat.file('nope', 'latin', 400, 'normal')).rejects.toMatchObject({ code: 'unknown-font' });
    const bad = new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch: fakeFetch({ notWoff2: true }) });
    await expect(bad.file('lora', 'latin', 700, 'normal')).rejects.toMatchObject({ code: 'not-woff2' });
  });
});

describe('theme.apply, theme.extract, fonts.add on the open talk', () => {
  const t = tempTalk();
  const changed: ChangedParams[] = [];
  const built: BuiltParams[] = [];
  let session: Session;
  let themer: Themer;
  let fetch: ReturnType<typeof fakeFetch>;
  const css = () => fs.readFileSync(path.join(t.root, 'theme.css'), 'utf8');
  let original = '';

  beforeAll(async () => {
    session = new Session({ changed: (p) => changed.push(p), built: (p) => built.push(p) }, undefined, () => {}, 60);
    await session.open({ path: t.root, watch: true });
    fetch = fakeFetch();
    themer = new Themer({
      get root() { return session.root; }, get kind() { return session.kind; },
      spine: () => session.spine(),
      computedEdit: (m, f, mk, b, a) => session.computedEdit(m, f, mk, b, a),
    }, { catalog: new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch }), builtins: BUILTINS, library: tempDir('sage-library-') });
    original = css();
  }, 60_000);
  afterAll(async () => { await session.close(); t.cleanup(); });

  it('applies a built-in: fonts copied from the package (no download), blocks on top, rebuilt, labelled app', async () => {
    changed.length = 0; built.length = 0;
    const r = await themer.apply({ path: path.join(BUILTINS, 'paper.talktheme') });
    expect(fetch.calls).toEqual([]);
    expect(r.theme.id).toBe('paper');
    expect(r.fonts).toHaveLength(8);
    expect(r.edit.ok).toBe(true);
    expect(r.edit.changed).toEqual([...r.fonts, 'theme.css'].sort());
    expect(r.edit.inverse.patches.length).toBeGreaterThan(0);
    for (const f of r.fonts) expect(fs.existsSync(path.join(t.root, f)), f).toBe(true);
    const now = css();
    expect(now.startsWith('/* sage-fonts:begin')).toBe(true);
    expect(now.endsWith(original)).toBe(true);
    expect(extractTheme(ENGINE_CSS, now)).toEqual(readThemePackage(path.join(BUILTINS, 'paper.talktheme')).theme);
    expect(built.map((b) => b.trigger)).toEqual(['edit']);
    const html = fs.readFileSync(path.join(t.root, 'build/index.html'), 'utf8');
    expect(html).toContain('--display: Fraunces, Georgia');
    expect(fs.existsSync(path.join(t.root, 'build/assets/fonts/fraunces-latin-700-normal.woff2'))).toBe(true);
    await eventually(() => changed.some((c) => c.source === 'app' && c.paths.includes('theme.css')), 8_000, 'talk.changed app');
    await quiet([changed, built]);
    expect(changed.every((c) => c.source === 'app')).toBe(true);
    expect(built.map((b) => b.trigger)).toEqual(['edit']); // the watcher batch is covered by the edit's build
  });

  it('switching themes drops the previous theme\'s faces; fonts.add faces stay; talk.revert undoes exactly', async () => {
    const add = await themer.addFont({ id: 'lora', weights: [400], styles: ['normal', 'italic'] });
    expect(add.family).toBe('Lora');
    expect(add.fontFamily).toBe('Lora, Georgia, "Times New Roman", serif');
    expect(add.files).toEqual(['assets/fonts/lora-latin-400-normal.woff2', 'assets/fonts/lora-latin-400-italic.woff2']);
    expect((await themer.listFonts()).fonts.map((f) => f.family)).toEqual(['Fraunces', 'JetBrains Mono', 'Lora', 'Source Sans 3']);
    const before = css();
    const r = await themer.apply({ path: path.join(BUILTINS, 'contrast.talktheme') });
    expect((await themer.listFonts()).fonts.map((f) => f.family)).toEqual(['Atkinson Hyperlegible', 'IBM Plex Mono', 'Inter', 'Lora']);
    expect(css()).toContain('--bg: #000000;');
    const undo = await session.revert(r.edit.inverse);
    expect(css()).toBe(before);
    await session.revert(undo.inverse); // redo
    expect(css()).toContain('--text: "Atkinson Hyperlegible"');
    // Applying the same theme again changes nothing.
    const same = await themer.apply({ path: path.join(BUILTINS, 'contrast.talktheme') });
    expect(same.edit.changed).toEqual([]);
    expect(same.edit.inverse.patches).toEqual([]);
  });

  it('extract saves the current theme as a package with the talk\'s fonts', async () => {
    const out = path.join(tempDir('sage-extract-'), 'mine.talktheme');
    const r = await themer.extract({ path: out, name: 'My Contrast' });
    expect(r.theme).toMatchObject({ id: 'my-contrast', name: 'My Contrast', fonts: { body: { family: 'Atkinson Hyperlegible', source: 'google', id: 'atkinson-hyperlegible', weights: [400, 700] } } });
    expect(r.fonts).toHaveLength(6);
    const back = readThemePackage(out);
    expect(back.problems).toEqual([]);
    expect(back.missingFonts).toEqual([]);
    expect(fetch.calls.filter((u) => u.includes('atkinson'))).toEqual([]); // copied from assets/fonts
    // Without a path: only the theme.
    expect((await themer.extract()).path).toBeUndefined();
  });

  it('refuses invalid themes and unknown fonts with the theme error codes', async () => {
    const dir = path.join(tempDir('sage-bad-'), 'bad.talktheme');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ format: 'sage-theme/1', id: 'bad' }));
    await expect(themer.apply({ path: dir })).rejects.toMatchObject({ code: ThemeErrorCode.ThemeInvalid });
    await expect(themer.addFont({ id: 'ubuntu' })).rejects.toMatchObject({ code: ThemeErrorCode.FontFailed, data: { code: 'unknown-font' } });
    await expect(themer.addFont({ id: 'lora', weights: [100] })).rejects.toMatchObject({ code: ThemeErrorCode.FontFailed, data: { code: 'variant' } });
    expect(themer.validate({ path: dir }).ok).toBe(false);
    expect(themer.validate({ path: path.join(BUILTINS, 'slate.talktheme') })).toMatchObject({ ok: true, problems: [], missingFonts: [] });
  });

  it('theme.save downloads missing fonts and drops stale ones; the library lists and finds themes', async () => {
    const paper = readThemePackage(path.join(BUILTINS, 'paper.talktheme')).theme!;
    const mine: Theme = { ...paper, id: 'warm', name: 'Warm', fonts: { ...paper.fonts, mono: { family: 'Roboto Mono', fallback: 'monospace', source: 'google', id: 'roboto-mono', weights: [400] } } };
    const saved = await themer.saveToLibrary(mine);
    expect(saved.path).toBe(path.join(themer.library, 'warm.talktheme'));
    expect(saved.fonts).toContain('fonts/roboto-mono-latin-400-normal.woff2');
    expect(fetch.calls.some((u) => u.includes('/roboto-mono@latest/latin-400-normal.woff2'))).toBe(true);
    const leaner = await themer.save({ path: saved.path, theme: { ...mine, fonts: { ...mine.fonts, mono: { family: 'Menlo', fallback: 'monospace', source: 'system' } } } });
    expect(leaner.fonts.some((f) => f.includes('roboto'))).toBe(false);
    expect(fs.readdirSync(path.join(saved.path, 'fonts')).some((f) => f.includes('roboto'))).toBe(false);
    expect(themer.list().map((e) => `${e.id}:${e.builtin}`)).toEqual(['contrast:true', 'paper:true', 'sage:true', 'slate:true', 'warm:false']);
    expect(themer.find('High Contrast')?.id).toBe('contrast');
    expect(themer.find('warm')?.path).toBe(saved.path);
    expect(parseTheme(JSON.parse(fs.readFileSync(path.join(saved.path, 'theme.json'), 'utf8'))).problems).toEqual([]);
  });

  it('needs an open beat-format talk for the talk methods', async () => {
    const lone = new Themer({ root: null, kind: null, spine: async () => ({}), computedEdit: async () => { throw new Error('x'); } }, { catalog: new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch: fakeFetch() }) });
    await expect(lone.apply({ path: path.join(BUILTINS, 'paper.talktheme') })).rejects.toMatchObject({ code: ErrorCode.NoTalkOpen });
    await expect(lone.listFonts()).rejects.toMatchObject({ code: ErrorCode.NoTalkOpen });
    expect((await lone.searchFonts({ query: 'lora' })).fonts.map((f) => f.id)).toEqual(['lora']);
  });
});

describe('the fonts block in a talk', () => {
  it('parses back what fonts.add writes', () => {
    expect(parseFontFaces('/* sage-fonts:begin x */\n@font-face { font-family: "Lora"; font-style: italic; font-weight: 400; font-display: block; src: url("assets/fonts/lora-latin-400-italic.woff2") format("woff2"); }\n/* sage-fonts:end */'))
      .toEqual([{ family: 'Lora', id: 'lora', subset: 'latin', weight: 400, style: 'italic', file: 'lora-latin-400-italic.woff2' }]);
  });
});
