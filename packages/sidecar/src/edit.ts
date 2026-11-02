// edit.ts — talk.edit and talk.revert (PLAN 2 autosave rule, 4 source-edit API, 13 risk 5).
//
// An edit is computed by @sage/core against the files as they are on disk now, then written
// atomically: every touched file is announced to the watcher (so the change is labelled 'app')
// and written to a temp file before any is renamed into place. The result carries the inverse
// patches plus a digest of each touched file as the edit left it. talk.revert applies such an
// inverse only if every file still has that digest, so an undo never clobbers an external or
// Claude edit that landed in between (EditConflict).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  EditError, applyPatches, recordTalk, deleteBeat, duplicateBeat, insertBeat, loadTalk, makeEdit, moveBeat, sceneElements, setAttr,
  setBeatProps, setChapterProps, setHold, setNotes, setStyle, setText, spineSources, stretchBeat,
  type Edit, type LoadedTalk, type Patch, type SourceFile,
} from '@sage/core';
import { ErrorCode, RpcError, type EditParams, type Inverse, type StretchSkip } from './protocol.ts';
import type { TalkWatcher, WriteAuthor } from './watcher.ts';

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** What an applied edit wrote: the new texts by file and their inverse. */
export interface Applied {
  changed: string[];
  inverse: Inverse;
  stretch?: { stretched: number; skipped: StretchSkip[] };
}

const failed = (e: unknown): never => {
  if (e instanceof EditError) throw new RpcError(ErrorCode.EditFailed, e.message, { code: e.code });
  throw e;
};

/** The scene file (layers, chapter scenes, public scene) that holds #id. */
function sceneFor(talk: LoadedTalk, id: string, scene?: string): SourceFile {
  const files = new Map<string, SourceFile>();
  if (talk.layers) files.set(talk.layers.path, talk.layers);
  for (const c of [...talk.chapters, ...(talk.publicChapter ? [talk.publicChapter] : [])]) if (c.scene) files.set(c.scene.path, c.scene);
  if (scene !== undefined) {
    const f = files.get(scene);
    if (!f) throw new RpcError(ErrorCode.EditFailed, `${scene} is not a scene of this talk`, { code: 'no-scene' });
    return f;
  }
  const hits = [...files.values()].filter((f) => sceneElements(f.text).some((e) => e.id === id));
  if (!hits.length) throw new RpcError(ErrorCode.EditFailed, `no element #${id} in any scene file (generated elements cannot be edited here)`, { code: 'no-element' });
  if (hits.length > 1) throw new RpcError(ErrorCode.EditFailed, `#${id} is in ${hits.map((f) => f.path).join(' and ')}; name the scene`, { code: 'duplicate-element' });
  return hits[0]!;
}

/**
 * Element ids whose text the film rewrites while it plays: targets of count, type, or a
 * `B.set` that steps `text`. Editing such an element in place would capture whatever the
 * runtime happened to show and write it into the source.
 */
export function runtimeTextKeys(talk: LoadedTalk): string[] {
  const rec = recordTalk(talk);
  const keys = new Set<string>();
  for (const b of rec.beats.values()) for (const c of b.calls) {
    const m = c.method.replace(/^T\./, '');
    if (m === 'count' || m === 'type' || (m === 'set' && c.keys?.includes('text'))) {
      for (const i of c.targets) { const el = rec.elements[i]; if (el) keys.add(el.key); }
    }
  }
  return [...keys];
}

/** Refuses a text edit that would contain runtime-rewritten text (PLAN 13, risk 4). */
function guardRuntimeText(talk: LoadedTalk, id: string, html: string) {
  const hits = runtimeTextKeys(talk).filter((k) => {
    if (k === '#' + id || k.startsWith('#' + id + '/')) return true; // the element or an unnamed descendant
    const own = /^#([^/]+)/.exec(k)?.[1];
    return !!own && new RegExp(`\\bid\\s*=\\s*["']${own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html); // a named descendant
  });
  if (hits.length) {
    throw new RpcError(ErrorCode.EditFailed, `#${id} contains text the film rewrites while it plays (${hits.join(', ')}); edit it in the beat's motion instead`, { code: 'runtime-text' });
  }
}

/** Computes the core Edit for an op against the talk as loaded from disk. */
export function computeEdit(talk: LoadedTalk, p: EditParams): Edit & { stretch?: Applied['stretch'] } {
  try {
    const spine = () => spineSources(talk);
    switch (p.op) {
      case 'setText': {
        const scene = sceneFor(talk, p.args.id, p.args.scene);
        guardRuntimeText(talk, p.args.id, p.args.html);
        return setText(scene, p.args.id, p.args.html);
      }
      case 'setStyle': return setStyle(sceneFor(talk, p.args.id, p.args.scene), p.args.id, p.args.style);
      case 'setAttr': return setAttr(sceneFor(talk, p.args.id, p.args.scene), p.args.id, p.args.name, p.args.value);
      case 'insertBeat': return insertBeat(spine(), p.args.chapter, p.args.index, p.args.beat);
      case 'deleteBeat': return deleteBeat(spine(), p.args.ref);
      case 'duplicateBeat': return duplicateBeat(spine(), p.args.ref, p.args.newId, p.args.label);
      case 'moveBeat': return moveBeat(spine(), p.args.ref, p.args.chapter, p.args.index);
      case 'setHold': return setHold(spine(), p.args.ref, p.args.hold);
      case 'setNotes': return setNotes(spine(), p.args.ref, p.args.notes);
      case 'stretchBeat': {
        const r = stretchBeat(spine(), p.args.ref, p.args.factor);
        return { patches: r.patches, inverse: r.inverse, stretch: { stretched: r.stretched, skipped: r.skipped } };
      }
      case 'setBeat': return setBeatProps(spine(), p.args.ref, p.args.props);
      case 'setChapter': return setChapterProps(spine(), p.args.chapter, p.args.props);
    }
  } catch (e) { return failed(e); }
}

/** Resolves a talk-relative path, refusing anything outside the talk or in build/ or .sage/. */
function safePath(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs).split(path.sep).join('/');
  if (back.startsWith('..') || path.isAbsolute(back) || back !== rel || /^(build|\.sage)(\/|$)/.test(back)) {
    throw new RpcError(ErrorCode.InvalidParams, `${rel} is not a source file of this talk`);
  }
  return abs;
}

/**
 * Writes the new texts: each announced to the watcher and staged under .sage/tmp, then all
 * renamed into place, so a failure while staging leaves every file untouched.
 */
export function writeAll(root: string, watcher: TalkWatcher | null, texts: ReadonlyMap<string, string | Buffer>, author: WriteAuthor = 'app') {
  const tmpDir = path.join(root, '.sage', 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const staged: [tmp: string, abs: string][] = [];
  try {
    let n = 0;
    for (const [rel, text] of texts) {
      const tmp = path.join(tmpDir, `${path.basename(rel)}.tmp-${process.pid}-${Date.now()}-${n++}`);
      fs.writeFileSync(tmp, text);
      staged.push([tmp, safePath(root, rel)]);
    }
  } catch (e) {
    for (const [tmp] of staged) fs.rmSync(tmp, { force: true });
    throw e;
  }
  for (const [rel, text] of texts) watcher?.expectWrite(rel, text, author);
  for (const [tmp, abs] of staged) fs.renameSync(tmp, abs);
}

/** Applies patches (against the given current texts) to disk and returns the inverse. */
function commit(root: string, watcher: TalkWatcher | null, current: ReadonlyMap<string, string>, patches: readonly Patch[], author: WriteAuthor = 'app'): Applied {
  const texts = Object.fromEntries(current);
  let e: Edit;
  try { e = makeEdit(texts, patches); } catch (err) { return failed(err); }
  const next = new Map<string, string>();
  for (const f of new Set(e.patches.map((p) => p.file))) next.set(f, applyPatches(texts[f]!, e.patches, f));
  writeAll(root, watcher, next, author);
  const digests: Record<string, string> = {};
  for (const [f, t] of next) digests[f] = sha256(t);
  return { changed: [...next.keys()].sort(), inverse: { patches: e.inverse, digests } };
}

/**
 * talk.edit: compute against disk, write atomically, return the inverse. `author` labels the
 * writes for the watcher: 'app' for the user's edits, 'claude' for the Claude pane's spine tools.
 */
export function applyEdit(root: string, watcher: TalkWatcher | null, p: EditParams, author: WriteAuthor = 'app'): Applied {
  const talk = loadTalk(root);
  if (!talk.spine) throw new RpcError(ErrorCode.EditFailed, `talk.json cannot be loaded: ${talk.diagnostics.find((d) => d.severity === 'error')?.message ?? 'invalid'}`, { code: 'invalid-spine' });
  const e = computeEdit(talk, p);
  const current = new Map<string, string>();
  for (const f of new Set(e.patches.map((x) => x.file))) current.set(f, fs.readFileSync(safePath(root, f), 'utf8'));
  const out = commit(root, watcher, current, e.patches, author);
  return e.stretch ? { ...out, stretch: e.stretch } : out;
}

/** talk.revert: refuse when any touched file's digest changed, else apply the inverse. */
export function applyInverse(root: string, watcher: TalkWatcher | null, inv: Inverse): Applied {
  const files = new Set(inv.patches.map((p) => p.file));
  for (const f of files) if (!(f in inv.digests)) throw new RpcError(ErrorCode.InvalidParams, `params.digests: no digest for ${f}`);
  const current = new Map<string, string>();
  const conflicts: string[] = [];
  for (const f of Object.keys(inv.digests).sort()) {
    let text: string | null = null;
    try { text = fs.readFileSync(safePath(root, f), 'utf8'); } catch (e) { if (e instanceof RpcError) throw e; }
    if (text === null || sha256(text) !== inv.digests[f]) conflicts.push(f);
    else current.set(f, text);
  }
  if (conflicts.length) {
    throw new RpcError(ErrorCode.EditConflict, `${conflicts.join(', ')} changed since this edit; it can no longer be undone`, { files: conflicts });
  }
  return commit(root, watcher, current, inv.patches);
}

/**
 * A computed text edit (theme.apply, fonts.add): `make` gets the current texts of `files`
 * (a missing file reads as '', and is created) and returns patches against them. Binary files
 * are written first, each announced and atomic, and are not part of the inverse: an undo
 * restores the text files and leaves the extra files (fonts) in place, unreferenced.
 */
export function applyComputed(
  root: string, watcher: TalkWatcher | null, files: readonly string[], make: (texts: Readonly<Record<string, string>>) => Patch[],
  binaries: readonly { rel: string; content: Buffer }[] = [], author: WriteAuthor = 'app',
): Applied {
  const current = new Map<string, string>();
  for (const f of files) {
    const abs = safePath(root, f);
    current.set(f, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
  }
  const patches = make(Object.fromEntries(current));
  const written: string[] = [];
  for (const b of binaries) {
    const abs = safePath(root, b.rel);
    if (fs.existsSync(abs) && fs.readFileSync(abs).equals(b.content)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeAll(root, watcher, new Map([[b.rel, b.content]]), author);
    written.push(b.rel);
  }
  const out = commit(root, watcher, current, patches, author);
  return written.length ? { ...out, changed: [...new Set([...out.changed, ...written])].sort() } : out;
}
