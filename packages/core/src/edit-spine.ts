// edit-spine.ts — beat edits on talk.json plus the chapter's motion file: insertBeat,
// deleteBeat, duplicateBeat, moveBeat, setHold, setNotes. talk.json keeps its formatting
// and key order; motion registrations move/copy/rename as whole line blocks.
import { parseJsonAst, member, type JsonArray, type JsonNode, type JsonObject } from './jsonast.ts';
import { emit, indentUnit, itemIndent, itemText, removeMemberPatch, rewriteArrayPatch, setMemberPatch } from './jsonedit.ts';
import type { LoadedTalk, SourceFile } from './load.ts';
import { deletionRange, insertionAfter, quoteId, registrations, renamedBlock } from './motionsrc.ts';
import { EditError, makeEdit, type Edit, type Patch } from './patch.ts';
import type { BeatInput } from './schema.ts';

/** The files a beat edit may touch: talk.json, and each chapter's motion file. */
export interface SpineSources {
  spine: SourceFile;
  /** Motion source of a chapter (by chapter id), if it has one. */
  motion?: (chapterId: string) => SourceFile | undefined;
}

/** SpineSources for a loaded talk. */
export function spineSources(t: LoadedTalk): SpineSources {
  if (!t.spineFile) throw new EditError('no-spine', 'talk has no talk.json');
  const all = [...t.chapters, ...(t.publicChapter ? [t.publicChapter] : [])];
  return { spine: t.spineFile, motion: (id) => all.find((c) => c.id === id)?.motion ?? undefined };
}

interface ChapterRef { obj: JsonObject; beats: JsonArray; id: string }

function chapters(ast: JsonNode): ChapterRef[] {
  const out: ChapterRef[] = [];
  const add = (n: JsonNode | undefined, fallbackId?: string) => {
    if (n?.kind !== 'object') return;
    const idv = member(n, 'id')?.value, b = member(n, 'beats')?.value;
    const id = idv?.kind === 'literal' && typeof idv.value === 'string' ? idv.value : fallbackId;
    if (id && b?.kind === 'array') out.push({ obj: n, beats: b, id });
  };
  const chs = member(ast, 'chapters')?.value;
  if (chs?.kind === 'array') chs.items.forEach((c) => add(c));
  add(member(ast, 'public')?.value, 'public');
  return out;
}

const beatIdOf = (n: JsonNode) => { const v = member(n, 'id')?.value; return v?.kind === 'literal' ? String(v.value) : null; };

function splitRef(ref: string): [string, string] {
  const i = ref.indexOf('.');
  if (i <= 0) throw new EditError('bad-ref', `beat ref must be "chapter.beat", got "${ref}"`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}

/** Find a beat's spine object by `chapter.beat` ref (chapters, then the public block). */
export function locate(src: SpineSources, ref: string) {
  const ast = parseJsonAst(src.spine.text);
  const [chId, bId] = splitRef(ref);
  const ch = chapters(ast).find((c) => c.id === chId);
  if (!ch) throw new EditError('no-chapter', `no chapter "${chId}"`);
  const index = ch.beats.items.findIndex((b) => beatIdOf(b) === bId);
  if (index < 0) throw new EditError('no-beat', `no beat "${ref}"`);
  return { ast, ch, index, node: ch.beats.items[index] as JsonObject, chId, bId };
}

function chapter(src: SpineSources, chId: string) {
  const ast = parseJsonAst(src.spine.text);
  const ch = chapters(ast).find((c) => c.id === chId);
  if (!ch) throw new EditError('no-chapter', `no chapter "${chId}"`);
  return ch;
}

function finish(src: SpineSources, patches: Patch[], extra: SourceFile[] = []): Edit {
  const texts: Record<string, string> = { [src.spine.path]: src.spine.text };
  for (const f of extra) texts[f.path] = f.text;
  return makeEdit(texts, patches);
}

const fmtNum = (n: number) => +n.toFixed(6);

/** Set (or with null, remove) a beat's explicit hold. */
export function setHold(src: SpineSources, ref: string, hold: number | null): Edit {
  if (hold !== null && !(hold >= 0 && Number.isFinite(hold))) throw new EditError('bad-hold', `hold must be a non-negative number`);
  const { node } = locate(src, ref);
  const f = src.spine.path, t = src.spine.text;
  const p = hold === null ? removeMemberPatch(f, t, node, 'hold') : setMemberPatch(f, t, node, 'hold', fmtNum(hold));
  return finish(src, p ? [p] : []);
}

/** Set (or with null, remove) a beat's speaker notes. */
export function setNotes(src: SpineSources, ref: string, notes: string | null): Edit {
  const { node } = locate(src, ref);
  const f = src.spine.path, t = src.spine.text;
  const p = notes === null ? removeMemberPatch(f, t, node, 'notes') : setMemberPatch(f, t, node, 'notes', notes);
  return finish(src, p ? [p] : []);
}

export interface InsertBeatOptions {
  /** Also add an empty `Talk.beat` registration to the chapter's motion file (default true). */
  motionStub?: boolean;
}

/** Beat fields setBeatProps may change (talk.json only; null removes a flag). */
export interface BeatProps { label?: string; backup?: boolean | null; dark?: boolean | null }
/** Chapter fields setChapterProps may change (talk.json only; null removes a flag). */
export interface ChapterProps { label?: string; dark?: boolean | null; private?: boolean | null; backup?: boolean | null }

/**
 * Set or remove members of one spine object, one property at a time (each against the text the
 * previous one produced, so neighbouring separators stay consistent), as a single Edit.
 */
function setProps(src: SpineSources, find: (s: SpineSources) => JsonObject, props: Readonly<Record<string, unknown>>, allowed: readonly string[], what: string): Edit {
  let text = src.spine.text;
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.includes(k)) throw new EditError('bad-prop', `${what} property "${k}" cannot be set here`);
    if (v === undefined) continue;
    if (k === 'label' ? typeof v !== 'string' : v !== null && typeof v !== 'boolean') throw new EditError('bad-value', `${what} ${k} must be ${k === 'label' ? 'a string' : 'a boolean or null'}`);
    const obj = find({ ...src, spine: { path: src.spine.path, text } });
    const p = v === null ? removeMemberPatch(src.spine.path, text, obj, k) : setMemberPatch(src.spine.path, text, obj, k, v);
    if (p) text = text.slice(0, p.range[0]) + p.newText + text.slice(p.range[1]);
  }
  return finish(src, text === src.spine.text ? [] : [{ file: src.spine.path, range: [0, src.spine.text.length], newText: text }]);
}

/** Set a beat's label, backup or dark flag. */
export function setBeatProps(src: SpineSources, ref: string, props: BeatProps): Edit {
  return setProps(src, (s) => locate(s, ref).node, props as Record<string, unknown>, ['label', 'backup', 'dark'], 'beat');
}

/** Set a chapter's label, dark, private or backup flag. */
export function setChapterProps(src: SpineSources, chapterId: string, props: ChapterProps): Edit {
  return setProps(src, (s) => chapter(s, chapterId).obj, props as Record<string, unknown>, ['label', 'dark', 'private', 'backup'], 'chapter');
}

/** Insert a new beat at `index` of a chapter (index = beats.length appends). */
export function insertBeat(src: SpineSources, chapterId: string, index: number, beat: BeatInput, opts: InsertBeatOptions = {}): Edit {
  const ch = chapter(src, chapterId);
  const items = ch.beats.items;
  if (index < 0 || index > items.length) throw new EditError('bad-index', `index ${index} out of range 0..${items.length}`);
  if (!/^[A-Za-z0-9_-]+$/.test(beat.id)) throw new EditError('bad-id', `bad beat id "${beat.id}"`);
  if (items.some((b) => beatIdOf(b) === beat.id)) throw new EditError('duplicate-beat', `beat "${chapterId}.${beat.id}" exists`);
  const t = src.spine.text, f = src.spine.path, ind = itemIndent(t, ch.beats);
  const texts = items.map((b) => itemText(t, b, ind));
  texts.splice(index, 0, emit(beat, ind, indentUnit(t)));
  const patches: Patch[] = [rewriteArrayPatch(f, t, ch.beats, texts, true)];
  const extra: SourceFile[] = [];
  const mf = src.motion?.(chapterId);
  if (mf && opts.motionStub !== false) {
    const regs = registrations(mf.text);
    const prevId = index > 0 ? beatIdOf(items[index - 1]!) : null;
    const prev = prevId ? regs.find((r) => r.id === `${chapterId}.${prevId}`) : undefined;
    const ins = insertionAfter(mf.text, prev, `Talk.beat('${chapterId}.${beat.id}', (B) => {\n});\n`);
    patches.push({ file: mf.path, range: [ins.at, ins.at], newText: ins.newText });
    extra.push(mf);
  }
  return finish(src, patches, extra);
}

/** Delete a beat and (by default) its motion registration. */
export function deleteBeat(src: SpineSources, ref: string, opts: { motion?: boolean } = {}): Edit {
  const { ch, index, chId } = locate(src, ref);
  const t = src.spine.text, f = src.spine.path, ind = itemIndent(t, ch.beats);
  const texts = ch.beats.items.map((b) => itemText(t, b, ind));
  texts.splice(index, 1);
  const patches: Patch[] = [rewriteArrayPatch(f, t, ch.beats, texts)];
  const extra: SourceFile[] = [];
  const mf = src.motion?.(chId);
  const reg = mf && opts.motion !== false ? registrations(mf.text).find((r) => r.id === ref) : undefined;
  if (mf && reg) { patches.push({ file: mf.path, range: deletionRange(mf.text, reg), newText: '' }); extra.push(mf); }
  return finish(src, patches, extra);
}

/** Copy a beat (spine entry and motion registration) right after itself under `newId`. */
export function duplicateBeat(src: SpineSources, ref: string, newId: string, label?: string): Edit {
  const { ch, index, node, chId } = locate(src, ref);
  if (!/^[A-Za-z0-9_-]+$/.test(newId)) throw new EditError('bad-id', `bad beat id "${newId}"`);
  if (ch.beats.items.some((b) => beatIdOf(b) === newId)) throw new EditError('duplicate-beat', `beat "${chId}.${newId}" exists`);
  const t = src.spine.text, f = src.spine.path, ind = itemIndent(t, ch.beats);
  const texts = ch.beats.items.map((b) => itemText(t, b, ind));
  // copy the raw object text, then rewrite its id (and label) in place
  const copyPatches = [setMemberPatch('x', t, node, 'id', newId), ...(label !== undefined ? [setMemberPatch('x', t, node, 'label', label)] : [])]
    .sort((a, b) => b.range[0] - a.range[0]);
  let copy = t;
  for (const p of copyPatches) copy = copy.slice(0, p.range[0]) + p.newText + copy.slice(p.range[1]);
  const shift = copy.length - t.length;
  texts.splice(index + 1, 0, itemText(copy, { ...node, end: node.end + shift }, ind));
  const patches: Patch[] = [rewriteArrayPatch(f, t, ch.beats, texts)];
  const extra: SourceFile[] = [];
  const mf = src.motion?.(chId);
  const reg = mf ? registrations(mf.text).find((r) => r.id === ref) : undefined;
  if (mf && reg) {
    const ins = insertionAfter(mf.text, reg, renamedBlock(mf.text, reg, `${chId}.${newId}`));
    patches.push({ file: mf.path, range: [ins.at, ins.at], newText: ins.newText });
    extra.push(mf);
  }
  return finish(src, patches, extra);
}

/**
 * Move a beat to `toIndex` of chapter `toChapter` (index in the target list after removal).
 * Across chapters the beat's id becomes `toChapter.<beat>`, so its registration moves to the
 * target chapter's motion file and is renamed.
 */
export function moveBeat(src: SpineSources, ref: string, toChapter: string, toIndex: number): Edit {
  const { ch, index, node, chId, bId } = locate(src, ref);
  const t = src.spine.text, f = src.spine.path;
  if (toChapter === chId) {
    const ind = itemIndent(t, ch.beats);
    const texts = ch.beats.items.map((b) => itemText(t, b, ind));
    const [moved] = texts.splice(index, 1);
    if (toIndex < 0 || toIndex > texts.length) throw new EditError('bad-index', `index ${toIndex} out of range 0..${texts.length}`);
    texts.splice(toIndex, 0, moved!);
    return finish(src, [rewriteArrayPatch(f, t, ch.beats, texts)]);
  }
  const to = chapter(src, toChapter);
  if (to.beats.items.some((b) => beatIdOf(b) === bId)) throw new EditError('duplicate-beat', `beat "${toChapter}.${bId}" exists`);
  if (toIndex < 0 || toIndex > to.beats.items.length) throw new EditError('bad-index', `index ${toIndex} out of range 0..${to.beats.items.length}`);
  const fromInd = itemIndent(t, ch.beats), toInd = itemIndent(t, to.beats);
  const fromTexts = ch.beats.items.map((b) => itemText(t, b, fromInd));
  fromTexts.splice(index, 1);
  const toTexts = to.beats.items.map((b) => itemText(t, b, toInd));
  toTexts.splice(toIndex, 0, itemText(t, node, toInd));
  const patches: Patch[] = [rewriteArrayPatch(f, t, ch.beats, fromTexts), rewriteArrayPatch(f, t, to.beats, toTexts, true)];
  const extra = new Map<string, SourceFile>();
  const mf = src.motion?.(chId), mt = src.motion?.(toChapter);
  const reg = mf ? registrations(mf.text).find((r) => r.id === ref) : undefined;
  const newRef = `${toChapter}.${bId}`;
  if (mf && reg) {
    extra.set(mf.path, mf);
    if (mt && mt.path === mf.path) patches.push({ file: mf.path, range: [reg.idStart, reg.idEnd], newText: quoteId(newRef, reg.quote) });
    else if (mt) {
      const regsT = registrations(mt.text);
      const prevId = toIndex > 0 ? beatIdOf(to.beats.items[toIndex - 1]!) : null;
      const prev = prevId ? regsT.find((r) => r.id === `${toChapter}.${prevId}`) : undefined;
      const ins = insertionAfter(mt.text, prev, renamedBlock(mf.text, reg, newRef));
      patches.push({ file: mf.path, range: deletionRange(mf.text, reg), newText: '' }, { file: mt.path, range: [ins.at, ins.at], newText: ins.newText });
      extra.set(mt.path, mt);
    } else throw new EditError('no-motion-file', `chapter "${toChapter}" has no motion file to move the registration into`);
  }
  return finish(src, patches, [...extra.values()]);
}
