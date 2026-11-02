// jsonedit.ts — formatting-preserving splices of a JSON document (via jsonast ranges).
// New values are emitted as 2-space JSON re-indented to their position; everything else in
// the file keeps its bytes, including key order.
import type { JsonArray, JsonNode, JsonObject } from './jsonast.ts';
import type { Patch } from './patch.ts';

const lineStart = (text: string, off: number) => text.lastIndexOf('\n', off - 1) + 1;
/** Leading whitespace of the line containing `off`. */
export const lineIndent = (text: string, off: number) => /^[ \t]*/.exec(text.slice(lineStart(text, off)))![0];
/** True when `off` is the first non-blank character of its line. */
const ownLine = (text: string, off: number) => !text.slice(lineStart(text, off), off).trim();

/** The file's indent unit, guessed from its first indented line (default two spaces). */
export function indentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1]! : '  ';
}

/** Re-indent continuation lines of a multi-line snippet from one base indent to another. */
export function reindent(snippet: string, from: string, to: string): string {
  if (from === to) return snippet;
  return snippet.split('\n').map((l, i) => (i && l.startsWith(from) ? to + l.slice(from.length) : l)).join('\n');
}

/** JSON for a value, continuation lines indented by `base`. */
export function emit(value: unknown, base: string, unit: string): string {
  return reindent(JSON.stringify(value, null, unit), '', base);
}

/** Patch that sets `key` on an object (replace value, or append a member in the object's style). */
export function setMemberPatch(file: string, text: string, obj: JsonObject, key: string, value: unknown): Patch {
  const unit = indentUnit(text);
  const m = obj.members.find((x) => x.key === key);
  if (m) return { file, range: [m.value.start, m.value.end], newText: emit(value, lineIndent(text, m.keyStart), unit) };
  const last = obj.members[obj.members.length - 1];
  if (!last) {
    const base = lineIndent(text, obj.start);
    return { file, range: [obj.start, obj.end], newText: `{\n${base}${unit}${JSON.stringify(key)}: ${emit(value, base + unit, unit)}\n${base}}` };
  }
  const sep = text.slice(last.keyEnd, last.value.start);
  const multi = ownLine(text, last.keyStart);
  const ind = lineIndent(text, last.keyStart);
  const lead = multi ? `,\n${ind}` : ', ';
  return { file, range: [last.value.end, last.value.end], newText: `${lead}${JSON.stringify(key)}${sep}${emit(value, multi ? ind : '', unit)}` };
}

/** Patch that removes `key` (and its separator); null when absent. */
export function removeMemberPatch(file: string, text: string, obj: JsonObject, key: string): Patch | null {
  const i = obj.members.findIndex((x) => x.key === key);
  if (i < 0) return null;
  const m = obj.members[i]!;
  if (i > 0) return { file, range: [obj.members[i - 1]!.value.end, m.value.end], newText: '' };
  const next = obj.members[i + 1];
  if (next) return { file, range: [m.keyStart, next.keyStart], newText: '' };
  return { file, range: [obj.start, obj.end], newText: '{}' };
}

/** Indent of items in an array (existing first item, else the closing line + one unit). */
export function itemIndent(text: string, arr: JsonArray, parentIndent?: string): string {
  const first = arr.items[0];
  if (first && ownLine(text, first.start)) return lineIndent(text, first.start);
  return (parentIndent ?? lineIndent(text, arr.start)) + indentUnit(text);
}

/**
 * Patch that rewrites an array to hold `items` (raw JSON texts, already indented for
 * `indent`). Multi-line arrays stay one item per line; single-line ones stay single-line.
 */
export function rewriteArrayPatch(file: string, text: string, arr: JsonArray, items: string[], forceMulti = false): Patch {
  const raw = text.slice(arr.start, arr.end);
  const multi = raw.includes('\n') || (forceMulti && items.length > 0);
  if (!items.length) return { file, range: [arr.start, arr.end], newText: '[]' };
  if (!multi) return { file, range: [arr.start, arr.end], newText: `[${items.join(', ')}]` };
  const ind = itemIndent(text, arr);
  const close = ownLine(text, arr.end - 1) ? lineIndent(text, arr.end - 1) : lineIndent(text, arr.start);
  return { file, range: [arr.start, arr.end], newText: `[\n${items.map((t) => ind + t).join(',\n')}\n${close}]` };
}

/** Raw text of an array item, re-indented for a target item indent. */
export function itemText(text: string, node: JsonNode, targetIndent: string): string {
  return reindent(text.slice(node.start, node.end), lineIndent(text, node.start), targetIndent);
}
