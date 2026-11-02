// schema.ts — the sage-talk/1 spine (talk.json) as a zod schema, following the format as the
// ISSTA port actually uses it (fixtures/issta26/talk.json) and the runtime reads it
// (packages/engine/src/talk-layout.js). Unknown keys are not errors: parseSpine reports them
// as `schema-unknown-key` warnings so a newer file still loads.
import { z } from 'zod';
import { diag, type Diagnostic } from './diagnostics.ts';
import { offsetOf, type JsonNode } from './jsonast.ts';

export const FORMAT_VERSION = 'sage-talk/1' as const;

/** Beat and chapter ids join as `chapter.beat`, so they cannot contain dots. */
const Id = z.string().regex(/^[A-Za-z0-9_-]+$/, 'ids use letters, digits, "-" and "_" only');
const Time = z.number().finite().nonnegative();

/** PLAN 3.4 declarative build step. Accepted by the schema; the runtime does not run them yet. */
export const BuildStepSchema = z.object({
  sel: z.string(),
  effect: z.enum(['in', 'out', 'show', 'hide', 'words', 'anim', 'set']),
  t: Time,
  dur: Time.optional(),
}).catchall(z.unknown());

export const BeatSchema = z.object({
  id: Id,
  label: z.string(),
  notes: z.string().optional(),
  /** Hold time relative to the beat start. Absent = seeded as lastEnd + holdPad. */
  hold: Time.optional(),
  /** Runtime reads `b.backup || ch.backup`. */
  backup: z.boolean().optional(),
  /** Overrides the chapter's `dark` for this beat (used by the ISSTA port's lib/slideno.js). */
  dark: z.boolean().optional(),
  builds: z.array(BuildStepSchema).optional(),
});

export const ChapterSchema = z.object({
  id: Id,
  label: z.string(),
  scene: z.string().optional(),
  /** Motion file; convention is `beats/<id>.js`. */
  motion: z.string().optional(),
  dark: z.boolean().optional(),
  private: z.boolean().optional(),
  backup: z.boolean().optional(),
  beats: z.array(BeatSchema).default([]),
});

export const PublicSchema = z.object({
  id: Id.optional(),
  label: z.string().optional(),
  /** Seconds after the last hold in the public cut (ISSTA: 0); falls back to defaults.tail. */
  tail: Time.optional(),
  scene: z.string().optional(),
  motion: z.string().optional(),
  beats: z.array(BeatSchema).default([]),
});

export const SpineSchema = z.object({
  format: z.literal(FORMAT_VERSION),
  title: z.string(),
  venue: z.string().optional(),
  stage: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
  theme: z.string().optional(),
  layers: z.string().optional(),
  lib: z.array(z.string()).optional(),
  materials: z.record(z.string(), z.string()).optional(),
  /** Runtime default holdPad is 1.0 when absent (talk-layout.js). */
  defaults: z.object({ holdPad: Time.optional(), /** Seconds after the last hold; runtime default 1.0. */ tail: Time.optional() }).optional(),
  chapters: z.array(ChapterSchema),
  public: PublicSchema.optional(),
});

export type TalkSpine = z.output<typeof SpineSchema>;
export type ChapterSpec = z.output<typeof ChapterSchema>;
export type BeatSpec = z.output<typeof BeatSchema>;
export type BeatInput = z.input<typeof BeatSchema>;
export type PublicSpec = z.output<typeof PublicSchema>;

/** Runtime default when `defaults.holdPad` is absent (talk-layout.js: `?? 1.0`; PLAN 3.1). */
export const DEFAULT_HOLD_PAD = 1.0;
/** Runtime default when `defaults.tail` is absent: duration = last hold + tail. */
export const DEFAULT_TAIL = 1.0;

const KNOWN: Record<string, readonly string[]> = {
  root: ['format', 'title', 'venue', 'stage', 'theme', 'layers', 'lib', 'materials', 'defaults', 'chapters', 'public'],
  stage: ['width', 'height'],
  defaults: ['holdPad', 'tail'],
  chapter: ['id', 'label', 'scene', 'motion', 'dark', 'private', 'backup', 'beats'],
  beat: ['id', 'label', 'notes', 'hold', 'backup', 'dark', 'builds'],
  public: ['id', 'label', 'tail', 'scene', 'motion', 'beats'],
};

function unknownKeys(raw: unknown): { path: (string | number)[]; key: string }[] {
  const out: { path: (string | number)[]; key: string }[] = [];
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const check = (v: unknown, kind: string, path: (string | number)[]) => {
    if (!obj(v)) return;
    for (const k of Object.keys(v)) if (!KNOWN[kind]!.includes(k)) out.push({ path: [...path, k], key: k });
  };
  const beats = (v: unknown, path: (string | number)[]) => {
    if (Array.isArray(v)) v.forEach((b, i) => check(b, 'beat', [...path, i]));
  };
  check(raw, 'root', []);
  if (!obj(raw)) return out;
  check(raw.stage, 'stage', ['stage']);
  check(raw.defaults, 'defaults', ['defaults']);
  if (Array.isArray(raw.chapters)) raw.chapters.forEach((c, i) => {
    check(c, 'chapter', ['chapters', i]);
    if (obj(c)) beats(c.beats, ['chapters', i, 'beats']);
  });
  check(raw.public, 'public', ['public']);
  if (obj(raw.public)) beats(raw.public.beats, ['public', 'beats']);
  return out;
}

/**
 * Validate a parsed talk.json value. `ast`/`text` (from jsonast) give diagnostics a location.
 * Codes: `schema-invalid` (error), `schema-unknown-key` (warning).
 */
export function parseSpine(raw: unknown, loc?: { file: string; text: string; ast: JsonNode }): { spine: TalkSpine | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const where = (path: readonly PropertyKey[]) => (loc ? { file: loc.file, text: loc.text, offset: offsetOf(loc.ast, path) } : {});
  for (const u of unknownKeys(raw)) diagnostics.push(diag('schema-unknown-key', 'warning', `unknown key "${u.key}" at ${u.path.join('.')}`, where(u.path)));
  const r = SpineSchema.safeParse(raw);
  if (!r.success) {
    for (const issue of r.error.issues) {
      const path = issue.path.join('.') || '(root)';
      diagnostics.push(diag('schema-invalid', 'error', `${path}: ${issue.message}`, where(issue.path)));
    }
    return { spine: null, diagnostics };
  }
  return { spine: r.data, diagnostics };
}
