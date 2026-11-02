// tools.ts — the in-process tools the app gives Claude (PLAN 6.2), served by createSdkMcpServer
// under the server key `talk` (so the model sees mcp__talk__talk_frame etc.). Most are eyes and
// navigation; content edits stay with Claude's ordinary Read/Edit/Write on the talk files. The
// two spine tools (talk_insert_beat, talk_set_notes) go through the sidecar's talk.edit, so
// talk.json stays valid and formatted and the change is labelled Claude's.
//
// The definitions are plain objects so the replay tests call the same handlers the SDK would.
import path from 'node:path';
import { z } from 'zod';
import type {
  AppGotoParams, AppGotoResult, AppStateResult, BuildResult, Diagnostic, EditParams, EditResult, Hold, LayoutResult,
} from '../protocol.ts';
import type { FrameRenderer } from './frames.ts';
import { inventory, type Materials } from './materials.ts';
import type { Themer } from '../themes/index.ts';
import { RpcError } from '../protocol.ts';

export interface ToolContext {
  talkRoot: string;
  layout(): Promise<LayoutResult>;
  build(): Promise<BuildResult>;
  materials(): Materials;
  /** talk.json's chapters (ids and beat ids), for placing a new beat. */
  spine?(): Promise<{ chapters?: { id: string; beats?: { id: string }[] }[] }>;
  /** The sidecar's talk.edit, writing as Claude. Absent: the spine tools report an error. */
  edit?(p: EditParams): Promise<EditResult>;
  /** Themes and fonts; absent: the theme tools report an error. */
  themer?: Themer;
  app: {
    state(): Promise<AppStateResult>;
    goto(p: AppGotoParams): Promise<AppGotoResult>;
  };
  frames: FrameRenderer;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface TalkTool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const text = (t: string, isError = false): ToolResult => (isError ? { content: [{ type: 'text', text: t }], isError } : { content: [{ type: 'text', text: t }] });

export const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Finds a hold by 'chapter.beat', a bare beat id, a label, or a 1-based hold number. */
export function findHold(holds: Hold[], key: string): Hold | undefined {
  const k = key.trim();
  return holds.find((h) => h.beat === k)
    ?? holds.find((h) => h.beat.endsWith('.' + k))
    ?? holds.find((h) => h.label.toLowerCase() === k.toLowerCase())
    ?? (/^\d+$/.test(k) ? holds.find((h) => h.index === Number(k)) : undefined);
}

/** The hold at or before t (the one whose frame is on screen). */
export function holdAt(holds: Hold[], t: number): Hold | undefined {
  let hit: Hold | undefined;
  for (const h of holds) if (h.at <= t + 1e-9) hit = h;
  return hit ?? holds[0];
}

export type Target = { t: number; hold?: Hold | undefined } | { error: string };

export function resolveTarget(lay: LayoutResult, args: { beat?: unknown; time?: unknown }): Target | null {
  if (typeof args.time === 'number') {
    if (!(args.time >= 0)) return { error: 'time must be a non-negative number of seconds' };
    const t = Math.min(args.time, lay.duration);
    return { t, hold: holdAt(lay.holds, t) };
  }
  if (typeof args.beat === 'string' && args.beat.trim()) {
    const h = findHold(lay.holds, args.beat);
    if (!h) return { error: `no beat matches "${args.beat}". Call talk_layout for the list.` };
    return { t: h.at, hold: h };
  }
  return null;
}

const fmtDiag = (d: Diagnostic) => `${d.severity} ${d.code}: ${d.message}${d.file ? ` [${d.file}]` : ''}${d.beat ? ` (${d.beat})` : ''}`;

export function formatLayout(lay: LayoutResult): string {
  const lines = [`${lay.holds.length} holds, duration ${r3(lay.duration)} s. Columns: hold, time (s), beat, label.`];
  for (const h of lay.holds) lines.push(`${h.index}\t${r3(h.at)}\t${h.beat}\t${h.label}${h.backup ? ' [backup]' : ''}${h.auto ? ' [auto hold]' : ''}`);
  lines.push('', lay.diagnostics.length ? `Diagnostics (${lay.diagnostics.length}):` : 'Diagnostics: none.');
  for (const d of lay.diagnostics) lines.push(fmtDiag(d));
  return lines.join('\n');
}

/** What a spine edit did: changed files, the beat's new hold, and diagnostics worth reading. */
function editReport(head: string, r: EditResult, beat?: string): string {
  const lines = [head, `Changed: ${r.changed.join(', ') || 'nothing'}.`];
  const h = beat ? r.holds?.find((x) => x.beat === beat) : undefined;
  if (h) lines.push(`It is hold ${h.index} at t = ${r3(h.at)} s${h.auto ? ' (an auto hold: its motion end plus holdPad until you set one)' : ''}.`);
  if (!r.ok) lines.push('The rebuild failed.');
  const ds = r.diagnostics.filter((d) => d.severity !== 'info' && (!beat || !d.beat || d.beat === beat || d.severity === 'error'));
  if (ds.length) lines.push(`Diagnostics (${ds.length}):`, ...ds.slice(0, 10).map(fmtDiag));
  return lines.join('\n');
}

const frameName = (t: number, hold?: Hold) => `${hold && Math.abs(hold.at - t) < 1e-6 ? hold.beat.replace(/[^\w.-]/g, '_') + '-' : ''}t${t.toFixed(3)}.png`;

export function talkTools(ctx: ToolContext): TalkTool[] {
  const beatOrTime = {
    beat: z.string().optional().describe("A beat id ('chapter.beat' or just 'beat'), its label, or a 1-based hold number"),
    time: z.number().optional().describe('An absolute film time in seconds'),
  };
  return [
    {
      name: 'talk_state',
      description: 'What the user is looking at in the SAGE app: canvas time, the hold and beat on screen, whether it is playing, the selected objects, and whether the user pinned the canvas.',
      shape: {},
      handler: async () => {
        const st = await ctx.app.state();
        return text(JSON.stringify(st));
      },
    },
    {
      name: 'talk_layout',
      description: 'The hold list (hold number, absolute time, beat id, label) and the validator diagnostics, from the talk files on disk. Use it to find beats and to check the talk after edits.',
      shape: {},
      handler: async () => text(formatLayout(await ctx.layout())),
    },
    {
      name: 'talk_goto',
      description: 'Moves the canvas the user is watching to a beat (its hold) or to a time. Give beat or time.',
      shape: beatOrTime,
      handler: async (args) => {
        const lay = await ctx.layout();
        const target = resolveTarget(lay, args);
        if (!target) return text('Give a beat or a time.', true);
        if ('error' in target) return text(target.error, true);
        const r = await ctx.app.goto({ t: target.t, ...(target.hold ? { beat: target.hold.beat } : {}) });
        return text(`The canvas is at t = ${r3(r.t)} s${target.hold ? ` (hold ${target.hold.index}, ${target.hold.beat}, "${target.hold.label}")` : ''}.`);
      },
    },
    {
      name: 'talk_frame',
      description: 'Builds the talk, renders frames of build/index.html with headless Chromium at 1920x1080 (3D included), moves the user\'s canvas to the same time, and returns the PNG paths. Read the PNGs to look at them. Give beat (its hold) or time; around adds frames that many seconds before and after. Prefer this over shooting frames with a browser yourself.',
      shape: { ...beatOrTime, around: z.number().optional().describe('Also render t - around and t + around (seconds)') },
      handler: async (args) => {
        const built = await ctx.build();
        if (!built.ok) return text(`The build failed, so no frames were rendered.\n${built.diagnostics.map(fmtDiag).join('\n')}`, true);
        const lay = await ctx.layout();
        const target = resolveTarget(lay, args);
        if (target && 'error' in target) return text(target.error, true);
        let t: number, hold: Hold | undefined;
        if (target) ({ t, hold } = target);
        else { t = (await ctx.app.state()).t; hold = holdAt(lay.holds, t); }
        const around = typeof args.around === 'number' && args.around > 0 ? args.around : 0;
        const times = around ? [Math.max(0, t - around), t, Math.min(lay.duration, t + around)] : [t];
        const dir = path.join(ctx.talkRoot, '.sage', 'frames');
        const shots = [...new Set(times.map(r3))].map((x) => ({ t: x, file: path.join(dir, frameName(x, hold)) }));
        const { errors } = await ctx.frames.render(path.join(ctx.talkRoot, 'build', 'index.html'), shots);
        try { await ctx.app.goto({ t, ...(hold ? { beat: hold.beat } : {}) }); } catch { /* the app may be busy; frames still count */ }
        const lines = [`Rendered ${shots.length} frame${shots.length > 1 ? 's' : ''}${hold ? ` around hold ${hold.index} (${hold.beat}, "${hold.label}")` : ''}; the canvas is at t = ${r3(t)} s:`];
        for (const s of shots) lines.push(`${s.file}  (t = ${s.t} s)`);
        if (errors.length) lines.push('', 'Page errors:', ...errors.slice(0, 5));
        const warn = built.diagnostics.filter((d) => d.severity !== 'info');
        if (warn.length) lines.push('', `Build diagnostics (${warn.length}):`, ...warn.slice(0, 10).map(fmtDiag));
        return text(lines.join('\n'));
      },
    },
    {
      name: 'talk_insert_beat',
      description: 'Adds a beat (a new hold) to a chapter in talk.json, with its label, presenter notes and hold (seconds after the beat starts, i.e. after the previous hold), and an empty Talk.beat(\'chapter.id\', (B) => {}) stub in the chapter\'s motion file for you to fill with Edit. Place it with after (an existing beat id, label or hold number) or index (0-based in the chapter); default: the end of the chapter. Use this instead of editing the beats array of talk.json by hand.',
      shape: {
        chapter: z.string().optional().describe('Chapter id; optional when after names a beat'),
        id: z.string().describe('New beat id: letters, digits, "-" and "_" (no dots)'),
        label: z.string().describe('Label shown in the navigator and the presenter view'),
        notes: z.string().optional().describe('Presenter notes'),
        hold: z.number().optional().describe('Hold time in seconds after the beat starts; omit to seed it from the motion end plus holdPad'),
        after: z.string().optional().describe('Insert after this beat (id, chapter.beat, label or hold number)'),
        index: z.number().int().optional().describe('0-based position in the chapter (instead of after)'),
      },
      handler: async (args) => {
        if (!ctx.edit || !ctx.spine) return text('Spine edits are not available here.', true);
        const id = String(args.id ?? '').trim(), label = String(args.label ?? '');
        let chapter = typeof args.chapter === 'string' ? args.chapter.trim() : '';
        const chapters = (await ctx.spine()).chapters ?? [];
        let index: number | undefined = typeof args.index === 'number' ? args.index : undefined;
        if (typeof args.after === 'string' && args.after.trim()) {
          const h = findHold((await ctx.layout()).holds, args.after);
          if (!h) return text(`no beat matches "${args.after}". Call talk_layout for the list.`, true);
          if (chapter && chapter !== h.chapter) return text(`${h.beat} is in chapter ${h.chapter}, not ${chapter}.`, true);
          chapter = h.chapter;
          index = (chapters.find((c) => c.id === chapter)?.beats ?? []).findIndex((b) => `${chapter}.${b.id}` === h.beat) + 1;
        }
        const ch = chapters.find((c) => c.id === chapter);
        if (!ch) return text(chapter ? `no chapter "${chapter}" (chapters: ${chapters.map((c) => c.id).join(', ')})` : 'Give chapter or after.', true);
        index ??= ch.beats?.length ?? 0;
        const beat = { id, label, ...(typeof args.notes === 'string' ? { notes: args.notes } : {}), ...(typeof args.hold === 'number' ? { hold: args.hold } : {}) };
        const r = await ctx.edit({ op: 'insertBeat', args: { chapter, index, beat } });
        return text(editReport(`Inserted beat ${chapter}.${id} ("${label}") at position ${index} of chapter ${chapter}. Write its motion in the Talk.beat('${chapter}.${id}', (B) => {}) stub.`, r, `${chapter}.${id}`));
      },
    },
    {
      name: 'talk_set_notes',
      description: 'Replaces a beat\'s presenter notes in talk.json (empty string removes them). Use this instead of editing notes in talk.json by hand.',
      shape: {
        beat: z.string().describe("The beat: 'chapter.beat', its id, its label, or a 1-based hold number"),
        notes: z.string().describe('The new notes, in Kevin\'s speaking voice'),
      },
      handler: async (args) => {
        if (!ctx.edit) return text('Spine edits are not available here.', true);
        const h = findHold((await ctx.layout()).holds, String(args.beat ?? ''));
        if (!h) return text(`no beat matches "${String(args.beat)}". Call talk_layout for the list.`, true);
        const notes = String(args.notes ?? '');
        const r = await ctx.edit({ op: 'setNotes', args: { ref: h.beat, notes: notes.trim() ? notes : null } });
        return text(editReport(`Set the notes of ${h.beat} ("${h.label}", hold ${h.index}).`, r));
      },
    },
    ...themeTools(ctx),
    {
      name: 'talk_materials',
      description: 'The paper materials attached to this talk (talk.json "materials"): resolved paths and a short inventory of each folder.',
      shape: {},
      handler: async () => text(inventory(ctx.materials())),
    },
  ];
}

// --- Themes and fonts (talk_theme_*, talk_fonts_*) ----------------------------------------

/** Problems from an RpcError's data (ThemeInvalid), else its message. */
const failure = (e: unknown) => {
  const d = e instanceof RpcError ? (e.data as { problems?: string[] } | undefined) : undefined;
  return d?.problems?.length ? `${(e as Error).message.split(':')[0]}:\n${d.problems.map((p) => `- ${p}`).join('\n')}` : (e as Error).message;
};

const fontLine = (f: { id: string; family: string; category: string; weights: number[]; styles: string[] }) =>
  `${f.id}\t${f.family}\t${f.category}\tweights ${f.weights.join(',')}${f.styles.includes('italic') ? '\titalic' : ''}`;

function applyReport(head: string, r: { fonts: string[]; edit: EditResult }) {
  const lines = [head, `Changed: ${r.edit.changed.join(', ') || 'nothing (the talk already had this theme)'}.`];
  if (!r.edit.ok) lines.push('The rebuild failed.');
  const ds = r.edit.diagnostics.filter((d) => d.severity === 'error');
  if (ds.length) lines.push(`Errors (${ds.length}):`, ...ds.slice(0, 10).map(fmtDiag));
  lines.push('Look at a light beat and a dark one with talk_frame before you call it done.');
  return lines.join('\n');
}

function themeTools(ctx: ToolContext): TalkTool[] {
  const need = () => { if (!ctx.themer) throw new Error('Themes are not available here.'); return ctx.themer; };
  const run = (fn: (t: Themer, args: Record<string, unknown>) => Promise<string>) => async (args: Record<string, unknown>) => {
    try { return text(await fn(need(), args)); } catch (e) { return text(failure(e), true); }
  };
  return [
    {
      name: 'talk_theme_list',
      description: 'The themes in the SAGE theme library (built-in and the user\'s): id, name, description. Also shows the talk\'s current fonts and colors.',
      shape: {},
      handler: run(async (t) => {
        const lines = ['id\tname\tkind\tdescription', ...t.list().map((e) => `${e.id}\t${e.name}\t${e.builtin ? 'built-in' : 'user'}\t${e.description ?? ''}`)];
        try {
          const cur = await t.current();
          lines.push('', `This talk now: display ${cur.fonts.display.family}, body ${cur.fonts.body.family}, mono ${cur.fonts.mono.family}; light bg ${cur.light.bg}, ink ${cur.light.ink}, accent ${cur.light.accent1}; dark bg ${cur.dark.bg}, ink ${cur.dark.ink}.`);
        } catch { /* no talk */ }
        return lines.join('\n');
      }),
    },
    {
      name: 'talk_theme_create',
      description: 'Creates a theme (a sage-theme/1 theme.json object: light and dark palettes, display/body/mono fonts, optional type scale; see the skill\'s references/themes.md), validates it, downloads its Google fonts, saves it in the user\'s SAGE theme library (replacing a user theme with the same id) and, unless apply is false, applies it to this talk. An invalid theme comes back with the list of problems to fix.',
      shape: {
        theme: z.record(z.string(), z.unknown()).describe('The theme.json object, format "sage-theme/1"'),
        apply: z.boolean().optional().describe('Apply it to this talk (default true)'),
      },
      handler: run(async (t, args) => {
        const saved = await t.saveToLibrary(args.theme);
        const head = `Saved the theme "${saved.theme.name}" (${saved.theme.id}) to the library: ${saved.path}${saved.fonts.length ? ` with ${saved.fonts.length} font files` : ''}.`;
        if (args.apply === false) return head;
        const r = await t.applyTheme(saved.theme, saved.path, 'claude');
        return applyReport(`${head}\nApplied it to this talk.`, r);
      }),
    },
    {
      name: 'talk_theme_apply',
      description: 'Applies a library theme to this talk (by id, name, or the absolute path of a .talktheme): its fonts go into assets/fonts, its colors and fonts into the generated blocks at the top of theme.css. Rules below the blocks still win over them.',
      shape: { theme: z.string().describe('Theme id, name, or absolute .talktheme path') },
      handler: run(async (t, args) => {
        const e = t.find(String(args.theme ?? ''));
        if (!e) throw new Error(`No theme "${String(args.theme)}". Call talk_theme_list for the library.`);
        const r = await t.apply({ path: e.path }, 'claude');
        return applyReport(`Applied the theme "${r.theme.name}" (${r.theme.id}).`, r);
      }),
    },
    {
      name: 'talk_fonts_search',
      description: 'Searches the Google Fonts catalog (Fontsource; only fonts whose license allows embedding): id, family, category, weights. An empty query lists suggested families. Use the id with talk_fonts_add or in a theme\'s fonts.',
      shape: {
        query: z.string().describe('Family name or part of it'),
        category: z.string().optional().describe('sans-serif, serif, display, handwriting or monospace'),
      },
      handler: run(async (t, args) => {
        const r = await t.searchFonts({ query: String(args.query ?? ''), ...(typeof args.category === 'string' ? { category: args.category } : {}), limit: 25 });
        if (!r.fonts.length) return 'No fonts match.';
        return ['id\tfamily\tcategory\tweights', ...r.fonts.map(fontLine)].join('\n');
      }),
    },
    {
      name: 'talk_fonts_add',
      description: 'Embeds a Google font into this talk (woff2 files in assets/fonts, @font-face rules in the fonts block of theme.css) and returns the CSS font-family value to use in a scene or in theme.css. For the talk\'s main fonts, use a theme instead.',
      shape: {
        id: z.string().describe('Fontsource id from talk_fonts_search, e.g. "inter"'),
        weights: z.array(z.number().int()).optional().describe('Weights to embed (default 400 and 700)'),
        styles: z.array(z.enum(['normal', 'italic'])).optional().describe("Default ['normal']"),
      },
      handler: run(async (t, args) => {
        const r = await t.addFont({
          id: String(args.id ?? ''),
          ...(Array.isArray(args.weights) ? { weights: args.weights as number[] } : {}),
          ...(Array.isArray(args.styles) ? { styles: args.styles as ('normal' | 'italic')[] } : {}),
        }, 'claude');
        return [`Embedded ${r.family}: ${r.files.join(', ')}.`, `Use font-family: ${r.fontFamily};`, r.edit.ok ? 'The talk rebuilt.' : 'The rebuild failed.'].join('\n');
      }),
    },
  ];
}
