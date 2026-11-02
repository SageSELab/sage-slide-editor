// motionsrc.ts — locate `Talk.beat('<id>', fn)` registrations in a motion file (acorn), with
// the line block each one occupies (attached leading comments included).
import { parse, type Comment, type Node } from 'acorn';

export interface Registration {
  id: string;
  /** The ExpressionStatement. */
  start: number;
  end: number;
  /** Range of the id string literal (quotes included) and its quote character. */
  idStart: number;
  idEnd: number;
  quote: string;
  /** Whole lines: attached leading comments through the end of the statement's line. */
  blockStart: number;
  blockEnd: number;
  /** The beat function node (for stretchBeat). */
  fn: Node | null;
}

type AnyNode = Node & Record<string, any>;

export function parseScript(text: string): { ast: AnyNode; comments: Comment[] } {
  const comments: Comment[] = [];
  const ast = parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true, onComment: comments }) as AnyNode;
  return { ast, comments };
}

export function registrations(text: string): Registration[] {
  const { ast, comments } = parseScript(text);
  const out: Registration[] = [];
  for (const st of ast.body as AnyNode[]) {
    const ex = st.type === 'ExpressionStatement' ? st.expression : null;
    if (!ex || ex.type !== 'CallExpression') continue;
    const c = ex.callee;
    if (c.type !== 'MemberExpression' || c.object.type !== 'Identifier' || c.object.name !== 'Talk' || c.property.name !== 'beat') continue;
    const a0 = ex.arguments[0];
    if (!a0 || a0.type !== 'Literal' || typeof a0.value !== 'string') continue;
    // attached comments: walk back over comments separated only by whitespace with <= 1 newline
    let bs = st.start as number;
    for (let i = comments.length - 1; i >= 0; i--) {
      const cm = comments[i]!;
      if (cm.end > bs) continue;
      const gap = text.slice(cm.end, bs);
      if (gap.trim() || (gap.match(/\n/g)?.length ?? 0) > 1) break;
      bs = cm.start;
    }
    const ls = text.lastIndexOf('\n', bs - 1) + 1;
    const nl = text.indexOf('\n', st.end);
    out.push({
      id: a0.value, start: st.start, end: st.end, idStart: a0.start, idEnd: a0.end, quote: text[a0.start]!,
      blockStart: text.slice(ls, bs).trim() ? bs : ls, blockEnd: nl < 0 ? text.length : nl + 1,
      fn: ex.arguments[1] ?? null,
    });
  }
  return out;
}

/** A JS string literal for an id in the given quote style. */
export const quoteId = (id: string, q: string) => q + id.replace(/\\/g, '\\\\').split(q).join('\\' + q) + q;

/** The block text of a registration with its id replaced. */
export function renamedBlock(text: string, r: Registration, newId: string): string {
  const s = text.slice(r.blockStart, r.blockEnd);
  const lit = quoteId(newId, r.quote);
  const out = s.slice(0, r.idStart - r.blockStart) + lit + s.slice(r.idEnd - r.blockStart);
  return out.endsWith('\n') ? out : out + '\n';
}

/** Range that deletes a registration block cleanly (one adjacent blank line goes with it). */
export function deletionRange(text: string, r: Registration): [number, number] {
  let s = r.blockStart, e = r.blockEnd;
  const after = /^[ \t]*\n/.exec(text.slice(e));
  if (after) e += after[0].length;
  else { const before = /\n[ \t]*\n$/.exec(text.slice(0, s)); if (before) s -= before[0].length - 1; }
  return [s, e];
}

/** Insert `block` after registration `r` (or at the end), separated by a blank line. */
export function insertionAfter(text: string, r: Registration | undefined, block: string): { at: number; newText: string } {
  if (r) return { at: r.blockEnd, newText: '\n' + block };
  const at = text.length;
  const lead = !text ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { at, newText: lead + block };
}
