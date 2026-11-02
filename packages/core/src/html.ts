// html.ts — position-aware parsing of scene fragments (parse5 with source locations).
// Shared by the validator (ids, assets) and the source-edit API (exact byte ranges).
import { parseFragment, type DefaultTreeAdapterTypes as P5, type Token } from 'parse5';

export interface SceneElement {
  tag: string;
  id: string | null;
  attrs: Map<string, string>;
  loc: Token.ElementLocation;
}

/** Every element of a scene fragment, in document order, with its source location. */
export function sceneElements(text: string): SceneElement[] {
  const out: SceneElement[] = [];
  const walk = (n: P5.ParentNode) => {
    for (const c of n.childNodes) {
      if (!('tagName' in c)) continue;
      const el = c as P5.Element;
      if (el.sourceCodeLocation) {
        const attrs = new Map(el.attrs.map((a) => [a.name, a.value]));
        out.push({ tag: el.tagName, id: attrs.get('id') ?? null, attrs, loc: el.sourceCodeLocation });
      }
      walk(el.tagName === 'template' ? (el as P5.Template).content : el);
    }
  };
  walk(parseFragment(text, { sourceCodeLocationInfo: true }));
  return out;
}

/** Range of an attribute's value inside the source (quotes excluded), or null when valueless. */
export function attrValueRange(text: string, loc: Token.Location): { start: number; end: number; quote: string } | null {
  const raw = text.slice(loc.startOffset, loc.endOffset);
  const m = /^[^\s=]+\s*=\s*(["']?)/.exec(raw);
  if (!m) return null;
  const quote = m[1] ?? '';
  return { start: loc.startOffset + m[0].length, end: loc.endOffset - quote.length, quote };
}

/** Asset-like references in a scene: src/srcset/href/xlink:href attributes and url(...) in styles. */
export function assetRefs(text: string): { ref: string; offset: number }[] {
  const out: { ref: string; offset: number }[] = [];
  for (const el of sceneElements(text)) {
    for (const [name, value] of el.attrs) {
      const loc = el.loc.attrs?.[name];
      const off = loc?.startOffset ?? el.loc.startOffset;
      if (name === 'src' || name === 'href' || name === 'xlink:href') out.push({ ref: value, offset: off });
      else if (name === 'srcset') for (const part of value.split(',')) { const u = part.trim().split(/\s+/)[0]; if (u) out.push({ ref: u, offset: off }); }
      else if (name === 'style') for (const u of cssUrls(value)) out.push({ ref: u, offset: off });
    }
  }
  return out;
}

export function cssUrls(css: string): string[] {
  return [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!.trim());
}

/** True for references the build must resolve on disk (not URLs, fragments, data or JS). */
export const isLocalRef = (ref: string): boolean =>
  !!ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) && !ref.includes('${');
