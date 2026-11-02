// patch.ts — text patches and invertible edits. Every source edit is a set of byte-range
// replacements against the files' current text, plus the inverse set against the result.

/** Replace `range` ([start, end) offsets in the file's current text) with `newText`. */
export interface Patch { file: string; range: [number, number]; newText: string }

/** An edit: patches to apply, and the patches that undo them (against the edited text). */
export interface Edit { patches: Patch[]; inverse: Patch[] }

export class EditError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'EditError'; }
}

/** Shrink a patch to the bytes that actually change (common prefix/suffix dropped). */
export function minimize(text: string, p: Patch): Patch {
  const [s, e] = p.range, old = text.slice(s, e), nt = p.newText;
  let a = 0;
  while (a < old.length && a < nt.length && old[a] === nt[a]) a++;
  let b = 0;
  while (b < old.length - a && b < nt.length - a && old[old.length - 1 - b] === nt[nt.length - 1 - b]) b++;
  return { file: p.file, range: [s + a, e - b], newText: nt.slice(a, nt.length - b) };
}

/**
 * Build an Edit from patches against `texts` (file -> current text). Patches are minimized,
 * no-ops dropped, overlaps rejected, and the inverse computed.
 */
export function makeEdit(texts: Readonly<Record<string, string>>, patches: readonly Patch[]): Edit {
  const out: Patch[] = [], inverse: Patch[] = [];
  const byFile = new Map<string, Patch[]>();
  for (const p of patches) {
    const text = texts[p.file];
    if (text === undefined) throw new EditError('no-file', `no text for ${p.file}`);
    if (p.range[0] < 0 || p.range[1] > text.length || p.range[0] > p.range[1]) throw new EditError('bad-range', `bad range ${p.range} in ${p.file}`);
    const m = minimize(text, p);
    if (m.range[0] === m.range[1] && !m.newText) continue;
    const list = byFile.get(p.file) ?? [];
    list.push(m); byFile.set(p.file, list);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.range[0] - b.range[0] || a.range[1] - b.range[1]);
    let delta = 0, prevEnd = -1;
    for (const p of list) {
      if (p.range[0] < prevEnd) throw new EditError('overlap', `overlapping patches in ${file}`);
      prevEnd = p.range[1];
      const start = p.range[0] + delta;
      inverse.push({ file, range: [start, start + p.newText.length], newText: texts[file]!.slice(p.range[0], p.range[1]) });
      delta += p.newText.length - (p.range[1] - p.range[0]);
      out.push(p);
    }
  }
  return { patches: out, inverse };
}

/** Apply the patches for one file to its text (ranges refer to `text`). */
export function applyPatches(text: string, patches: readonly Patch[], file?: string): string {
  const list = patches.filter((p) => file === undefined || p.file === file).sort((a, b) => b.range[0] - a.range[0]);
  let s = text;
  for (const p of list) s = s.slice(0, p.range[0]) + p.newText + s.slice(p.range[1]);
  return s;
}

/** Apply patches to a set of files; returns the new texts (unchanged files kept). */
export function applyToTexts(texts: Readonly<Record<string, string>>, patches: readonly Patch[]): Record<string, string> {
  const out = { ...texts };
  for (const file of new Set(patches.map((p) => p.file))) out[file] = applyPatches(texts[file] ?? '', patches, file);
  return out;
}
