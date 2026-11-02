// beat-locator.ts — which beat a Claude edit touched, so the canvas can follow it (PLAN 6.3).
//
// Motion files: the Talk.beat('chapter.beat', ...) registration enclosing the edited text.
// Scene files: the first beat of that chapter whose motion mentions an id the edit touched,
// else the chapter's first beat. talk.json and other files: none.
import fs from 'node:fs';
import path from 'node:path';

interface SpineLike {
  chapters?: { id: string; scene?: string; motion?: string; beats?: { id: string }[] }[];
  public?: { id?: string; scene?: string; motion?: string; beats?: { id: string }[] };
}

const BEAT_RE = /Talk\.beat\(\s*(['"`])([^'"`]+)\1/g;

/** Registrations in a motion file, in source order. */
export function beatRegistrations(src: string): { id: string; at: number }[] {
  const out: { id: string; at: number }[] = [];
  for (const m of src.matchAll(BEAT_RE)) out.push({ id: m[2]!, at: m.index! });
  return out;
}

/** The registration enclosing source offset `at` (the last one starting before it), else the first. */
export function beatAt(src: string, at: number): string | undefined {
  const regs = beatRegistrations(src);
  let hit: string | undefined;
  for (const r of regs) if (r.at <= at) hit = r.id;
  return hit ?? regs[0]?.id;
}

const ID_RE = /\bid\s*=\s*["']([^"']+)["']/g;

export function locateBeat(talkRoot: string, spine: SpineLike, rel: string, input: Record<string, unknown>): string | undefined {
  const chapters = [...(spine.chapters ?? []), ...(spine.public?.id ? [{ ...spine.public, id: spine.public.id }] : [])];
  const motionOf = (c: { id: string; motion?: string }) => c.motion ?? `beats/${c.id}.js`;
  const read = (r: string) => { try { return fs.readFileSync(path.join(talkRoot, r), 'utf8'); } catch { return null; } };
  const texts = [input.new_string, input.old_string, input.content, ...(Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]).flatMap((e) => [e?.new_string, e?.old_string]) : [])]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  const motionCh = chapters.find((c) => motionOf(c) === rel);
  if (motionCh) {
    const src = read(rel);
    if (!src) return undefined;
    for (const t of texts) {
      const i = src.indexOf(t);
      // An edit that adds a registration is about that beat; otherwise the enclosing one.
      if (i >= 0) return beatAt(src, i + Math.max(0, t.search(/Talk\.beat\(/)));
    }
    return beatAt(src, 0);
  }

  const sceneCh = chapters.find((c) => c.scene === rel);
  if (sceneCh) {
    const ids = new Set<string>();
    for (const t of texts) for (const m of t.matchAll(ID_RE)) ids.add(m[1]!);
    const motion = read(motionOf(sceneCh));
    if (motion && ids.size) {
      let best = -1;
      for (const id of ids) {
        const re = new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?![\\w-])`);
        const m = re.exec(motion);
        if (m && (best < 0 || m.index < best)) best = m.index;
      }
      if (best >= 0) return beatAt(motion, best);
    }
    const first = sceneCh.beats?.[0]?.id;
    return first ? `${sceneCh.id}.${first}` : undefined;
  }
  return undefined;
}
