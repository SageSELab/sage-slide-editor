// Shared by the theme tests: the built-in themes and a fake Fontsource (no network).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builtinThemesDir } from '../src/themes/index.ts';
import { CATALOG_URL, type Fetch } from '../src/themes/fonts.ts';
import { REPO_ROOT } from './helpers.ts';

export const BUILTINS = builtinThemesDir(path.join(REPO_ROOT, 'packages/sidecar/plugin'));
/** A recorded slice of https://api.fontsource.org/v1/fonts (15 families, one of them UFL-1.0). */
export const CATALOG_FIXTURE = path.join(REPO_ROOT, 'tests/themes/fontsource-catalog.json');
export const A_WOFF2 = fs.readFileSync(path.join(BUILTINS, 'contrast.talktheme/fonts/inter-latin-700-normal.woff2'));

/** A fetch that serves the recorded catalog and a real woff2 for any font file; records the URLs. */
export function fakeFetch(opts: { offline?: boolean; notWoff2?: boolean } = {}): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (opts.offline) throw new Error('getaddrinfo ENOTFOUND');
    const body = url === CATALOG_URL ? fs.readFileSync(CATALOG_FIXTURE) : opts.notWoff2 ? Buffer.from('<html>') : A_WOFF2;
    const ok = url === CATALOG_URL || url.startsWith('https://cdn.jsdelivr.net/fontsource/fonts/');
    return {
      ok, status: ok ? 200 : 404,
      json: async () => JSON.parse(body.toString('utf8')),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

export const tempDir = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
