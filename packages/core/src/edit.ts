// edit.ts — the source-edit API (PLAN 4). Every operation reads source text and returns an
// Edit: {file, range, newText} patches plus their inverse; nothing is written here.
// Scene edits: setText, setStyle, setAttr. Beat edits (talk.json + motion): insertBeat,
// moveBeat, deleteBeat, duplicateBeat, setHold, setNotes, stretchBeat.
// applyEditToDisk writes an edit (or its inverse) into a talk folder.
import fs from 'node:fs';
import path from 'node:path';
import { applyPatches, EditError, type Patch } from './patch.ts';

export { setText, setStyle, setAttr, patchStyle, STYLE_KEYS, type StyleProps, isAddress, parseAddress, resolveAddress, newIdFor, assignId, stepClass, type AddressStep } from './edit-html.ts';
export { insertBeat, deleteBeat, duplicateBeat, moveBeat, setHold, setNotes, setBeatProps, setChapterProps, spineSources, type SpineSources, type InsertBeatOptions, type BeatProps, type ChapterProps } from './edit-spine.ts';
export { stretchBeat, type StretchResult, type StretchSkip } from './stretch.ts';
export { applyPatches, applyToTexts, makeEdit, EditError, type Edit, type Patch } from './patch.ts';

/**
 * Apply patches to files under `dir`. `expect` (file -> text the patches were computed
 * against) guards against a file changing underneath: a mismatch throws and writes nothing.
 */
export function applyEditToDisk(dir: string, patches: readonly Patch[], expect?: Readonly<Record<string, string>>): string[] {
  const files = [...new Set(patches.map((p) => p.file))];
  const next = new Map<string, string>();
  for (const f of files) {
    const abs = path.join(dir, f);
    const cur = fs.readFileSync(abs, 'utf8');
    if (expect && expect[f] !== undefined && expect[f] !== cur) throw new EditError('stale', `${f} changed since the edit was computed`);
    next.set(abs, applyPatches(cur, patches, f));
  }
  for (const [abs, text] of next) fs.writeFileSync(abs, text);
  return files;
}
