// edit-html.ts — scene edits on source text: setText, setStyle, setAttr. Elements are found by
// id with parse5 source locations; only the bytes of the target range are rewritten.
import { attrValueRange, sceneElements, type SceneElement } from './html.ts';
import type { SourceFile } from './load.ts';
import { EditError, makeEdit, type Edit } from './patch.ts';

function byId(scene: SourceFile, id: string): SceneElement {
  const found = sceneElements(scene.text).filter((e) => e.id === id);
  if (!found.length) throw new EditError('no-element', `no element #${id} in ${scene.path}`);
  if (found.length > 1) throw new EditError('duplicate-element', `#${id} occurs ${found.length} times in ${scene.path}`);
  return found[0]!;
}

const edit = (scene: SourceFile, range: [number, number], newText: string): Edit =>
  makeEdit({ [scene.path]: scene.text }, [{ file: scene.path, range, newText }]);

/** Replace the inner HTML of #id. The element needs an explicit end tag. */
export function setText(scene: SourceFile, id: string, html: string): Edit {
  const el = byId(scene, id);
  const st = el.loc.startTag, et = el.loc.endTag;
  if (!st || !et) throw new EditError('no-end-tag', `#${id} has no explicit end tag`);
  return edit(scene, [st.endOffset, et.startOffset], html);
}

const escAttr = (v: string, quote: string) =>
  v.replace(/&/g, '&amp;').replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;');

/** True when the start tag spells attribute `name` more than once (parse5 keeps the first). */
function hasDuplicateAttr(text: string, el: SceneElement, name: string): boolean {
  const st = el.loc.startTag!;
  // blank out quoted values so a value that contains the name does not count
  const tag = text.slice(st.startOffset, st.endOffset).replace(/"[^"]*"|'[^']*'/g, (m) => " ".repeat(m.length));
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (tag.match(new RegExp(`\\s${esc}(?=[\\s=/>])`, "gi"))?.length ?? 0) > 1;
}

/** Where a new attribute goes: just before `>` or `/>` of the start tag. */
function insertPoint(text: string, el: SceneElement): number {
  const st = el.loc.startTag!;
  let i = st.endOffset - 1;
  if (text[i - 1] === '/') i--;
  while (i > st.startOffset && /\s/.test(text[i - 1]!)) i--;
  return i;
}

/**
 * Set, add (value string, or `true` for a bare attribute) or remove (`null`) an attribute.
 * An existing value is replaced inside its quotes; quoting style is kept.
 */
export function setAttr(scene: SourceFile, id: string, name: string, value: string | true | null): Edit {
  if (!/^[^\s"'>/=]+$/.test(name)) throw new EditError('bad-attr', `bad attribute name "${name}"`);
  const el = byId(scene, id), text = scene.text;
  if (hasDuplicateAttr(text, el, name)) throw new EditError('duplicate-attr', `#${id} repeats the ${name} attribute (an HTML parse error); fix the source first`);
  const loc = el.loc.attrs?.[name.toLowerCase()];
  if (loc) {
    if (value === null) {
      let s = loc.startOffset;
      while (s > 0 && /\s/.test(text[s - 1]!)) s--;
      return edit(scene, [s, loc.endOffset], '');
    }
    const vr = attrValueRange(text, loc);
    if (value === true) return edit(scene, [loc.startOffset, loc.endOffset], name);
    if (!vr) return edit(scene, [loc.startOffset, loc.endOffset], `${name}="${escAttr(value, '"')}"`);
    if (!vr.quote) return edit(scene, [vr.start, vr.end], /^[^\s"'=<>`]+$/.test(value) ? value : `"${escAttr(value, '"')}"`);
    return edit(scene, [vr.start, vr.end], escAttr(value, vr.quote));
  }
  if (value === null) return makeEdit({ [scene.path]: text }, []);
  const at = insertPoint(text, el);
  return edit(scene, [at, at], value === true ? ` ${name}` : ` ${name}="${escAttr(value, '"')}"`);
}

export interface StyleProps {
  left?: number | string | null | undefined;
  top?: number | string | null | undefined;
  width?: number | string | null | undefined;
  height?: number | string | null | undefined;
  fontSize?: number | string | null | undefined;
  // Text formatting (the canvas's format bar and the inspector). Strings are CSS values;
  // fontWeight also takes a number (written without a unit, e.g. 700).
  color?: string | null | undefined;
  textAlign?: string | null | undefined;
  fontWeight?: number | string | null | undefined;
  fontStyle?: string | null | undefined;
  fontFamily?: string | null | undefined;
  textDecoration?: string | null | undefined;
}

/** The properties setStyle writes. */
export const STYLE_KEYS = ['left', 'top', 'width', 'height', 'fontSize', 'color', 'textAlign', 'fontWeight', 'fontStyle', 'fontFamily', 'textDecoration'] as const;
/** Properties whose numbers are written without a unit. */
const UNITLESS = new Set(['fontWeight']);

const kebab = (p: string) => p.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const cssValue = (v: number | string, key = '') =>
  (typeof v === 'number' ? `${+v.toFixed(3)}${UNITLESS.has(key) ? '' : 'px'}` : v);

/**
 * A string must be a single declaration's value: outside quoted strings no `;`, braces, angle
 * brackets, line breaks or stray quotes, which would end the declaration (or the attribute)
 * and smuggle in others.
 */
function checkStyleValue(key: string, v: unknown) {
  if (v === null || v === undefined) return;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new EditError('bad-style', `${key}: not a finite number`);
    return;
  }
  if (typeof v !== 'string') throw new EditError('bad-style', `${key}: expected a number, a string or null`);
  const bare = v.replace(/"[^"\n\r]*"|'[^'\n\r]*'/g, '');
  if (!v.trim() || /[;{}<>"'\n\r\\]/.test(bare)) throw new EditError('bad-style', `${key}: ${JSON.stringify(v)} is not a single CSS value`);
}

interface Decl { name: string; start: number; end: number; valueStart: number; valueEnd: number }

/** Split a style attribute value into declarations (`;` inside quotes/parens ignored). */
export function parseDecls(css: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0, q = '', s = 0;
  const flush = (e: number) => {
    const part = css.slice(s, e), c = part.indexOf(':');
    if (c > 0 && part.slice(0, c).trim()) {
      const name = part.slice(0, c).trim().toLowerCase();
      let vs = s + c + 1, ve = e;
      while (vs < ve && /\s/.test(css[vs]!)) vs++;
      while (ve > vs && /\s/.test(css[ve - 1]!)) ve--;
      out.push({ name, start: s, end: e, valueStart: vs, valueEnd: ve });
    }
    s = e + 1;
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (q) { if (ch === '\\') i++; else if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && !depth) flush(i);
  }
  flush(css.length);
  return out;
}

/** Rewrite a style string: replace values in place, append new properties, drop nulls. */
export function patchStyle(css: string, props: Readonly<Record<string, number | string | null | undefined>>): string {
  let out = css;
  const decls = parseDecls(css);
  const sep = decls[0] && /:\s/.test(css.slice(decls[0].start, decls[0].valueStart)) ? ': ' : ':';
  const edits: { s: number; e: number; t: string }[] = [];
  const appends: string[] = [];
  for (const [key, v] of Object.entries(props)) {
    if (v === undefined) continue;
    const name = kebab(key);
    const d = [...decls].reverse().find((x) => x.name === name);
    if (d && v === null) {
      // drop every declaration of it, each with its own ';' (the one ending it, or the one before it if last)
      for (const x of decls.filter((y) => y.name === name)) {
        let s = x.start;
        const e = x.end < css.length ? x.end + 1 : x.end;
        if (x.end >= css.length) { const prev = css.lastIndexOf(';', x.start - 1); if (prev >= 0 && !css.slice(prev + 1, x.start).trim() && !edits.some((q) => q.e > prev)) s = prev; }
        edits.push({ s, e, t: '' });
      }
    } else if (d && v !== null) edits.push({ s: d.valueStart, e: d.valueEnd, t: cssValue(v, key) });
    else if (v !== null) appends.push(`${name}${sep}${cssValue(v, key)}`);
  }
  edits.sort((a, b) => b.s - a.s);
  for (const x of edits) out = out.slice(0, x.s) + x.t + out.slice(x.e);
  if (appends.length) {
    const trimmed = out.replace(/\s+$/, ''), tail = out.slice(trimmed.length);
    const join = sep === ': ' ? '; ' : ';';
    out = trimmed + (trimmed && !trimmed.endsWith(';') ? join : trimmed.endsWith(';') && sep === ': ' ? ' ' : '') + appends.join(join) + tail;
  }
  return out;
}

/**
 * Set STYLE_KEYS properties in #id's inline style. Numbers are px (fontWeight: unitless),
 * strings CSS values; null removes (every occurrence).
 */
export function setStyle(scene: SourceFile, id: string, props: StyleProps): Edit {
  for (const [k, v] of Object.entries(props)) {
    if (!(STYLE_KEYS as readonly string[]).includes(k)) throw new EditError('bad-style', `setStyle cannot set ${k}`);
    checkStyleValue(k, v);
  }
  const el = byId(scene, id), text = scene.text;
  const loc = el.loc.attrs?.style;
  const vr = loc ? attrValueRange(text, loc) : null;
  if (loc && vr) {
    const next = patchStyle(text.slice(vr.start, vr.end), props as Record<string, number | string | null | undefined>);
    if (!vr.quote) return edit(scene, [vr.start, vr.end], `"${next.split('"').join('&quot;')}"`);
    // `next` is raw attribute text (entities kept as written): escape only the quote.
    return edit(scene, [vr.start, vr.end], next.split(vr.quote).join(vr.quote === "'" ? "&#39;" : "&quot;"));
  }
  const next = patchStyle('', props as Record<string, number | string | null | undefined>);
  if (!next) return makeEdit({ [scene.path]: text }, []);
  if (loc) return edit(scene, [loc.startOffset, loc.endOffset], `style="${escAttr(next, '"')}"`);
  const at = insertPoint(text, el);
  return edit(scene, [at, at], ` style="${escAttr(next, '"')}"`);
}

// ---------------------------------------------------------------------------------------
// Addresses of elements without an id (the canvas's drill-down into a card's title, say).
//
// An address is the nearest ancestor with an id, then one step per element down to the
// target: `g1>div.t`, `c4>p.sub`, `g1>div.mini>div.ico`, `c6>div.row:2`. A step is the tag,
// the first class when it is a plain name (letters, digits, `_`, `-`), and `:n` when it is the
// n-th (0-based, n > 0) sibling with that tag and class. `>` cannot appear in the ids the app
// writes, so an id containing it is an address. canvas.js computes the same addresses.

export interface AddressStep { tag: string; cls: string; n: number }

/** True when `id` is an element address rather than an id. */
export const isAddress = (id: string) => id.includes('>');

/** The class an address step names: the first class when it is a plain name, else ''. */
export const stepClass = (cls: string | undefined | null) => {
  const first = (cls ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[A-Za-z_][\w-]*$/.test(first) ? first : '';
};

/** Splits an address; null when it is not one. */
export function parseAddress(address: string): { base: string; steps: AddressStep[] } | null {
  const parts = address.split('>');
  if (parts.length < 2 || !parts[0]) return null;
  const steps: AddressStep[] = [];
  for (const p of parts.slice(1)) {
    const m = /^([a-z][a-z0-9-]*)(?:\.([A-Za-z_][\w-]*))?(?::(\d+))?$/.exec(p);
    if (!m) return null;
    steps.push({ tag: m[1]!, cls: m[2] ?? '', n: m[3] ? Number(m[3]) : 0 });
  }
  return { base: parts[0], steps };
}

/**
 * The source element an address names, and its recording key (`#base/i/j`, record.ts
 * elementKey). Throws EditError 'bad-address', 'no-element', or 'stale-path' when the source
 * has no such element (it was generated at runtime, or the source changed).
 */
export function resolveAddress(scene: SourceFile, address: string): { el: SceneElement; key: string } {
  const a = parseAddress(address);
  if (!a) throw new EditError('bad-address', `"${address}" is not an element address`);
  const els = sceneElements(scene.text);
  const bases = els.flatMap((e, i) => (e.id === a.base ? [i] : []));
  if (!bases.length) throw new EditError('no-element', `no element #${a.base} in ${scene.path}`);
  if (bases.length > 1) throw new EditError('duplicate-element', `#${a.base} occurs ${bases.length} times in ${scene.path}`);
  let cur = bases[0]!;
  const key = ['#' + a.base];
  for (const s of a.steps) {
    const kids = els.flatMap((e, i) => (e.parent === cur ? [i] : []));
    const same = kids.filter((i) => els[i]!.tag === s.tag && stepClass(els[i]!.attrs.get('class')) === s.cls);
    const next = same[s.n];
    if (next === undefined) {
      throw new EditError('stale-path', `${address} is not in ${scene.path} (the film may have generated it, or the source changed); give it an id in the scene to edit it`);
    }
    key.push(String(kids.indexOf(next)));
    cur = next;
  }
  const el = els[cur]!;
  if (el.id) throw new EditError('stale-path', `${address} has the id #${el.id} in ${scene.path}; edit it by its id`);
  return { el, key: key.join('/') };
}

/** A readable id for an addressed element, unique among `taken`: `g1-t`, `c4-sub-2`. */
export function newIdFor(address: string, taken: ReadonlySet<string>): string {
  const a = parseAddress(address);
  if (!a) throw new EditError('bad-address', `"${address}" is not an element address`);
  const last = a.steps[a.steps.length - 1]!;
  const stem = `${a.base}-${last.cls || last.tag}`.replace(/[^\w-]/g, '-');
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;
  return id;
}

/**
 * Gives the addressed element an id: returns the scene as it would be with ` id="..."` added
 * to the element's start tag, the id, and the element's recording key before the change.
 */
export function assignId(scene: SourceFile, address: string, taken: ReadonlySet<string>): { scene: SourceFile; id: string; key: string } {
  const { el, key } = resolveAddress(scene, address);
  const id = newIdFor(address, taken);
  const st = el.loc.startTag!;
  // right after the tag name, so the id reads first: <div id="g1-t" class="t">
  const at = st.startOffset + 1 + el.tag.length;
  const text = scene.text.slice(0, at) + ` id="${id}"` + scene.text.slice(at);
  return { scene: { path: scene.path, text }, id, key };
}
