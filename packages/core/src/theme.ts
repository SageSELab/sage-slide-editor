// theme.ts — the sage-theme/1 format: a talk's look (colors and fonts for the light slides and
// the dark passages, plus the type scale) as data, and the CSS it becomes.
//
// A theme is a `.talktheme` folder: theme.json (this schema), a generated theme.css (for
// reading and previews), and fonts/*.woff2 (the embedded Google fonts). Applying one to a talk
// writes two marked blocks at the top of the talk's theme.css:
//
//   /* sage-fonts:begin ... */  @font-face rules for assets/fonts/*.woff2  /* sage-fonts:end */
//   /* sage-theme:begin {...} */ :root and .dk token overrides, type scale  /* sage-theme:end */
//
// talk.css defines the tokens (--bg, --ink, --display, ...) and the .dk overrides; theme.css is
// inlined after it, so the blocks override the defaults by cascade order, and the talk's own
// rules below the blocks still win over the theme. A talk without the blocks renders exactly as
// before. Everything here is pure (no file system): the sidecar and talkc do the IO.
import { z } from 'zod';
import type { Patch } from './patch.ts';

export const THEME_FORMAT = 'sage-theme/1' as const;
export const THEME_EXT = 'talktheme' as const;
/** Talk-relative folder that embedded font files live in. */
export const TALK_FONTS_DIR = 'assets/fonts';

// ---------------------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------------------

/** A CSS value that cannot escape its declaration. */
const CssValue = z.string().trim().min(1).max(300)
  .refine((v) => !/[;{}<>]|\/\*|\*\//.test(v), 'must be a plain CSS value (no ; { } < > or comments)');
const Family = z.string().trim().min(1).max(80).refine((v) => !/["'\\;{}<>,]/.test(v), 'a single family name without quotes, commas or ; { }');
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and "-"');
const Weight = z.number().int().min(100).max(900).refine((w) => w % 100 === 0, 'a multiple of 100');
const Px = z.number().positive().max(1000);
const Tokens = z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'custom property names without the leading --'), CssValue);

export const PaletteSchema = z.object({
  bg: CssValue, ink: CssValue, ink2: CssValue, ink3: CssValue, line: CssValue, panel: CssValue,
  accent1: CssValue, accent2: CssValue, accent3: CssValue,
  /** Other custom properties to set (name without the --), e.g. {"correct": "#1f8a4c"}. */
  tokens: Tokens.optional(),
}).strict();

/** The dark passage: the accents default to the light ones. */
export const DarkPaletteSchema = PaletteSchema.partial({ accent1: true, accent2: true, accent3: true }).strict();

export const FONT_SOURCES = ['google', 'system', 'engine'] as const;
export const FontRoleSchema = z.object({
  /** The CSS family name, e.g. "Inter". */
  family: Family,
  /** The rest of the font-family list, e.g. `system-ui, sans-serif`. */
  fallback: CssValue,
  /** google: embedded from the Google Fonts catalog (Fontsource); system: installed fonts, not embedded; engine: talk.css's Manrope. */
  source: z.enum(FONT_SOURCES),
  /** Fontsource id (google only), e.g. "inter". */
  id: Slug.optional(),
  /** Weights to embed (google), e.g. [400, 600]. */
  weights: z.array(Weight).min(1).max(9).optional(),
  styles: z.array(z.enum(['normal', 'italic'])).min(1).max(2).optional(),
  /** Fontsource subset (default latin). */
  subset: Slug.optional(),
}).strict().superRefine((f, ctx) => {
  if (f.source === 'google' && !f.id) ctx.addIssue({ code: 'custom', path: ['id'], message: 'google fonts need their Fontsource id' });
  if (f.source === 'google' && !f.weights) ctx.addIssue({ code: 'custom', path: ['weights'], message: 'google fonts need the weights to embed' });
});

export const TypeScaleSchema = z.object({
  /** .h-xl, .h-l, .h-m, .h-s font sizes in px (talk.css: 124, 92, 62, 40). */
  xl: Px, l: Px, m: Px, s: Px,
  /** .sub, .cap, .eyebrow (talk.css: 34, 26, 28). */
  sub: Px, cap: Px, eyebrow: Px,
  /** Weight of headings and big numbers (talk.css: 700). */
  headingWeight: Weight,
  /** Multiplies the headings' negative letter-spacing (1 = talk.css; 0 = none). */
  headingTracking: z.number().min(0).max(3),
}).strict();

export const ThemeSchema = z.object({
  format: z.literal(THEME_FORMAT),
  id: Slug,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  author: z.string().max(120).optional(),
  light: PaletteSchema,
  dark: DarkPaletteSchema,
  fonts: z.object({ display: FontRoleSchema, body: FontRoleSchema, mono: FontRoleSchema }).strict(),
  type: TypeScaleSchema.optional(),
  /** Extra CSS appended inside the theme block (rules for things the tokens do not reach). */
  css: z.string().max(20_000).refine((v) => !/<\/style|\/\*\s*sage-(theme|fonts):/i.test(v), 'must not close the style element or contain sage markers').optional(),
}).strict();

export type Palette = z.infer<typeof PaletteSchema>;
export type DarkPalette = z.infer<typeof DarkPaletteSchema>;
export type FontRole = z.infer<typeof FontRoleSchema>;
export type TypeScale = z.infer<typeof TypeScaleSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type FontRoleName = keyof Theme['fonts'];
export const FONT_ROLES: readonly FontRoleName[] = ['display', 'body', 'mono'];

/** Validates a parsed theme.json; problems are `path: message` strings. */
export function parseTheme(v: unknown): { theme: Theme; problems: [] } | { theme: null; problems: string[] } {
  const r = ThemeSchema.safeParse(v);
  if (r.success) return { theme: r.data, problems: [] };
  return { theme: null, problems: r.error.issues.map((i) => `${i.path.length ? i.path.join('.') : 'theme'}: ${i.message}`) };
}

/** A slug for an id from a name ("Warm Paper" -> "warm-paper"). */
export function themeSlug(name: string): string {
  const s = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return s || 'theme';
}

// ---------------------------------------------------------------------------------------
// The engine's defaults (talk.css), the SAGE look
// ---------------------------------------------------------------------------------------

/** talk.css's type scale: font size and heading letter-spacing (em) per class. */
export const DEFAULT_TYPE: TypeScale = { xl: 124, l: 92, m: 62, s: 40, sub: 34, cap: 26, eyebrow: 28, headingWeight: 700, headingTracking: 1 };
const HEADING_TRACKING = { xl: -0.045, l: -0.04, m: -0.03, s: -0.02 } as const;
const TYPE_KEYS = ['xl', 'l', 'm', 's', 'sub', 'cap', 'eyebrow'] as const;

/** Token names per palette field. */
const TOKEN: Record<Exclude<keyof Palette, 'tokens'>, string> = {
  bg: '--bg', ink: '--ink', ink2: '--ink-2', ink3: '--ink-3', line: '--line', panel: '--panel', accent1: '--a1', accent2: '--a2', accent3: '--a3',
};
const ROLE_TOKEN: Record<FontRoleName, string> = { display: '--display', body: '--text', mono: '--mono' };

// ---------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------

/** One embedded font file. */
export interface FontFace { family: string; id: string; subset: string; weight: number; style: 'normal' | 'italic'; file: string }

/** The file name Fontsource uses, prefixed by the font id: inter-latin-400-normal.woff2. */
export const fontFileName = (id: string, subset: string, weight: number, style: string) => `${id}-${subset}-${weight}-${style}.woff2`;

/** The font files a theme embeds (google roles), deduplicated across roles. `file` is a bare name. */
export function themeFontFaces(theme: Theme): FontFace[] {
  const out = new Map<string, FontFace>();
  for (const role of FONT_ROLES) {
    const f = theme.fonts[role];
    if (f.source !== 'google' || !f.id) continue;
    const subset = f.subset ?? 'latin';
    for (const weight of f.weights ?? [400]) for (const style of f.styles ?? ['normal']) {
      const file = fontFileName(f.id, subset, weight, style);
      out.set(file, { family: f.family, id: f.id, subset, weight, style, file });
    }
  }
  return [...out.values()];
}

/** A font-family list: the family quoted, then the fallback. */
export const fontStack = (f: Pick<FontRole, 'family' | 'fallback'>) => `${quoteFamily(f.family)}, ${f.fallback}`;
const quoteFamily = (f: string) => (/^[A-Za-z][A-Za-z-]*$/.test(f) && !GENERIC.has(f) ? f : `"${f}"`);
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial']);

const faceRule = (f: FontFace, dir: string) =>
  `@font-face { font-family: "${f.family}"; font-style: ${f.style}; font-weight: ${f.weight}; font-display: block; src: url("${dir}/${f.file}") format("woff2"); }`;

const FONTS_BEGIN = '/* sage-fonts:begin', FONTS_END = '/* sage-fonts:end */';
const THEME_BEGIN = '/* sage-theme:begin', THEME_END = '/* sage-theme:end */';
const EXTRA_MARK = '/* sage-theme:css */';

/** The fonts block: one @font-face per file, sorted by family, weight, style. */
export function fontsBlock(faces: readonly FontFace[], dir = TALK_FONTS_DIR): string {
  const sorted = [...faces].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style) || a.file.localeCompare(b.file));
  return [`${FONTS_BEGIN} fonts embedded by SAGE (${dir}); add fonts in the app or with talk_fonts_add */`, ...sorted.map((f) => faceRule(f, dir)), FONTS_END].join('\n');
}

const FACE_RE = /@font-face\s*\{([^}]*)\}/g;
const prop = (body: string, name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim();

/** The embedded faces listed in a theme.css (its fonts block only). */
export function parseFontFaces(css: string): FontFace[] {
  const block = findBlock(css, FONTS_BEGIN, FONTS_END);
  if (!block) return [];
  const out: FontFace[] = [];
  for (const m of css.slice(block[0], block[1]).matchAll(FACE_RE)) {
    const body = m[1]!;
    const family = prop(body, 'font-family')?.replace(/^["']|["']$/g, '');
    const src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(prop(body, 'src') ?? '')?.[1];
    if (!family || !src) continue;
    const file = src.split('/').pop()!;
    const parts = /^(.+)-([a-z0-9-]+?)-(\d{3})-(normal|italic)\.woff2$/.exec(file);
    const weight = Number(prop(body, 'font-weight') ?? parts?.[3] ?? 400);
    const style = (prop(body, 'font-style') === 'italic' ? 'italic' : 'normal') as FontFace['style'];
    // ids may contain "-": the subset is the known last part before the weight.
    const id = parts ? splitIdSubset(parts[1]! + '-' + parts[2]!)[0] : file.replace(/\.woff2$/, '');
    const subset = parts ? splitIdSubset(parts[1]! + '-' + parts[2]!)[1] : 'latin';
    out.push({ family, id, subset, weight, style, file });
  }
  return out;
}

const SUBSETS = ['latin-ext', 'latin', 'cyrillic-ext', 'cyrillic', 'greek-ext', 'greek', 'vietnamese'];
function splitIdSubset(s: string): [string, string] {
  for (const sub of SUBSETS) if (s.endsWith('-' + sub)) return [s.slice(0, -sub.length - 1), sub];
  const i = s.lastIndexOf('-');
  return [s.slice(0, i), s.slice(i + 1)];
}

// ---------------------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------------------

const decls = (pairs: [string, string][], ind = '  ') => pairs.map(([k, v]) => `${ind}${k}: ${v};`).join('\n');
const paletteDecls = (p: Palette | DarkPalette): [string, string][] => [
  ...(Object.keys(TOKEN) as (keyof typeof TOKEN)[]).filter((k) => p[k] !== undefined).map((k): [string, string] => [TOKEN[k], p[k]!]),
  ...Object.entries(p.tokens ?? {}).map(([k, v]): [string, string] => [`--${k}`, v]),
];
const em = (v: number) => `${Math.round(v * 10000) / 10000}em`;

/** The theme block: token overrides for :root and .dk, the dark passage's backdrop, the type scale, extra CSS. */
export function themeBlock(theme: Theme): string {
  const head = JSON.stringify({ id: theme.id, name: theme.name, ...(theme.description ? { description: theme.description } : {}), ...(theme.author ? { author: theme.author } : {}) }).replace(/\*\//g, '* /');
  const root = [...paletteDecls(theme.light), ...FONT_ROLES.map((r): [string, string] => [ROLE_TOKEN[r], fontStack(theme.fonts[r])])];
  if (theme.type) {
    // talk.css's type classes read these (with talk.css's sizes as fallbacks).
    const t = theme.type;
    for (const k of TYPE_KEYS) root.push([`--t-${k}`, `${t[k]}px`]);
    root.push(['--heading-weight', String(t.headingWeight)]);
    for (const k of ['xl', 'l', 'm', 's'] as const) root.push([`--ls-${k}`, em(HEADING_TRACKING[k] * t.headingTracking)]);
  }
  const lines = [
    `${THEME_BEGIN} ${head} */`,
    `/* Generated by SAGE from the theme "${theme.name.replace(/\*\//g, '')}"; apply a theme (Format > Themes) to change it. Rules below the block win over it. */`,
    `:root {\n${decls(root)}\n}`,
    `.dk {\n${decls(paletteDecls(theme.dark))}\n}`,
    // The dark passage's backdrop (the starter's #black scene carries an inline background).
    `#black { background: ${theme.dark.bg} !important; }`,
  ];
  if (theme.css?.trim()) lines.push(EXTRA_MARK, theme.css.trim());
  lines.push(THEME_END);
  return lines.join('\n');
}

/** [start, end) of a marked block (end after the end marker), or null. */
function findBlock(css: string, begin: string, end: string): [number, number] | null {
  const s = css.indexOf(begin);
  if (s < 0) return null;
  const e = css.indexOf(end, s);
  if (e < 0) return null;
  return [s, e + end.length];
}

/** The theme.css of a .talktheme folder: its fonts (fonts/) and the theme block. */
export function themePackageCss(theme: Theme): string {
  const faces = themeFontFaces(theme);
  return `${faces.length ? fontsBlock(faces, 'fonts') + '\n' : ''}${themeBlock(theme)}\n`;
}

/**
 * The new text of a talk's theme.css with `faces` as its fonts block (null: leave it; empty:
 * remove it) and `theme` (null: leave
 * it) as its theme block. Existing blocks are replaced in place; missing ones are added at the
 * top (fonts first), so the talk's own rules keep their precedence.
 */
export function withThemeBlocks(css: string, faces: readonly FontFace[] | null, theme: Theme | null): string {
  const upsert = (text: string, begin: string, end: string, block: string, insertAt: number) => {
    const at = findBlock(text, begin, end);
    if (at) return text.slice(0, at[0]) + block + text.slice(at[1]);
    if (insertAt === 0) return block + '\n' + text;
    return text.slice(0, insertAt) + '\n' + block + text.slice(insertAt);
  };
  let out = css;
  if (faces && faces.length) out = upsert(out, FONTS_BEGIN, FONTS_END, fontsBlock(faces), 0);
  else if (faces) {
    // No faces: the fonts block goes (with the line break after it).
    const at = findBlock(out, FONTS_BEGIN, FONTS_END);
    if (at) out = out.slice(0, at[0]) + out.slice(at[1] + (out[at[1]] === '\n' ? 1 : 0));
  }
  if (theme) out = upsert(out, THEME_BEGIN, THEME_END, themeBlock(theme), findBlock(out, FONTS_BEGIN, FONTS_END)?.[1] ?? 0);
  return out;
}

/** One patch turning `css` into withThemeBlocks(css, ...): the smallest replaced range. */
export function themeCssPatch(file: string, css: string, faces: readonly FontFace[] | null, theme: Theme | null): Patch {
  return { file, range: [0, css.length], newText: withThemeBlocks(css, faces, theme) };
}

/** Merges faces by file name (later wins). */
export function mergeFaces(a: readonly FontFace[], b: readonly FontFace[]): FontFace[] {
  const m = new Map<string, FontFace>();
  for (const f of [...a, ...b]) m.set(f.file, f);
  return [...m.values()];
}

// ---------------------------------------------------------------------------------------
// Extract: the theme a talk effectively has (talk.css defaults, overridden by theme.css)
// ---------------------------------------------------------------------------------------

/** Declarations of every top-level rule whose selector list is exactly `selector`, in order. */
function ruleDecls(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of clean.matchAll(re)) {
    if (m[1]!.trim() !== selector) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
  }
  return out;
}

function splitStack(v: string): { family: string; fallback: string } {
  const parts: string[] = [];
  let cur = '', q = '';
  for (const ch of v) {
    if (q) { if (ch === q) q = ''; cur += ch; } else if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === ',') { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const family = (parts.shift() ?? 'system-ui').replace(/^["']|["']$/g, '');
  return { family, fallback: parts.join(', ') || 'sans-serif' };
}

export interface ExtractOptions { id?: string; name?: string; description?: string; author?: string }

/**
 * The theme a talk has now: talk.css's tokens, overridden by theme.css's `:root` and `.dk`
 * rules (the theme block's or hand-written ones), its type scale when the theme block sets
 * one, and its extra CSS. Fonts found in the fonts block are `google` roles; Manrope (talk.css)
 * is `engine`; anything else `system`.
 */
export function extractTheme(engineCss: string, themeCss: string, opts: ExtractOptions = {}): Theme {
  const block = findBlock(themeCss, THEME_BEGIN, THEME_END);
  const head = block ? (() => { try { return JSON.parse(/^\/\* sage-theme:begin (\{.*?\}) \*\//.exec(themeCss.slice(block[0], block[1]))?.[1] ?? '{}') as Record<string, string>; } catch { return {}; } })() : {};
  const root = new Map([...ruleDecls(engineCss, ':root'), ...ruleDecls(themeCss, ':root')]);
  const dk = new Map([...ruleDecls(engineCss, '.dk'), ...ruleDecls(themeCss, '.dk')]);
  const known = new Set([...Object.values(TOKEN), ...Object.values(ROLE_TOKEN), ...TYPE_KEYS.map((k) => `--t-${k}`), '--heading-weight', '--ls-xl', '--ls-l', '--ls-m', '--ls-s']);
  const pal = (m: Map<string, string>, base: Map<string, string> | null, own: Map<string, string>) => {
    const o: Record<string, unknown> = {};
    for (const [k, t] of Object.entries(TOKEN)) { const v = m.get(t) ?? base?.get(t); if (v) o[k] = v; }
    // Other custom properties the talk's theme.css sets (not talk.css's own).
    const tokens = Object.fromEntries([...own].filter(([k]) => k.startsWith('--') && !known.has(k)).map(([k, v]) => [k.slice(2), v]));
    if (Object.keys(tokens).length) o.tokens = tokens;
    return o;
  };
  const faces = parseFontFaces(themeCss);
  const role = (token: string, fallbackFamily: string): FontRole => {
    const { family, fallback } = splitStack(root.get(token) ?? fallbackFamily);
    const mine = faces.filter((f) => f.family === family);
    if (mine.length) {
      const weights = [...new Set(mine.map((f) => f.weight))].sort((a, b) => a - b);
      const styles = [...new Set(mine.map((f) => f.style))].sort().reverse() as FontFace['style'][];
      const subset = mine[0]!.subset;
      return { family, fallback, source: 'google', id: mine[0]!.id, weights, ...(styles.length === 1 && styles[0] === 'normal' ? {} : { styles }), ...(subset === 'latin' ? {} : { subset }) };
    }
    return { family, fallback, source: family === 'Manrope' && /assets\/manrope-latin\.woff2/.test(engineCss) ? 'engine' : 'system' };
  };
  const type = extractType(root);
  const extraAt = block ? themeCss.indexOf(EXTRA_MARK, block[0]) : -1;
  const css = block && extraAt >= 0 && extraAt < block[1] ? themeCss.slice(extraAt + EXTRA_MARK.length, block[1] - THEME_END.length).trim() : '';
  const name = opts.name ?? head.name ?? 'Untitled theme';
  const description = opts.description ?? head.description;
  const author = opts.author ?? head.author;
  const theme = {
    format: THEME_FORMAT,
    id: opts.id ?? head.id ?? themeSlug(name),
    name,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    light: pal(root, null, ruleDecls(themeCss, ':root')),
    dark: pal(dk, root, ruleDecls(themeCss, '.dk')),
    fonts: { display: role('--display', 'system-ui'), body: role('--text', 'system-ui'), mono: role('--mono', 'monospace') },
    ...(type ? { type } : {}),
    ...(css ? { css } : {}),
  };
  // .dk inherits the accents from :root unless it sets its own.
  for (const k of ['accent1', 'accent2', 'accent3'] as const) if (!dk.has(TOKEN[k])) delete (theme.dark as Record<string, unknown>)[k];
  const parsed = parseTheme(theme);
  if (!parsed.theme) throw new Error(`the talk's theme cannot be expressed as a sage-theme/1 theme: ${parsed.problems.join('; ')}`);
  return parsed.theme;
}

/** The type scale from :root's --t-* variables, when any is set (else null: talk.css's). */
function extractType(root: Map<string, string>): TypeScale | null {
  if (!TYPE_KEYS.some((k) => root.has(`--t-${k}`))) return null;
  const px = (k: (typeof TYPE_KEYS)[number]) => Number(/([\d.]+)px/.exec(root.get(`--t-${k}`) ?? '')?.[1]) || DEFAULT_TYPE[k];
  const ls = Number(/(-?[\d.]+)em/.exec(root.get('--ls-xl') ?? '')?.[1] ?? HEADING_TRACKING.xl);
  const t: TypeScale = {
    xl: px('xl'), l: px('l'), m: px('m'), s: px('s'), sub: px('sub'), cap: px('cap'), eyebrow: px('eyebrow'),
    headingWeight: Number(root.get('--heading-weight') ?? DEFAULT_TYPE.headingWeight),
    headingTracking: Math.round((ls / HEADING_TRACKING.xl) * 1000) / 1000,
  };
  return TypeScaleSchema.safeParse(t).success ? t : null;
}

/** Text of theme.json for a theme: 2-space JSON with a trailing newline. */
export const themeJson = (theme: Theme) => JSON.stringify(theme, null, 2) + '\n';
