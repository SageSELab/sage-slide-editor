// validate.ts — talk diagnostics with stable codes. Every code below has a positive and a
// negative test in test/validate.test.ts.
//
// From load.ts / schema.ts:
//   json-syntax (error)            talk.json is not JSON
//   file-missing (error)           talk.json or a file it names does not exist
//   schema-invalid (error)         talk.json fails the sage-talk/1 schema
//   schema-unknown-key (warning)   a key the schema does not know
// From record.ts:
//   record-script-failed (warning) a lib/motion script could not run headless
//   record-beat-failed (warning)   a beat function threw while recording
//   beat-registered-twice (warning)
// Here:
//   script-syntax (error)          a lib/motion file does not parse (would blank the film)
//   duplicate-chapter-id (error), duplicate-beat-id (error)
//   duplicate-element-id (error)   the same id twice across layers and scenes
//   selector-no-match (warning)    a motion call whose selector matches no element
//   asset-missing (error)          a scene/theme reference to a file that does not exist
//   asset-not-in-build (warning)   a reference outside assets/ (the build copies assets/ only)
//   notes-missing (warning)
//   hold-before-motion-end (warning)  explicit hold earlier than the beat's own motion end
//   ghost-entrance (error)         an entrance (in/show/words) in a beat that starts before
//                                  the beat's start, i.e. before the previous hold, so the
//                                  next beat's element is already (partly) visible at that hold
//   first-owner-opacity (warning)  the first opacity animation on an element is a one-keyframe
//                                  animation while a later one has a from-keyframe: the later one
//                                  no longer fills backwards (registration order is semantic,
//                                  re-checked after every reorder)
//   escape-hatch (info)            use of B.at or B.T
//   beat-no-motion (info)          a spine beat with no Talk.beat registration
//   beat-not-in-spine (warning)    a Talk.beat registration the spine does not list
import { parse as parseJs } from 'acorn';
import { diag, type Diagnostic } from './diagnostics.ts';
import { assetRefs, cssUrls, isLocalRef, sceneElements } from './html.ts';
import { offsetOf } from './jsonast.ts';
import { layoutChapters } from './layout.ts';
import { SPINE_FILE, type LoadedTalk, type SourceFile } from './load.ts';
import { recordTalk, type CallLoc, type Recording } from './record.ts';
import path from 'node:path';

const EPS = 1e-6;

export interface ValidateOptions {
  /** Validate the public cut (private chapters dropped, public block added). */
  public?: boolean;
}

/** Run the recorder (unless given) and every check; returns all diagnostics, sorted. */
export function validateTalk(talk: LoadedTalk, rec?: Recording, opts: ValidateOptions = {}): Diagnostic[] {
  const D: Diagnostic[] = [...talk.diagnostics];
  const spine = talk.spine;
  if (!spine || !talk.spineFile || !talk.ast) return sortDiagnostics(D);
  const sp = { file: SPINE_FILE, text: talk.spineFile.text };
  const at = (p: (string | number)[]) => ({ ...sp, offset: offsetOf(talk.ast!, p) });
  const callAt = (l: CallLoc | undefined) => (l ? { file: l.file, line: l.line, col: l.col } : {});

  // ---- scripts parse ----
  const scripts: SourceFile[] = [...talk.lib];
  for (const c of [...talk.chapters, ...(talk.publicChapter ? [talk.publicChapter] : [])]) if (c.motion && !scripts.some((s) => s.path === c.motion!.path)) scripts.push(c.motion);
  for (const s of scripts) {
    try { parseJs(s.text, { ecmaVersion: 'latest', sourceType: 'script', locations: true }); } catch (e) {
      const loc = (e as { loc?: { line: number; column: number } }).loc;
      D.push(diag('script-syntax', 'error', `syntax error: ${(e as Error).message}`, { file: s.path, line: loc?.line, col: loc ? loc.column + 1 : undefined }));
    }
  }

  // ---- ids in the spine ----
  const beatPaths = new Map<string, (string | number)[]>();
  const chSeen = new Set<string>();
  spine.chapters.forEach((ch, ci) => {
    if (chSeen.has(ch.id)) D.push(diag('duplicate-chapter-id', 'error', `chapter id "${ch.id}" is used twice`, at(['chapters', ci, 'id'])));
    chSeen.add(ch.id);
    ch.beats.forEach((b, bi) => {
      const id = `${ch.id}.${b.id}`, p = ['chapters', ci, 'beats', bi];
      if (beatPaths.has(id)) D.push(diag('duplicate-beat-id', 'error', `beat id "${id}" is used twice`, { ...at([...p, 'id']), beat: id }));
      else beatPaths.set(id, p);
    });
  });
  if (spine.public) spine.public.beats.forEach((b, bi) => {
    const id = `${spine.public!.id ?? 'public'}.${b.id}`;
    if (beatPaths.has(id)) D.push(diag('duplicate-beat-id', 'error', `beat id "${id}" is used twice`, { ...at(['public', 'beats', bi, 'id']), beat: id }));
    else beatPaths.set(id, ['public', 'beats', bi]);
  });
  const beatAt = (id: string, key?: string) => ({ ...at([...(beatPaths.get(id) ?? []), ...(key ? [key] : [])]), beat: id });

  // ---- element ids across layers + scenes; assets ----
  const htmlFiles: SourceFile[] = [];
  const addHtml = (f: SourceFile | null) => { if (f && !htmlFiles.some((h) => h.path === f.path)) htmlFiles.push(f); };
  addHtml(talk.layers); talk.chapters.forEach((c) => addHtml(c.scene)); addHtml(talk.publicChapter?.scene ?? null);
  const ids = new Map<string, string>();
  for (const f of htmlFiles) {
    for (const el of sceneElements(f.text)) {
      if (!el.id) continue;
      const first = ids.get(el.id);
      if (first !== undefined) D.push(diag('duplicate-element-id', 'error', `id "${el.id}" is already used in ${first}`, { file: f.path, text: f.text, offset: el.loc.attrs?.id?.startOffset ?? el.loc.startOffset }));
      else ids.set(el.id, f.path);
    }
    for (const r of assetRefs(f.text)) checkAsset(talk, r.ref, { file: f.path, text: f.text, offset: r.offset }, D);
  }
  if (talk.theme) for (const u of cssUrls(talk.theme.text)) checkAsset(talk, u, { file: talk.theme.path, text: talk.theme.text, offset: talk.theme.text.indexOf(u) }, D);

  // ---- spine content (notes are stripped from the public cut, so not required there) ----
  if (!opts.public) for (const ch of layoutChapters(spine, opts)) for (const b of ch.beats) {
    const id = `${ch.id}.${b.id}`;
    if (!b.notes?.trim()) D.push(diag('notes-missing', 'warning', `beat "${b.label}" has no speaker notes`, beatAt(id)));
  }

  // ---- motion (recorded) ----
  const r = rec ?? recordTalk(talk, opts);
  D.push(...r.diagnostics);
  const spineIds = new Set(r.beats.keys());
  for (const id of new Set(r.registered)) if (!spineIds.has(id) && !beatPaths.has(id)) D.push(diag('beat-not-in-spine', 'warning', `Talk.beat('${id}') is registered but the spine has no such beat`, { beat: id }));
  const owners = new Map<number, { kf: number; loc: CallLoc | undefined; beat: string; flagged: boolean }>();
  const noMatch = new Set<string>();
  for (const lb of r.layout.beats) {
    const b = r.beats.get(lb.id);
    if (!b) continue;
    if (!b.registered) D.push(diag('beat-no-motion', 'info', `beat "${lb.label}" has no Talk.beat('${lb.id}') registration (a pure hold)`, beatAt(lb.id)));
    if (!lb.auto && lb.hold < lb.lastEnd - EPS) D.push(diag('hold-before-motion-end', 'warning', `hold ${lb.hold} is before the beat's motion ends (${+lb.lastEnd.toFixed(3)})`, beatAt(lb.id, 'hold')));
    for (const e of b.escapes) D.push(diag('escape-hatch', 'info', `${e.what} used (absolute-time escape hatch)`, { ...callAt(e.loc), beat: lb.id }));
    for (const c of b.calls) {
      const loc = c.beatLoc ?? c.loc;
      if (c.sel !== undefined && c.n === 0) {
        const key = `${loc?.file}:${loc?.line}:${loc?.col}:${c.sel}`;
        if (!noMatch.has(key)) { noMatch.add(key); D.push(diag('selector-no-match', 'warning', `${c.method}('${c.sel}') matches no element`, { ...callAt(loc), beat: lb.id })); }
      }
      if (c.kind === 'entrance' && c.n && c.start < b.start - EPS) {
        D.push(diag('ghost-entrance', 'error', `${c.method}('${c.sel}') starts ${+(b.start - c.start).toFixed(3)} s before the beat starts, so it shows at the previous hold`, { ...callAt(loc), beat: lb.id }));
      }
      if (c.opacity && c.keyframes) for (const el of c.targets) {
        const o = owners.get(el);
        if (!o) { owners.set(el, { kf: c.keyframes, loc, beat: lb.id, flagged: false }); continue; }
        if (o.kf === 1 && c.keyframes > 1 && !o.flagged) {
          o.flagged = true;
          const name = r.elements[el]?.id ? `#${r.elements[el]!.id}` : (c.sel ?? 'element');
          D.push(diag('first-owner-opacity', 'warning', `the first opacity animation on ${name} has one keyframe, so the later ${c.method}() in ${lb.id} does not fill backwards`, { ...callAt(o.loc), beat: o.beat }));
        }
      }
    }
  }
  return sortDiagnostics(D);
}

function checkAsset(talk: LoadedTalk, ref: string, where: { file: string; text: string; offset: number }, D: Diagnostic[]) {
  if (!isLocalRef(ref)) return;
  const rel = path.posix.normalize(decodeURI(ref.split(/[?#]/)[0]!));
  if (!talk.host.exists(rel)) D.push(diag('asset-missing', 'error', `missing asset: ${ref}`, where));
  else if (!rel.startsWith('assets/')) D.push(diag('asset-not-in-build', 'warning', `${ref} is outside assets/, which is all the build copies`, where));
}

const SEV = { error: 0, warning: 1, info: 2 } as const;
export function sortDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  return ds.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || (a.col ?? 0) - (b.col ?? 0) || SEV[a.severity] - SEV[b.severity]);
}
