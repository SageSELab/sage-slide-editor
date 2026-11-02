// layout.ts — the sage-talk/1 layout algorithm (PLAN 3.6), as a pure function. It mirrors
// packages/engine/src/talk-layout.js exactly; motion cannot run here, so each beat's motion
// end (`lastEnd`, relative to the beat start) is an input — from record.ts, or from a test.
//
//   beat.start   = previous beat's hold time (0 for the first beat)   [boundary rule]
//   hold         = beat.hold ?? r6(lastEnd + holdPad)                    [seeded hold]
//   at           = r6(start + hold)                                     [checkpoint time]
//   chapter.at   = 0 for spine chapter 0 when the cursor is 0, else r6(firstBeat.start + 0.1)
//   duration     = r6(lastAt + tail), tail = defaults.tail ?? 1.0 (public cut: public.tail first)
//   dark         = beat.dark ?? chapter.dark, over (start, hold]: the hold frame belongs to the
//                  beat ending on it
// Chapters without beats get no marker. `public: true` drops private chapters and appends the
// spine's `public` block, strips notes, then lays out the filtered set from scratch.
import { DEFAULT_HOLD_PAD, DEFAULT_TAIL, type BeatSpec, type ChapterSpec, type TalkSpine } from './schema.ts';

/**
 * Snap float noise back onto a 6-decimal value (27.5 + 0.1 -> 27.6), but leave genuinely
 * computed times (13.5 + 6/7) alone: snap only when within 1e-9.
 */
export const r6 = (v: number): number => { const s = Math.round(v * 1e6) / 1e6; return Math.abs(v - s) < 1e-9 ? s : v; };

export interface BeatLayout {
  /** `chapter.beat`. */
  id: string;
  chapter: string;
  label: string;
  notes: string;
  /** Absolute start (= previous hold). */
  start: number;
  /** Motion end relative to start (0 when the beat registers no motion). */
  lastEnd: number;
  /** Hold relative to start. */
  hold: number;
  /** True when `hold` was seeded (absent in the spine). */
  auto: boolean;
  /** Absolute checkpoint time, start + hold. */
  at: number;
  backup: boolean;
  /** `beat.dark ?? chapter.dark`; applies over (start, at]. */
  dark: boolean;
  /** 1-based number among main beats, or among backups for backup beats. */
  number: number;
}

export interface ChapterLayout { id: string; label: string; at: number; dark: boolean; private: boolean; backup: boolean }

export interface Checkpoint { at: number; label: string; notes: string; backup: boolean; id: string }

export interface Layout {
  beats: BeatLayout[];
  chapters: ChapterLayout[];
  checkpoints: Checkpoint[];
  duration: number;
  /**
   * Dark windows (from, to]: runs of dark beats from the first one's start to the last one's
   * hold (the talk's last beat runs to duration), merged.
   */
  darkWindows: [number, number][];
}

/** lastEnd source: a table of relative motion ends, or a callback run in walk order. */
export type LastEnds = Readonly<Record<string, number | undefined>> | ((id: string, start: number) => number | undefined);

export interface LayoutOptions {
  /** Lay out the published version: private chapters out, `public` block in. */
  public?: boolean;
}

/** The hold the runtime gives a beat. */
export const beatHold = (beat: Pick<BeatSpec, 'hold'>, lastEnd: number, holdPad: number): number =>
  beat.hold ?? r6(lastEnd + holdPad);

/** The chapter list a layout walks (private filtering and the public block applied). */
export function layoutChapters(spine: TalkSpine, opts: LayoutOptions = {}): ChapterSpec[] {
  if (!opts.public) return spine.chapters;
  const chs = spine.chapters.filter((c) => !c.private);
  const p = spine.public;
  if (p) chs.push({ id: p.id ?? 'public', label: p.label ?? 'Public', beats: p.beats, ...(p.scene ? { scene: p.scene } : {}), ...(p.motion ? { motion: p.motion } : {}) });
  return chs;
}

export function layout(spine: TalkSpine, lastEnds: LastEnds = {}, opts: LayoutOptions = {}): Layout {
  const endOf = typeof lastEnds === 'function' ? lastEnds : (id: string) => lastEnds[id];
  const holdPad = spine.defaults?.holdPad ?? DEFAULT_HOLD_PAD;
  const beats: BeatLayout[] = [], chapters: ChapterLayout[] = [];
  let cursor = 0, main = 0, backups = 0;
  layoutChapters(spine, opts).forEach((ch, ci) => {
    if (ch.beats.length) {
      chapters.push({ id: ch.id, label: ch.label, at: ci === 0 && cursor === 0 ? 0 : r6(cursor + 0.1), dark: !!ch.dark, private: !!ch.private, backup: !!ch.backup });
    }
    for (const b of ch.beats) {
      const id = `${ch.id}.${b.id}`, start = cursor;
      const end = endOf(id, start);
      const lastEnd = end === undefined ? 0 : Math.max(0, r6(end));
      const notes = opts.public ? '' : (b.notes ?? '');
      const hold = beatHold(b, lastEnd, holdPad);
      const at = r6(start + hold);
      const backup = !!(b.backup || ch.backup);
      beats.push({ id, chapter: ch.id, label: b.label, notes, start, lastEnd, hold, auto: b.hold === undefined, at, backup, dark: b.dark ?? !!ch.dark, number: backup ? ++backups : ++main });
      cursor = at;
    }
  });
  const tail = (opts.public ? spine.public?.tail : undefined) ?? spine.defaults?.tail ?? DEFAULT_TAIL;
  const duration = r6(cursor + tail);
  const darkWindows: [number, number][] = [];
  beats.forEach((b, i) => {
    if (!b.dark) return;
    const to = i === beats.length - 1 ? duration : b.at, last = darkWindows[darkWindows.length - 1];
    if (last && last[1] === b.start) last[1] = to; else darkWindows.push([b.start, to]);
  });
  return {
    beats, chapters, duration, darkWindows,
    checkpoints: beats.map((b) => ({ at: b.at, label: b.label, notes: b.notes, backup: b.backup, id: b.id })),
  };
}

/** The `?cplist` listing: `N at.toFixed(1) label`, one checkpoint per line. */
export const formatCplist = (l: Layout): string =>
  l.checkpoints.map((c, i) => `${i + 1} ${c.at.toFixed(1)} ${c.label}`).join('\n');
