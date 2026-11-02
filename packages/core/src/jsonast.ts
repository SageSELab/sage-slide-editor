// jsonast.ts — a small position-aware JSON parser. It gives every value its byte range so
// diagnostics can point into talk.json and edits can splice it without reformatting the file.

export type JsonNode = JsonObject | JsonArray | JsonLiteral;
interface Base { start: number; end: number }
export interface JsonMember { key: string; keyStart: number; keyEnd: number; value: JsonNode }
export interface JsonObject extends Base { kind: 'object'; members: JsonMember[] }
export interface JsonArray extends Base { kind: 'array'; items: JsonNode[] }
export interface JsonLiteral extends Base { kind: 'literal'; value: string | number | boolean | null }

export class JsonSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) { super(message); this.offset = offset; }
}

export function parseJsonAst(text: string): JsonNode {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const fail = (m: string): never => { throw new JsonSyntaxError(m, i); };
  const str = (): string => {
    const s = i;
    i++;
    while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
    if (i >= text.length) fail('unterminated string');
    i++;
    return JSON.parse(text.slice(s, i)) as string;
  };
  const value = (): JsonNode => {
    ws();
    const s = i, c = text[i];
    if (c === '{') {
      i++; ws();
      const members: JsonMember[] = [];
      if (text[i] === '}') { i++; return { kind: 'object', start: s, end: i, members }; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a property name');
        const keyStart = i, key = str(), keyEnd = i;
        ws();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        members.push({ key, keyStart, keyEnd, value: value() });
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { kind: 'object', start: s, end: i, members }; }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i++; ws();
      const items: JsonNode[] = [];
      if (text[i] === ']') { i++; return { kind: 'array', start: s, end: i, items }; }
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return { kind: 'array', start: s, end: i, items }; }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return { kind: 'literal', start: s, value: str(), end: i };
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) return fail('unexpected token');
    i += m[0].length;
    return { kind: 'literal', start: s, end: i, value: JSON.parse(m[0]) as JsonLiteral['value'] };
  };
  const root = value();
  ws();
  if (i < text.length) fail('unexpected trailing content');
  return root;
}

export const member = (o: JsonNode | undefined, key: string): JsonMember | undefined =>
  o?.kind === 'object' ? o.members.find((m) => m.key === key) : undefined;

/** Follow a path of keys / indices; returns the node or undefined. */
export function nodeAt(root: JsonNode, path: readonly (string | number)[]): JsonNode | undefined {
  let n: JsonNode | undefined = root;
  for (const p of path) {
    if (!n) return undefined;
    if (typeof p === 'number') n = n.kind === 'array' ? n.items[p] : undefined;
    else n = member(n, p)?.value;
  }
  return n;
}

/** Offset to report for a path: the deepest existing node on it (key position for members). */
export function offsetOf(root: JsonNode, path: readonly PropertyKey[]): number {
  let n: JsonNode = root, off = root.start;
  for (const p of path) {
    if (typeof p === 'number' && n.kind === 'array' && n.items[p]) { n = n.items[p]; off = n.start; continue; }
    const m = typeof p === 'string' ? member(n, p) : undefined;
    if (!m) break;
    off = m.keyStart; n = m.value;
  }
  return off;
}
