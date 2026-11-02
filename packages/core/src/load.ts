// load.ts — read a talk folder into a typed model: the spine (validated), and the text of
// every file it names (layers, scenes, theme, lib, motion). Problems are file-level
// diagnostics; loading never throws for a malformed talk.
import fs from 'node:fs';
import path from 'node:path';
import { diag, type Diagnostic } from './diagnostics.ts';
import { JsonSyntaxError, parseJsonAst, type JsonNode } from './jsonast.ts';
import { parseSpine, type ChapterSpec, type TalkSpine } from './schema.ts';

/** A source file of the talk: path relative to the talk folder, and its text. */
export interface SourceFile { path: string; text: string }

/** Where files come from: the disk, or an in-memory map (tests, unsaved buffers). */
export interface FileHost {
  read(rel: string): string | null;
  exists(rel: string): boolean;
}

export function diskHost(dir: string): FileHost {
  return {
    read: (rel) => { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return null; } },
    exists: (rel) => fs.existsSync(path.join(dir, rel)),
  };
}

export function memoryHost(files: Record<string, string>, extra: readonly string[] = []): FileHost {
  return {
    read: (rel) => files[path.posix.normalize(rel)] ?? null,
    exists: (rel) => { const r = path.posix.normalize(rel); return r in files || extra.includes(r); },
  };
}

export interface ChapterSources {
  id: string;
  scene: SourceFile | null;
  /** Resolved motion path (explicit `motion` or the `beats/<id>.js` convention), if the file exists. */
  motion: SourceFile | null;
}

export interface LoadedTalk {
  /** Absolute folder, or '' for an in-memory talk. */
  dir: string;
  host: FileHost;
  spineFile: SourceFile | null;
  /** talk.json as parsed (unknown keys kept). The compiler inlines this, not `spine`. */
  raw: unknown;
  ast: JsonNode | null;
  /** Validated spine, or null when talk.json is missing, malformed, or fails the schema. */
  spine: TalkSpine | null;
  layers: SourceFile | null;
  theme: SourceFile | null;
  lib: SourceFile[];
  chapters: ChapterSources[];
  /** The public end block's sources (PLAN 3.1 `public`), when present. */
  publicChapter: ChapterSources | null;
  diagnostics: Diagnostic[];
}

export const SPINE_FILE = 'talk.json';

/** The motion file a chapter uses: `motion`, else `beats/<id>.js` if that file exists. */
export function motionPath(ch: Pick<ChapterSpec, 'id' | 'motion'>, host: FileHost): string | null {
  if (ch.motion) return ch.motion;
  const conv = `beats/${ch.id}.js`;
  return host.exists(conv) ? conv : null;
}

export function loadTalk(dir: string): LoadedTalk {
  return loadTalkFrom(diskHost(dir), path.resolve(dir));
}

export function loadTalkFrom(host: FileHost, dir = ''): LoadedTalk {
  const t: LoadedTalk = { dir, host, spineFile: null, raw: null, ast: null, spine: null, layers: null, theme: null, lib: [], chapters: [], publicChapter: null, diagnostics: [] };
  const D = t.diagnostics;
  const text = host.read(SPINE_FILE);
  if (text === null) { D.push(diag('file-missing', 'error', 'talk.json not found', { file: SPINE_FILE })); return t; }
  t.spineFile = { path: SPINE_FILE, text };
  try {
    t.ast = parseJsonAst(text);
    t.raw = JSON.parse(text);
  } catch (e) {
    const off = e instanceof JsonSyntaxError ? e.offset : 0;
    D.push(diag('json-syntax', 'error', `talk.json: ${(e as Error).message}`, { file: SPINE_FILE, text, offset: off }));
    return t;
  }
  const r = parseSpine(t.raw, { file: SPINE_FILE, text, ast: t.ast });
  D.push(...r.diagnostics);
  t.spine = r.spine;
  if (!r.spine) return t;
  const sp = r.spine;
  const file = (rel: string | undefined, what: string): SourceFile | null => {
    if (!rel) return null;
    const s = host.read(rel);
    if (s === null) { D.push(diag('file-missing', 'error', `${what} file not found: ${rel}`, { file: SPINE_FILE })); return null; }
    return { path: rel, text: s };
  };
  t.layers = file(sp.layers, 'layers');
  t.theme = file(sp.theme ?? (host.exists('theme.css') ? 'theme.css' : undefined), 'theme');
  t.lib = (sp.lib ?? []).map((p) => file(p, 'lib')).filter((f): f is SourceFile => !!f);
  const chapter = (ch: Pick<ChapterSpec, 'id' | 'motion' | 'scene'>): ChapterSources => ({
    id: ch.id,
    scene: file(ch.scene, `scene (chapter ${ch.id})`),
    motion: file(motionPath(ch, host) ?? undefined, `motion (chapter ${ch.id})`),
  });
  t.chapters = sp.chapters.map(chapter);
  if (sp.public) t.publicChapter = chapter({ id: sp.public.id ?? 'public', motion: sp.public.motion, scene: sp.public.scene });
  return t;
}

/** Every distinct source file of a loaded talk (spine first), for editors and watchers. */
export function talkFiles(t: LoadedTalk): SourceFile[] {
  const seen = new Map<string, SourceFile>();
  const add = (f: SourceFile | null) => { if (f && !seen.has(f.path)) seen.set(f.path, f); };
  add(t.spineFile); add(t.layers); add(t.theme); t.lib.forEach(add);
  for (const c of [...t.chapters, ...(t.publicChapter ? [t.publicChapter] : [])]) { add(c.scene); add(c.motion); }
  return [...seen.values()];
}
