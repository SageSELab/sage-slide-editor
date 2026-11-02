// fonts.ts — the Google Fonts catalog through the Fontsource API (no key), cached on disk, and
// the woff2 files themes and talks embed.
//
//   catalog   GET https://api.fontsource.org/v1/fonts  -> [{id, family, subsets, weights, styles,
//             defSubset, variable, category, license, type}, ...] (about 2,100 fonts, 540 KB)
//   files     https://cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-<style>.woff2
//
// The catalog is cached as catalog.json under the cache folder for a week; when the network
// fails a stale cache is used. Downloaded files are cached too (files/<id>/), so applying a
// theme twice, or to two talks, downloads once. Only fonts whose license allows embedding and
// redistribution as reported by the catalog (OFL-1.1, Apache-2.0) are offered.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fontFileName } from '@sage/core';

export const CATALOG_URL = 'https://api.fontsource.org/v1/fonts';
export const fileUrl = (id: string, subset: string, weight: number, style: string) =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/${subset}-${weight}-${style}.woff2`;
export const EMBEDDABLE_LICENSES = ['OFL-1.1', 'Apache-2.0'] as const;
const WEEK_MS = 7 * 24 * 3600_000;

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace' | 'other';
export interface FontInfo {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  variable: boolean;
  license: string;
}

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export class FontError extends Error {
  /** unknown-font, license, variant, network, not-woff2 */
  constructor(readonly code: string, message: string) { super(message); this.name = 'FontError'; }
}

/** ~/Library/Caches/io.sagelab.talk/fonts, or SAGE_FONT_CACHE. */
export function defaultFontCache(env: Record<string, string | undefined> = process.env): string {
  return env.SAGE_FONT_CACHE || path.join(os.homedir(), 'Library', 'Caches', 'io.sagelab.talk', 'fonts');
}

/** Shown for an empty query: well-made families that suit slides. */
export const SUGGESTED = [
  'inter', 'manrope', 'source-sans-3', 'ibm-plex-sans', 'dm-sans', 'work-sans', 'space-grotesk', 'plus-jakarta-sans', 'outfit',
  'fraunces', 'source-serif-4', 'ibm-plex-serif', 'lora', 'playfair-display', 'merriweather', 'eb-garamond',
  'jetbrains-mono', 'ibm-plex-mono', 'fira-code', 'source-code-pro',
];

/** A CSS fallback list for a family by its catalog category. */
export function fallbackFor(category: string): string {
  switch (category) {
    case 'serif': return 'Georgia, "Times New Roman", serif';
    case 'monospace': return 'Menlo, ui-monospace, monospace';
    case 'handwriting': return 'cursive';
    default: return 'system-ui, -apple-system, sans-serif';
  }
}

const slim = (x: Record<string, unknown>): FontInfo | null => {
  if (typeof x.id !== 'string' || typeof x.family !== 'string') return null;
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : []);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);
  return {
    id: x.id, family: x.family, category: typeof x.category === 'string' ? x.category : 'other',
    weights: nums(x.weights), styles: strs(x.styles), subsets: strs(x.subsets),
    defSubset: typeof x.defSubset === 'string' ? x.defSubset : 'latin', variable: x.variable === true,
    license: typeof x.license === 'string' ? x.license : 'unknown',
  };
};

export interface CatalogOptions { cacheDir?: string; fetch?: Fetch; maxAgeMs?: number; log?: (level: 'info' | 'warn', msg: string) => void }

export class FontCatalog {
  readonly cacheDir: string;
  private fetchFn: Fetch;
  private maxAgeMs: number;
  private fonts: FontInfo[] | null = null;
  private source: 'cache' | 'network' | 'stale' = 'cache';
  private loading: Promise<FontInfo[]> | null = null;

  constructor(private opts: CatalogOptions = {}) {
    this.cacheDir = opts.cacheDir ?? defaultFontCache();
    this.fetchFn = opts.fetch ?? ((url) => fetch(url));
    this.maxAgeMs = opts.maxAgeMs ?? WEEK_MS;
  }

  private get catalogFile() { return path.join(this.cacheDir, 'catalog.json'); }

  /** Every embeddable font, from the cache when it is fresh, else from the network. */
  async list(): Promise<{ fonts: FontInfo[]; source: 'cache' | 'network' | 'stale' }> {
    if (!this.fonts) {
      this.loading ??= this.load().finally(() => { this.loading = null; });
      this.fonts = await this.loading;
    }
    return { fonts: this.fonts, source: this.source };
  }

  private async load(): Promise<FontInfo[]> {
    let cached: FontInfo[] | null = null, age = Infinity;
    try {
      const st = fs.statSync(this.catalogFile);
      age = Date.now() - st.mtimeMs;
      cached = (JSON.parse(fs.readFileSync(this.catalogFile, 'utf8')) as { fonts: FontInfo[] }).fonts;
    } catch { /* no cache yet */ }
    if (cached && this.maxAgeMs > 0 && age < this.maxAgeMs) { this.source = 'cache'; return cached; }
    try {
      const r = await this.fetchFn(CATALOG_URL);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const raw = await r.json();
      if (!Array.isArray(raw)) throw new Error('the catalog is not a list');
      const fonts = raw.map((x) => slim(x as Record<string, unknown>)).filter((f): f is FontInfo => !!f && (EMBEDDABLE_LICENSES as readonly string[]).includes(f.license));
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const tmp = this.catalogFile + `.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({ fetched: new Date().toISOString(), url: CATALOG_URL, fonts }));
      fs.renameSync(tmp, this.catalogFile);
      this.source = 'network';
      return fonts;
    } catch (e) {
      if (cached) { this.opts.log?.('warn', `font catalog: ${(e as Error).message}; using the cached copy`); this.source = 'stale'; return cached; }
      throw new FontError('network', `The Google Fonts catalog could not be loaded (${(e as Error).message}). Check the network connection.`);
    }
  }

  async info(id: string): Promise<FontInfo | undefined> {
    return (await this.list()).fonts.find((f) => f.id === id);
  }

  /** Families matching `query` (name, id or category), best first. Empty query: the suggested list. */
  async search(query: string, opts: { category?: string; limit?: number } = {}): Promise<FontInfo[]> {
    const { fonts } = await this.list();
    const limit = Math.max(1, Math.min(opts.limit ?? 40, 200));
    const pool = opts.category ? fonts.filter((f) => f.category === opts.category) : fonts;
    const q = query.trim().toLowerCase();
    if (!q) {
      const byId = new Map(pool.map((f) => [f.id, f]));
      const picks = SUGGESTED.map((id) => byId.get(id)).filter((f): f is FontInfo => !!f);
      return (picks.length ? picks : pool).slice(0, limit);
    }
    const score = (f: FontInfo) => {
      const name = f.family.toLowerCase();
      if (name === q || f.id === q) return 0;
      if (name.startsWith(q)) return 1;
      if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2;
      if (name.includes(q) || f.id.includes(q.replace(/\s+/g, '-'))) return 3;
      if (f.category === q) return 4;
      return -1;
    };
    return pool.map((f) => [score(f), f] as const).filter(([s]) => s >= 0)
      .sort((a, b) => a[0] - b[0] || a[1].family.length - b[1].family.length || a[1].family.localeCompare(b[1].family))
      .slice(0, limit).map(([, f]) => f);
  }

  /** One woff2 file (cached), after checking the font offers that weight, style and subset. */
  async file(id: string, subset: string, weight: number, style: string): Promise<Buffer> {
    const name = fontFileName(id, subset, weight, style);
    const cached = path.join(this.cacheDir, 'files', id, name);
    if (fs.existsSync(cached)) return fs.readFileSync(cached);
    const f = await this.info(id);
    if (!f) throw new FontError('unknown-font', `"${id}" is not in the Google Fonts catalog (or its license does not allow embedding).`);
    if (!f.weights.includes(weight) || !f.styles.includes(style) || !f.subsets.includes(subset)) {
      throw new FontError('variant', `${f.family} has no ${subset} ${weight} ${style} (weights ${f.weights.join(', ')}; styles ${f.styles.join(', ')}; subsets ${f.subsets.join(', ')}).`);
    }
    let buf: Buffer;
    try {
      const r = await this.fetchFn(fileUrl(id, subset, weight, style));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      throw new FontError('network', `${f.family} ${weight} ${style} could not be downloaded (${(e as Error).message}).`);
    }
    if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') throw new FontError('not-woff2', `${f.family} ${weight} ${style}: the download is not a woff2 file.`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached + `.tmp-${process.pid}`, buf);
    fs.renameSync(cached + `.tmp-${process.pid}`, cached);
    return buf;
  }
}
