// sage-theme/1: schema, the CSS a theme becomes, the blocks in a talk's theme.css, and extract.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileTalk } from '../src/compile.ts';
import {
  DEFAULT_TYPE, extractTheme, fontsBlock, parseFontFaces, parseTheme, themeBlock, themeFontFaces, themePackageCss, themeSlug,
  withThemeBlocks, type Theme,
} from '../src/theme.ts';
import { hasChrome, shoot } from './chrome.ts';
import { ISSTA, REPO } from './helpers.ts';

const ENGINE_CSS = fs.readFileSync(path.join(REPO, 'packages/engine/src/talk.css'), 'utf8');
const STARTER = path.join(REPO, 'skill/academic-talk-film/assets/starter-v2');
const STARTER_CSS = fs.readFileSync(path.join(STARTER, 'theme.css'), 'utf8');

const paper: Theme = {
  format: 'sage-theme/1', id: 'paper-test', name: 'Paper test', description: 'Warm.',
  light: { bg: '#fbf7f0', ink: '#2b2118', ink2: '#5c4b3b', ink3: '#8c7a68', line: 'rgba(43, 33, 24, 0.14)', panel: 'rgba(43, 33, 24, 0.04)', accent1: '#c2410c', accent2: '#6d5a9e', accent3: '#b91c1c', tokens: { correct: '#3f7d3a' } },
  dark: { bg: '#17120e', ink: '#f6efe6', ink2: '#cbbca9', ink3: '#8f8170', line: 'rgba(255, 255, 255, 0.14)', panel: 'rgba(255, 255, 255, 0.06)', accent1: '#fb923c' },
  fonts: {
    display: { family: 'Fraunces', fallback: 'Georgia, serif', source: 'google', id: 'fraunces', weights: [600, 700] },
    body: { family: 'Source Sans 3', fallback: 'system-ui, sans-serif', source: 'google', id: 'source-sans-3', weights: [400, 600], styles: ['normal', 'italic'] },
    mono: { family: 'IBM Plex Mono', fallback: 'Menlo, monospace', source: 'google', id: 'ibm-plex-mono', weights: [400] },
  },
  type: { ...DEFAULT_TYPE, xl: 120, headingWeight: 600, headingTracking: 0.5 },
  css: '.code { background: #fffaf2; }',
};

describe('schema', () => {
  it('accepts a full theme and the SAGE look extracted from the starter', () => {
    expect(parseTheme(paper).problems).toEqual([]);
    expect(parseTheme(extractTheme(ENGINE_CSS, STARTER_CSS)).problems).toEqual([]);
  });
  it('rejects values that could escape their declaration, and incomplete fonts', () => {
    const bad = structuredClone(paper) as unknown as Record<string, Record<string, unknown>>;
    bad.light!.bg = 'red; } body { display: none';
    (bad.fonts!.display as Record<string, unknown>).id = undefined;
    (bad.fonts!.body as Record<string, unknown>).family = 'A, B';
    const { problems } = parseTheme(bad);
    expect(problems).toContain('light.bg: must be a plain CSS value (no ; { } < > or comments)');
    expect(problems).toContain('fonts.display.id: google fonts need their Fontsource id');
    expect(problems.some((p) => p.startsWith('fonts.body.family:'))).toBe(true);
    expect(parseTheme({ ...paper, css: '</style><script>' }).problems).toEqual(['css: must not close the style element or contain sage markers']);
    expect(parseTheme({ ...paper, format: 'sage-theme/2' }).problems[0]).toMatch(/^format:/);
    expect(parseTheme({ ...paper, extra: 1 }).problems[0]).toMatch(/extra/);
  });
  it('slugs names', () => {
    expect(themeSlug('Warm Paper (v2)')).toBe('warm-paper-v2');
    expect(themeSlug('Élan')).toBe('elan');
    expect(themeSlug('!!!')).toBe('theme');
  });
});

describe('css', () => {
  it('lists each embedded file once, named like Fontsource with the id in front', () => {
    expect(themeFontFaces(paper).map((f) => f.file)).toEqual([
      'fraunces-latin-600-normal.woff2', 'fraunces-latin-700-normal.woff2',
      'source-sans-3-latin-400-normal.woff2', 'source-sans-3-latin-400-italic.woff2', 'source-sans-3-latin-600-normal.woff2', 'source-sans-3-latin-600-italic.woff2',
      'ibm-plex-mono-latin-400-normal.woff2',
    ]);
  });
  it('round-trips the fonts block, ids with dashes included', () => {
    const faces = themeFontFaces(paper);
    const css = fontsBlock(faces);
    expect(css).toContain('@font-face { font-family: "Source Sans 3"; font-style: italic; font-weight: 400; font-display: block; src: url("assets/fonts/source-sans-3-latin-400-italic.woff2") format("woff2"); }');
    const back = parseFontFaces(css);
    expect(back.sort((a, b) => a.file.localeCompare(b.file))).toEqual([...faces].sort((a, b) => a.file.localeCompare(b.file)));
    expect(parseFontFaces('@font-face { font-family: X; src: url("a.woff2"); }')).toEqual([]); // outside the block
  });
  it('emits tokens for :root and .dk, the dark backdrop, the type scale variables and extra CSS', () => {
    const b = themeBlock(paper);
    expect(b.startsWith('/* sage-theme:begin {"id":"paper-test","name":"Paper test","description":"Warm."} */')).toBe(true);
    expect(b).toContain('  --bg: #fbf7f0;\n');
    expect(b).toContain('  --correct: #3f7d3a;\n');
    expect(b).toContain('  --display: Fraunces, Georgia, serif;\n  --text: "Source Sans 3", system-ui, sans-serif;\n  --mono: "IBM Plex Mono", Menlo, monospace;\n');
    expect(b).toContain('.dk {\n  --bg: #17120e;');
    expect(b).toContain('  --a1: #fb923c;\n}'); // the dark accent; a2, a3 inherit
    expect(b).toContain('#black { background: #17120e !important; }');
    expect(b).toContain('  --t-xl: 120px;\n');
    expect(b).toContain('  --heading-weight: 600;\n');
    expect(b).toContain('  --ls-xl: -0.0225em;\n');
    expect(b).toContain('/* sage-theme:css */\n.code { background: #fffaf2; }\n/* sage-theme:end */');
    expect(themePackageCss(paper)).toContain('url("fonts/fraunces-latin-600-normal.woff2")');
  });
  it('puts the blocks at the top of theme.css, replaces them in place, and is idempotent', () => {
    const once = withThemeBlocks(STARTER_CSS, themeFontFaces(paper), paper);
    expect(once.endsWith(STARTER_CSS)).toBe(true);
    expect(once.indexOf('sage-fonts:begin')).toBe(3);
    expect(once.indexOf('sage-fonts:end')).toBeLessThan(once.indexOf('sage-theme:begin'));
    expect(withThemeBlocks(once, themeFontFaces(paper), paper)).toBe(once);
    const other = { ...paper, light: { ...paper.light, bg: '#fff' } };
    const twice = withThemeBlocks(once, null, other);
    expect(twice).toContain('--bg: #fff;');
    expect(twice).not.toContain('--bg: #fbf7f0;');
    expect(twice.endsWith(STARTER_CSS)).toBe(true);
    expect(withThemeBlocks('', null, paper)).toBe(themeBlock(paper) + '\n');
    // No faces removes the fonts block; null leaves it.
    expect(withThemeBlocks(once, [], null)).toBe(withThemeBlocks(STARTER_CSS, null, paper));
    expect(withThemeBlocks(once, null, null)).toBe(once);
  });
});

describe('extract', () => {
  it('reads the SAGE look from talk.css when theme.css has no theme', () => {
    const t = extractTheme(ENGINE_CSS, STARTER_CSS, { id: 'sage', name: 'SAGE' });
    expect(t.light).toMatchObject({ bg: '#ffffff', ink: '#1d1d1f', accent1: '#0a84ff' });
    expect(t.dark).toEqual({ bg: '#000', ink: '#f5f5f7', ink2: '#a1a1a6', ink3: '#6e6e73', line: 'rgba(255, 255, 255, 0.14)', panel: 'rgba(255, 255, 255, 0.06)' });
    expect(t.fonts.display).toEqual({ family: 'Manrope', fallback: '-apple-system, "SF Pro Display", system-ui, sans-serif', source: 'engine' });
    expect(t.fonts.body).toMatchObject({ family: 'SF Pro Text', source: 'system' });
    expect(t.type).toBeUndefined();
  });
  it('round-trips an applied theme', () => {
    const css = withThemeBlocks(STARTER_CSS, themeFontFaces(paper), paper);
    expect(extractTheme(ENGINE_CSS, css)).toEqual(paper);
  });
  it('picks up hand-written token overrides', () => {
    const t = extractTheme(ENGINE_CSS, ':root { --a1: tomato; }\n.dk { --a1: gold; }');
    expect(t.light.accent1).toBe('tomato');
    expect(t.dark.accent1).toBe('gold');
  });
});

describe('a talk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-theme-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('without the blocks compiles byte-identically to before (the blocks are only added by applying a theme)', () => {
    const a = path.join(tmp, 'a');
    fs.cpSync(STARTER, a, { recursive: true });
    const r = compileTalk(a);
    expect(r.ok).toBe(true);
    const html = fs.readFileSync(r.outFile!, 'utf8');
    expect(html).not.toContain('sage-theme');
    expect(html).toContain(STARTER_CSS.trimEnd());
  });

  // Applying the SAGE look itself must not move a pixel: the block restates talk.css's values.
  it.skipIf(!hasChrome)('with the SAGE look applied renders the same frames as without (fixtures/issta26)', async () => {
    const plain = path.join(tmp, 'plain'), themed = path.join(tmp, 'themed');
    for (const d of [plain, themed]) fs.cpSync(ISSTA, d, { recursive: true, filter: (s) => !s.startsWith(path.join(ISSTA, 'build')) });
    const own = fs.readFileSync(path.join(themed, 'theme.css'), 'utf8');
    const sage = { ...extractTheme(ENGINE_CSS, own, { id: 'sage', name: 'SAGE' }), type: DEFAULT_TYPE };
    fs.writeFileSync(path.join(themed, 'theme.css'), withThemeBlocks(own, null, sage));
    const a = compileTalk(plain), b = compileTalk(themed);
    expect(a.ok && b.ok).toBe(true);
    for (const t of [5, 60.5, 150, 214]) {
      const [x, y] = await Promise.all([shoot(a.outFile!, t, path.join(tmp, `p${t}.png`)), shoot(b.outFile!, t, path.join(tmp, `t${t}.png`))]);
      expect(x.equals(y), `t=${t}`).toBe(true);
    }
  }, 300_000);
});
