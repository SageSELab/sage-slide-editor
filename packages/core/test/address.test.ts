// Element addresses (the canvas's drill-down into elements without an id): parsing, resolving
// against the source with the sibling signature, the recording key, and assigning a readable
// unique id with a one-insertion change.
import { describe, expect, it } from 'vitest';
import { assignId, isAddress, newIdFor, parseAddress, resolveAddress, setText } from '../src/edit-html.ts';
import { sceneElements } from '../src/html.ts';

const CARD = `<div class="scene" id="c4">
  <div class="impl c3" id="g1" data-a style="left:120px"><div class="n">PDF</div><div class="t">PDF benchmark</div><div class="d">UW, <b>125</b> PDFs.</div><div class="mini"><div class="ico">detects</div></div></div>
  <p class="sub">first</p>
  <!-- a comment -->
  <p class="sub">second</p>
  <p>no class</p>
</div>`;
const file = (text: string) => ({ path: 'scenes/c4.html', text });

describe('element addresses', () => {
  it('parses addresses and tells them from ids', () => {
    expect(isAddress('g1')).toBe(false);
    expect(isAddress('g1>div.t')).toBe(true);
    expect(parseAddress('g1>div.mini>div.ico:2')).toEqual({ base: 'g1', steps: [{ tag: 'div', cls: 'mini', n: 0 }, { tag: 'div', cls: 'ico', n: 2 }] });
    expect(parseAddress('g1')).toBeNull();
    expect(parseAddress('>div')).toBeNull();
    expect(parseAddress('g1>DIV!')).toBeNull();
  });

  it('records parent links in sceneElements', () => {
    const els = sceneElements(CARD);
    const t = els.findIndex((e) => e.attrs.get('class') === 't');
    expect(els[els[t]!.parent]!.id).toBe('g1');
    expect(els[0]!.parent).toBe(-1);
  });

  it('resolves by tag, first class and position among like siblings, with the recording key', () => {
    const f = file(CARD);
    const t = resolveAddress(f, 'g1>div.t');
    expect(CARD.slice(t.el.loc.startOffset, t.el.loc.endOffset)).toBe('<div class="t">PDF benchmark</div>');
    expect(t.key).toBe('#g1/1');
    expect(resolveAddress(f, 'g1>div.mini>div.ico').key).toBe('#g1/3/0');
    const second = resolveAddress(f, 'c4>p.sub:1');
    expect(CARD.slice(second.el.loc.startOffset, second.el.loc.endOffset)).toBe('<p class="sub">second</p>');
    expect(second.key).toBe('#c4/2');
    expect(resolveAddress(f, 'c4>p').key).toBe('#c4/3');
  });

  it('refuses addresses the source does not have (generated at runtime, or stale)', () => {
    const f = file(CARD);
    expect(() => resolveAddress(f, 'g1>div.x')).toThrow(expect.objectContaining({ code: 'stale-path' }));
    expect(() => resolveAddress(f, 'c4>p.sub:2')).toThrow(expect.objectContaining({ code: 'stale-path' }));
    expect(() => resolveAddress(f, 'c4>div.impl')).toThrow(/has the id #g1/);
    expect(() => resolveAddress(f, 'zz>div')).toThrow(expect.objectContaining({ code: 'no-element' }));
    expect(() => resolveAddress(f, 'bad')).toThrow(expect.objectContaining({ code: 'bad-address' }));
  });

  it('assigns a readable unique id by inserting one attribute', () => {
    expect(newIdFor('g1>div.t', new Set())).toBe('g1-t');
    expect(newIdFor('g1>div.t', new Set(['g1-t', 'g1-t-2']))).toBe('g1-t-3');
    expect(newIdFor('c4>p', new Set())).toBe('c4-p');
    const r = assignId(file(CARD), 'g1>div.t', new Set(['g1', 'c4']));
    expect(r.id).toBe('g1-t');
    expect(r.key).toBe('#g1/1');
    expect(r.scene.text).toBe(CARD.replace('<div class="t">', '<div id="g1-t" class="t">'));
    // the op then runs on the new id
    const e = setText(r.scene, r.id, 'Scholarly PDFs');
    expect(e.patches).toHaveLength(1);
  });
});
