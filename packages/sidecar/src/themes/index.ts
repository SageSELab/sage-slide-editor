// themes/index.ts — theme.* and fonts.* (docs/rpc.md "Themes and fonts").
//
// A .talktheme folder holds theme.json (sage-theme/1, @sage/core's ThemeSchema), a generated
// theme.css and fonts/*.woff2. theme.apply copies the fonts into the talk's assets/fonts and
// rewrites the two marked blocks at the top of the talk's theme.css (core's withThemeBlocks);
// it goes through the same path as talk.edit (announced atomic writes, a rebuild, an inverse
// for talk.revert). fonts.add embeds one Google font the same way, for per-element use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FONT_ROLES, TALK_FONTS_DIR, THEME_FORMAT, defaultEngineDir, extractTheme, fontStack, mergeFaces, parseFontFaces, parseTheme,
  themeCssPatch, themeFontFaces, themeJson, themePackageCss, themeSlug, type FontFace, type Theme,
} from '@sage/core';
import {
  ErrorCode, RpcError, ThemeErrorCode,
  type EditResult, type EmbeddedFont, type FontsAddParams, type FontsAddResult, type FontsListResult, type FontsSearchParams,
  type FontsSearchResult, type TalkKind, type ThemeApplyParams, type ThemeApplyResult, type ThemeExtractParams, type ThemeExtractResult,
  type ThemeSaveParams, type ThemeSaveResult, type ThemeValidateParams, type ThemeValidateResult,
} from '../protocol.ts';
import type { WriteAuthor } from '../watcher.ts';
import { FontCatalog, FontError, fallbackFor } from './fonts.ts';

export { FontCatalog, FontError, fallbackFor } from './fonts.ts';

/** The app's theme library: ~/Library/Application Support/SAGE Talk/Themes, or SAGE_THEME_LIBRARY. */
export function defaultThemeLibrary(env: Record<string, string | undefined> = process.env): string {
  return env.SAGE_THEME_LIBRARY || path.join(os.homedir(), 'Library', 'Application Support', 'SAGE Talk', 'Themes');
}
/** The built-in themes, in the skill: <plugin>/skills/academic-talk-film/assets/themes. */
export function builtinThemesDir(pluginDir: string): string {
  return path.join(pluginDir, 'skills', 'academic-talk-film', 'assets', 'themes');
}

export interface ThemerHost {
  readonly root: string | null;
  readonly kind: TalkKind | null;
  /** talk.json's `theme` (the file the blocks go into). */
  spine(): Promise<{ theme?: string }>;
  computedEdit(method: string, files: readonly string[], make: (texts: Readonly<Record<string, string>>) => { file: string; range: [number, number]; newText: string }[],
    binaries: readonly { rel: string; content: Buffer }[], author: WriteAuthor): Promise<EditResult>;
}

export interface ThemerOptions {
  catalog?: FontCatalog;
  engineDir?: string;
  /** User themes (talk_theme_create saves here). */
  library?: string;
  /** Read-only built-in themes. */
  builtins?: string | null;
}

export interface LibraryEntry { id: string; name: string; description?: string; path: string; builtin: boolean }

const fontError = (e: unknown): never => {
  if (e instanceof FontError) throw new RpcError(ThemeErrorCode.FontFailed, e.message, { code: e.code });
  throw e;
};
const invalid = (problems: string[], what = 'The theme'): never => {
  throw new RpcError(ThemeErrorCode.ThemeInvalid, `${what} is not a valid sage-theme/1 theme: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '; ...' : ''}`, { problems });
};

/** theme.json of a package folder, parsed (problems instead of a theme when it is missing or invalid). */
export function readThemePackage(dir: string): { theme: Theme | null; problems: string[]; missingFonts: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8')); } catch (e) {
    return { theme: null, problems: [fs.existsSync(dir) ? `theme.json: ${(e as Error).message}` : `${dir} does not exist`], missingFonts: [] };
  }
  const r = parseTheme(raw);
  if (!r.theme) return { theme: null, problems: r.problems, missingFonts: [] };
  const missingFonts = themeFontFaces(r.theme).map((f) => `fonts/${f.file}`).filter((f) => !fs.existsSync(path.join(dir, f)));
  return { theme: r.theme, problems: [], missingFonts };
}

export class Themer {
  readonly catalog: FontCatalog;
  readonly library: string;
  readonly builtins: string | null;
  private engineDir: string;

  constructor(private host: ThemerHost, opts: ThemerOptions = {}) {
    this.catalog = opts.catalog ?? new FontCatalog();
    this.engineDir = opts.engineDir ?? defaultEngineDir();
    this.library = opts.library ?? defaultThemeLibrary();
    this.builtins = opts.builtins === undefined ? null : opts.builtins;
  }

  // --- packages ---------------------------------------------------------------------------

  validate(p: ThemeValidateParams): ThemeValidateResult {
    if (p.path !== undefined) {
      const r = readThemePackage(p.path);
      return { ok: !!r.theme && !r.missingFonts.length, problems: [...r.problems, ...r.missingFonts.map((f) => `${f}: missing`)], ...(r.theme ? { theme: r.theme } : {}), missingFonts: r.missingFonts };
    }
    const r = parseTheme(p.theme);
    return { ok: !!r.theme, problems: r.problems, ...(r.theme ? { theme: r.theme } : {}), missingFonts: [] };
  }

  /** Writes a package: theme.json, theme.css, and fonts/ (kept, copied from `fontsFrom`, or downloaded). */
  async save(p: ThemeSaveParams, fontsFrom?: string): Promise<ThemeSaveResult> {
    const r = parseTheme(p.theme);
    const theme = r.theme ?? invalid(r.problems);
    const faces = themeFontFaces(theme);
    const files = new Map<string, Buffer>();
    for (const f of faces) {
      const have = [path.join(p.path, 'fonts', f.file), ...(fontsFrom ? [path.join(fontsFrom, f.file)] : [])].find((x) => fs.existsSync(x));
      files.set(f.file, have ? fs.readFileSync(have) : await this.catalog.file(f.id, f.subset, f.weight, f.style).catch(fontError));
    }
    fs.mkdirSync(path.join(p.path, 'fonts'), { recursive: true });
    for (const [name, buf] of files) fs.writeFileSync(path.join(p.path, 'fonts', name), buf);
    for (const old of fs.readdirSync(path.join(p.path, 'fonts'))) if (old.endsWith('.woff2') && !files.has(old)) fs.rmSync(path.join(p.path, 'fonts', old));
    fs.writeFileSync(path.join(p.path, 'theme.json'), themeJson(theme));
    fs.writeFileSync(path.join(p.path, 'theme.css'), themePackageCss(theme));
    return { path: p.path, theme, fonts: [...files.keys()].sort().map((f) => `fonts/${f}`) };
  }

  // --- the open talk ------------------------------------------------------------------------

  private requireTalk(method: string): string {
    if (!this.host.root) throw new RpcError(ErrorCode.NoTalkOpen, 'no talk is open');
    if (this.host.kind !== 'beatFormat') throw new RpcError(ErrorCode.UnsupportedForKind, `${method} is not available for ${this.host.kind} talks`, { kind: this.host.kind });
    return this.host.root;
  }
  private async themeFile(): Promise<string> { return (await this.host.spine()).theme ?? 'theme.css'; }
  private readText(root: string, rel: string) { const f = path.join(root, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  private engineCss() { return fs.readFileSync(path.join(this.engineDir, 'talk.css'), 'utf8'); }

  /** The theme the open talk has now (talk.css overridden by its theme.css). */
  async current(opts: { id?: string; name?: string; description?: string } = {}): Promise<Theme> {
    const root = this.requireTalk('theme.extract');
    const css = this.readText(root, await this.themeFile());
    return extractTheme(this.engineCss(), css, opts);
  }

  async apply(p: ThemeApplyParams, author: WriteAuthor = 'app'): Promise<ThemeApplyResult> {
    this.requireTalk('theme.apply');
    const pkg = readThemePackage(p.path);
    const theme = pkg.theme ?? invalid(pkg.problems, path.basename(p.path));
    return this.applyTheme(theme, p.path, author);
  }

  /** Applies a theme whose fonts are in `dir`/fonts (downloaded when missing). */
  async applyTheme(theme: Theme, dir: string | null, author: WriteAuthor = 'app'): Promise<ThemeApplyResult> {
    const root = this.requireTalk('theme.apply');
    const faces = themeFontFaces(theme);
    const binaries: { rel: string; content: Buffer }[] = [];
    for (const f of faces) {
      const inPkg = dir ? path.join(dir, 'fonts', f.file) : null;
      const content = inPkg && fs.existsSync(inPkg) ? fs.readFileSync(inPkg) : await this.catalog.file(f.id, f.subset, f.weight, f.style).catch(fontError);
      binaries.push({ rel: `${TALK_FONTS_DIR}/${f.file}`, content });
    }
    const file = await this.themeFile();
    const engine = this.engineCss();
    const edit = await this.host.computedEdit('theme.apply', [file], (texts) => {
      const css = texts[file] ?? '';
      // Keep fonts embedded for other uses (fonts.add); drop the previous theme's.
      let previous: Set<string>;
      try { const t = extractTheme(engine, css); previous = new Set(FONT_ROLES.map((r) => t.fonts[r].family)); } catch { previous = new Set(); }
      const keep = parseFontFaces(css).filter((f) => !previous.has(f.family));
      return [themeCssPatch(file, css, mergeFaces(keep, faces), theme)];
    }, binaries, author);
    return { theme, fonts: binaries.map((b) => b.rel), edit };
  }

  async extract(p: ThemeExtractParams = {}): Promise<ThemeExtractResult> {
    const root = this.requireTalk('theme.extract');
    const opts = { ...(p.id ? { id: p.id } : {}), ...(p.name ? { name: p.name } : {}), ...(p.description ? { description: p.description } : {}) };
    if (p.name && !p.id) opts.id = themeSlug(p.name);
    let theme: Theme;
    try { theme = await this.current(opts); } catch (e) { return invalid([(e as Error).message], "The talk's theme"); }
    if (!p.path) return { theme, fonts: themeFontFaces(theme).map((f) => `fonts/${f.file}`) };
    const saved = await this.save({ path: p.path, theme }, path.join(root, TALK_FONTS_DIR));
    return { theme: saved.theme, path: saved.path, fonts: saved.fonts };
  }

  // --- fonts --------------------------------------------------------------------------------

  async searchFonts(p: FontsSearchParams): Promise<FontsSearchResult> {
    try {
      const fonts = await this.catalog.search(p.query, { ...(p.category ? { category: p.category } : {}), ...(p.limit ? { limit: p.limit } : {}) });
      return { fonts, catalog: (await this.catalog.list()).source };
    } catch (e) { return fontError(e); }
  }

  async addFont(p: FontsAddParams, author: WriteAuthor = 'app'): Promise<FontsAddResult> {
    this.requireTalk('fonts.add');
    const info = await this.catalog.info(p.id).catch(fontError);
    if (!info) throw new RpcError(ThemeErrorCode.FontFailed, `"${p.id}" is not in the Google Fonts catalog (or its license does not allow embedding)`, { code: 'unknown-font' });
    const weights = p.weights ?? (() => { const w = [400, 700].filter((x) => info.weights.includes(x)); return w.length ? w : [info.weights[0] ?? 400]; })();
    const styles = p.styles ?? ['normal'];
    const subset = p.subset ?? (info.subsets.includes('latin') ? 'latin' : info.defSubset);
    const faces: FontFace[] = [];
    const binaries: { rel: string; content: Buffer }[] = [];
    for (const weight of weights) for (const style of styles) {
      const content = await this.catalog.file(info.id, subset, weight, style).catch(fontError);
      const face: FontFace = { family: info.family, id: info.id, subset, weight, style, file: `${info.id}-${subset}-${weight}-${style}.woff2` };
      faces.push(face);
      binaries.push({ rel: `${TALK_FONTS_DIR}/${face.file}`, content });
    }
    const file = await this.themeFile();
    const edit = await this.host.computedEdit('fonts.add', [file], (texts) => {
      const css = texts[file] ?? '';
      return [themeCssPatch(file, css, mergeFaces(parseFontFaces(css), faces), null)];
    }, binaries, author);
    return { family: info.family, fontFamily: fontStack({ family: info.family, fallback: fallbackFor(info.category) }), files: binaries.map((b) => b.rel), edit };
  }

  async listFonts(): Promise<FontsListResult> {
    const root = this.requireTalk('fonts.list');
    const faces = parseFontFaces(this.readText(root, await this.themeFile()));
    const byFamily = new Map<string, EmbeddedFont>();
    for (const f of faces) {
      const e = byFamily.get(f.family) ?? { family: f.family, id: f.id, subset: f.subset, weights: [], styles: [], files: [] };
      if (!e.weights.includes(f.weight)) e.weights.push(f.weight);
      if (!e.styles.includes(f.style)) e.styles.push(f.style);
      e.files.push(`${TALK_FONTS_DIR}/${f.file}`);
      byFamily.set(f.family, e);
    }
    for (const e of byFamily.values()) { e.weights.sort((a, b) => a - b); e.files.sort(); }
    return { fonts: [...byFamily.values()].sort((a, b) => a.family.localeCompare(b.family)) };
  }

  // --- the library (Claude's tools) ---------------------------------------------------------

  /** Built-in and user themes; a user theme with a built-in's id shadows it. */
  list(): LibraryEntry[] {
    const out = new Map<string, LibraryEntry>();
    const scan = (dir: string | null, builtin: boolean) => {
      if (!dir || !fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith('.talktheme')) continue;
        const r = readThemePackage(path.join(dir, name));
        if (r.theme) out.set(r.theme.id, { id: r.theme.id, name: r.theme.name, ...(r.theme.description ? { description: r.theme.description } : {}), path: path.join(dir, name), builtin });
      }
    };
    scan(this.builtins, true);
    scan(this.library, false);
    return [...out.values()];
  }

  /** A library theme by id, name (any case) or absolute package path. */
  find(key: string): LibraryEntry | undefined {
    const k = key.trim();
    if (k.startsWith('/') && k.endsWith('.talktheme')) {
      const r = readThemePackage(k);
      return r.theme ? { id: r.theme.id, name: r.theme.name, path: k, builtin: false } : undefined;
    }
    const all = this.list();
    return all.find((e) => e.id === k) ?? all.find((e) => e.name.toLowerCase() === k.toLowerCase());
  }

  /** Saves a theme into the user library (as <id>.talktheme, replacing a user theme with that id). */
  async saveToLibrary(theme: unknown): Promise<ThemeSaveResult> {
    const r = parseTheme(theme);
    const t = r.theme ?? invalid(r.problems);
    return this.save({ path: path.join(this.library, `${t.id}.talktheme`), theme: t });
  }
}

export { THEME_FORMAT };
