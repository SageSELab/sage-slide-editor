// stretch.ts — stretchBeat: scale a beat's relative times by a factor, in its motion source.
//
// Rewritten: numeric-literal time arguments of direct `B.<method>(...)` calls (start times,
// durations) and literal `dur` / `stagger` in their options object, plus the beat's explicit
// `hold` in talk.json. A call is rewritten all-or-nothing; these forms are reported in
// `skipped` and left untouched:
//   - non-literal time arguments (`0.4 + i * 0.1`, variables, template-computed values)
//   - an options argument that is not an object literal, or non-literal dur/stagger in it
//   - helper calls that receive B (`B.lib.x(B, …)`, `W.px(B, …)`): argument meaning unknown
//   - `B.T.*` calls (absolute times)
// Default durations (e.g. `B.in`'s 1 s) are not materialized, so they do not stretch.
import type { Node } from 'acorn';
import { lineCol } from './diagnostics.ts';
import { setMemberPatch } from './jsonedit.ts';
import { registrations } from './motionsrc.ts';
import { EditError, makeEdit, type Edit, type Patch } from './patch.ts';
import { locate, type SpineSources } from './edit-spine.ts';
import { member } from './jsonast.ts';

/** Arg indices holding times/durations, and the options-object index, per B method. */
export const TIME_ARGS: Record<string, { times: number[]; opts?: number }> = {
  in: { times: [1], opts: 2 }, out: { times: [1], opts: 2 }, words: { times: [1], opts: 2 },
  show: { times: [1] }, hide: { times: [1] }, set: { times: [1] },
  anim: { times: [1, 2], opts: 4 }, count: { times: [1, 2] }, type: { times: [1, 2] }, draw: { times: [1, 2] },
  tween: { times: [0, 1] },
};
const OPT_KEYS = new Set(['dur', 'stagger']);

export interface StretchSkip { file: string; line: number; col: number; call: string; reason: string }
export interface StretchResult extends Edit { stretched: number; skipped: StretchSkip[] }

type N = Node & Record<string, any>;
const isNode = (v: unknown): v is N => !!v && typeof v === 'object' && typeof (v as N).type === 'string';
function walk(n: N, visit: (n: N) => void) {
  visit(n);
  for (const k of Object.keys(n)) {
    if (k === 'loc') continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((x) => isNode(x) && walk(x, visit));
    else if (isNode(v)) walk(v, visit);
  }
}

/** A numeric literal (optionally negated): its value and range; else null. */
function numLit(n: N | undefined): { value: number; start: number; end: number } | null {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'number') return { value: n.value, start: n.start, end: n.end };
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return { value: -n.argument.value, start: n.start, end: n.end };
  return null;
}
const fmt = (v: number) => String(+v.toFixed(6));

export function stretchBeat(src: SpineSources, ref: string, factor: number): StretchResult {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new EditError('bad-factor', 'factor must be a positive number');
  const chId = ref.slice(0, ref.indexOf('.'));
  const patches: Patch[] = [], skipped: StretchSkip[] = [];
  const texts: Record<string, string> = { [src.spine.path]: src.spine.text };
  let stretched = 0;

  // hold in talk.json
  const beat = locate(src, ref).node;
  const hold = member(beat, 'hold')?.value;
  if (hold?.kind === 'literal' && typeof hold.value === 'number') patches.push(setMemberPatch(src.spine.path, src.spine.text, beat, 'hold', +(hold.value * factor).toFixed(6)));

  const mf = src.motion?.(chId);
  const reg = mf ? registrations(mf.text).find((r) => r.id === ref) : undefined;
  if (mf && reg?.fn) {
    texts[mf.path] = mf.text;
    const fn = reg.fn as N;
    const bName = fn.params?.[0]?.type === 'Identifier' ? (fn.params[0].name as string) : null;
    const skip = (n: N, reason: string) => {
      const { line, col } = lineCol(mf.text, n.start);
      skipped.push({ file: mf.path, line, col, call: mf.text.slice(n.start, Math.min(n.end, n.start + 80)), reason });
    };
    if (!bName) skip(fn, 'beat function has no simple B parameter');
    else walk(fn.body as N, (n) => {
      if (n.type !== 'CallExpression') return;
      const c = n.callee as N;
      const direct = c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === bName;
      const viaT = c.type === 'MemberExpression' && c.object.type === 'MemberExpression' && c.object.object.type === 'Identifier' && c.object.object.name === bName && c.object.property.name === 'T';
      if (viaT) return skip(n, 'B.T call uses absolute times');
      const passesB = (n.arguments as N[]).some((a) => a.type === 'Identifier' && a.name === bName);
      if (!direct) { if (passesB) skip(n, 'helper call receives B; its time arguments are unknown'); return; }
      const spec = TIME_ARGS[c.property.name as string];
      if (!spec) return;
      const args = n.arguments as N[];
      const lits: { value: number; start: number; end: number }[] = [];
      for (const i of spec.times) {
        if (!args[i]) continue;
        const l = numLit(args[i]);
        if (!l) return skip(n, `argument ${i + 1} is not a numeric literal`);
        lits.push(l);
      }
      const o = spec.opts !== undefined ? args[spec.opts] : undefined;
      if (o) {
        if (o.type !== 'ObjectExpression') return skip(n, 'options argument is not an object literal');
        for (const p of o.properties as N[]) {
          const key = p.type === 'Property' && !p.computed ? (p.key.name ?? p.key.value) : null;
          if (key === null && p.type !== 'Property') return skip(n, 'options object uses spread');
          if (!OPT_KEYS.has(key)) continue;
          const l = numLit(p.value);
          if (!l) return skip(n, `option ${key} is not a numeric literal`);
          lits.push(l);
        }
      }
      for (const l of lits) patches.push({ file: mf.path, range: [l.start, l.end], newText: fmt(l.value * factor) });
      stretched++;
    });
  }
  return { ...makeEdit(texts, patches), stretched, skipped };
}
