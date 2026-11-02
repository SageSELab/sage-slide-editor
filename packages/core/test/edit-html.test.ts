// Source-edit round trips on scene HTML with deliberately odd formatting (PLAN 12.2): only
// bytes inside the target range change, and apply-then-inverse restores the original.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { patchStyle, setAttr, setStyle, setText } from '../src/edit-html.ts';
import { parseDecls } from '../src/edit-html.ts';
import { sceneElements } from '../src/html.ts';
import { applyPatches, type Edit } from '../src/patch.ts';

const ws = fc.constantFrom(' ', '  ', '\t', '\n', '\n\t\t', ' \n  ', '\r\n ');
const optWs = fc.constantFrom('', ' ', '\n', '\t');
const attrName = fc.constantFrom('class', 'title', 'data-x', 'aria-label', 'data-k');
const value = fc.constantFrom('a', 'b c', 'x-1', '', 'k&amp;v', 'é', 'url(x)');
const attr = fc.tuple(attrName, value, fc.constantFrom('"', "'", ''), optWs, optWs).map(([n, v, q, w1, w2]) =>
  q === '' && /^[^\s"'=<>`&]+$/.test(v) ? `${n}${w1}=${w2}${v}` : `${n}${w1}=${w2}${q || '"'}${v}${q || '"'}`);
const bare = fc.constantFrom('data-a', 'hidden');
const decl = fc.tuple(fc.constantFrom('left', 'top', 'width', 'opacity', 'font-size', 'background'), fc.constantFrom('10px', '0', 'url(data:a;b)', '"x;y"', 'calc(1px + 2%)'), fc.constantFrom(':', ': ', ' : ')).map(([n, v, c]) => `${n}${c}${v}`);
const style = fc.tuple(fc.array(decl, { maxLength: 4 }), fc.constantFrom(';', '; ', ' ;'), fc.boolean(), fc.constantFrom('"', "'"))
  .map(([ds, sep, trail, q]) => `style=${q}${ds.join(sep)}${trail && ds.length ? ';' : ''}${q}`);
const inline = fc.constantFrom('text', '<b>bold</b>', '<!-- c -->', '<i\n   class="z">it</i>', '\t', '<br>', '<span class="w">w </span>', '&amp; &lt;', '<em><b>x</b></em>');
const scene = fc.record({
  idq: fc.constantFrom('"T"', "'T'", 'T'),
  attrs: fc.uniqueArray(fc.oneof(attr, bare), { maxLength: 4, selector: (a) => a.split(/[\s=]/)[0] }),
  style: fc.option(style, { nil: undefined }),
  stylePos: fc.nat(4),
  seps: fc.array(ws, { minLength: 8, maxLength: 8 }),
  inner: fc.array(inline, { maxLength: 5 }),
  before: fc.array(fc.constantFrom('<!-- head -->\n', '<p id="o1" style="left:1px">o</p>', '\t<div\n\tclass="q">\n</div>', '<svg viewBox="0 0 1 1"><path id="pa" d="M0 0"/></svg>'), { maxLength: 3 }),
  after: fc.array(fc.constantFrom('\n<!-- tail -->', '<p id="o2">t</p>', '\n\n'), { maxLength: 3 }),
  closeWs: optWs,
}).map((g) => {
  const parts = [...g.attrs];
  if (g.style) parts.splice(Math.min(g.stylePos, parts.length), 0, g.style);
  const attrs = parts.map((a, i) => g.seps[i % 8] + a).join('');
  return `<div class="scene">\n${g.before.join('')}<div${g.seps[7]}id=${g.idq}${attrs}${g.closeWs}>${g.inner.join('')}</div>${g.after.join('')}\n</div>\n`;
});

const target = (text: string) => sceneElements(text).find((e) => e.id === 'T')!;

/** The edit is one patch inside [lo, hi), outside bytes are unchanged, and the inverse restores. */
function checkRoundTrip(text: string, e: Edit, lo: number, hi: number): string {
  expect(e.patches.length).toBeLessThanOrEqual(1);
  const out = applyPatches(text, e.patches);
  for (const p of e.patches) {
    expect(p.range[0]).toBeGreaterThanOrEqual(lo);
    expect(p.range[1]).toBeLessThanOrEqual(hi);
    expect(out.slice(0, p.range[0])).toBe(text.slice(0, p.range[0]));
    expect(out.slice(p.range[0] + p.newText.length)).toBe(text.slice(p.range[1]));
  }
  expect(applyPatches(out, e.inverse)).toBe(text);
  return out;
}

const file = (text: string) => ({ path: 'scenes/s.html', text });

describe('setText', () => {
  it('replaces only the inner range, round trips (property)', () => {
    fc.assert(fc.property(scene, fc.array(inline, { maxLength: 4 }), (text, newInner) => {
      const html = newInner.join('');
      const el = target(text);
      const out = checkRoundTrip(text, setText(file(text), 'T', html), el.loc.startTag!.endOffset, el.loc.endTag!.startOffset);
      const el2 = target(out);
      expect(out.slice(el2.loc.startTag!.endOffset, el2.loc.endTag!.startOffset)).toBe(html);
    }), { numRuns: 300 });
  });
  it('rejects unknown ids, duplicate ids, and elements without an end tag', () => {
    expect(() => setText(file('<p id="a">x</p>'), 'b', 'y')).toThrow(/no element #b/);
    expect(() => setText(file('<p id="a">x</p><p id="a">y</p>'), 'a', 'y')).toThrow(/occurs 2 times/);
    expect(() => setText(file('<img id="a">'), 'a', 'y')).toThrow(/no explicit end tag/);
  });
});

const num = fc.oneof(fc.integer({ min: -50, max: 2000 }), fc.double({ min: 0, max: 100, noNaN: true }).map((v) => +v.toFixed(2)));
const prop = fc.option(fc.oneof(num, fc.constant(null as null), fc.constantFrom('50%', 'auto')), { nil: undefined });
const props = fc.record({ left: prop, top: prop, width: prop, height: prop, fontSize: prop }, { requiredKeys: [] });

describe('setStyle', () => {
  it('rewrites only the style attribute, keeps other declarations, round trips (property)', () => {
    fc.assert(fc.property(scene, props, (text, ps) => {
      const el = target(text);
      const before = parseDecls(el.attrs.get('style') ?? '');
      const out = checkRoundTrip(text, setStyle(file(text), 'T', ps), el.loc.startTag!.startOffset, el.loc.startTag!.endOffset);
      const el2 = target(out);
      const css = el2.attrs.get('style') ?? '';
      const decls = parseDecls(css);
      const val = (n: string) => { const d = [...decls].reverse().find((x) => x.name === n); return d ? css.slice(d.valueStart, d.valueEnd) : undefined; };
      for (const [k, v] of Object.entries(ps)) {
        if (v === undefined) continue;
        const n = k === 'fontSize' ? 'font-size' : k;
        expect(val(n)).toBe(v === null ? undefined : typeof v === 'number' ? `${+v.toFixed(3)}px` : v);
      }
      const touched = new Set(Object.entries(ps).filter(([, v]) => v !== undefined).map(([k]) => (k === 'fontSize' ? 'font-size' : k)));
      const untouched = (ds: typeof before, src: string) => ds.filter((d) => !touched.has(d.name)).map((d) => src.slice(d.start, d.end).trim());
      expect(untouched(decls, css)).toEqual(untouched(before, el.attrs.get('style') ?? ''));
      // siblings untouched
      expect(sceneElements(out).filter((e) => e.id !== 'T').map((e) => [...e.attrs])).toEqual(sceneElements(text).filter((e) => e.id !== 'T').map((e) => [...e.attrs]));
    }), { numRuns: 300 });
  });
  it('formats new properties in the attribute\'s own style', () => {
    expect(patchStyle('left: 1px; top: 2px', { width: 30 })).toBe('left: 1px; top: 2px; width: 30px');
    expect(patchStyle('left:1px;top:2px;', { width: 30, left: 5 })).toBe('left:5px;top:2px;width:30px');
    expect(patchStyle('position:absolute;left:1px;top:2px', { top: null })).toBe('position:absolute;left:1px');
    expect(patchStyle('', { fontSize: 36 })).toBe('font-size:36px');
  });
  it('adds a style attribute when there is none', () => {
    const text = '<div id="T"\n  class="x">a</div>';
    const e = setStyle(file(text), 'T', { left: 10, top: 20 });
    expect(applyPatches(text, e.patches)).toBe('<div id="T"\n  class="x" style="left:10px;top:20px">a</div>');
  });
});

describe('setAttr', () => {
  const name = fc.constantFrom('title', 'data-x', 'class', 'data-new', 'hidden');
  const val = fc.oneof(fc.constantFrom('v', 'two words', 'q"uote', "it's", '&', ''), fc.constant(true as const), fc.constant(null));
  it('changes only the target start tag, round trips (property)', () => {
    fc.assert(fc.property(scene, name, val, (text, n, v) => {
      const el = target(text);
      const out = checkRoundTrip(text, setAttr(file(text), 'T', n, v), el.loc.startTag!.startOffset, el.loc.startTag!.endOffset);
      const got = target(out).attrs.get(n);
      expect(got).toBe(v === null ? undefined : v === true ? '' : v);
      expect(sceneElements(out).filter((e) => e.id !== 'T').map((e) => [...e.attrs])).toEqual(sceneElements(text).filter((e) => e.id !== 'T').map((e) => [...e.attrs]));
    }), { numRuns: 300 });
  });
  it('rejects bad attribute names, and tags that repeat the attribute', () => {
    expect(() => setAttr(file('<p id="a">x</p>'), 'a', 'x y', 'v')).toThrow(/bad attribute name/);
    expect(() => setAttr(file('<p id="a" hidden title="hidden" hidden>x</p>'), 'a', 'hidden', null)).toThrow(/repeats the hidden/);
    expect(setAttr(file('<p id="a" hidden title="hidden">x</p>'), 'a', 'hidden', null).patches).toHaveLength(1);
  });
});
