// tools.ts — the in-process tools the app gives Claude (PLAN 6.2), served by createSdkMcpServer
// under the server key `talk` (so the model sees mcp__talk__talk_frame etc.). They are eyes and
// navigation; content edits stay with Claude's ordinary Read/Edit/Write on the talk files.
//
// The definitions are plain objects so the replay tests call the same handlers the SDK would.
import path from 'node:path';
import { z } from 'zod';
import type {
  AppGotoParams, AppGotoResult, AppStateResult, BuildResult, Diagnostic, Hold, LayoutResult,
} from '../protocol.ts';
import type { FrameRenderer } from './frames.ts';
import { inventory, type Materials } from './materials.ts';

export interface ToolContext {
  talkRoot: string;
  layout(): Promise<LayoutResult>;
  build(): Promise<BuildResult>;
  materials(): Materials;
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
      name: 'talk_materials',
      description: 'The paper materials attached to this talk (talk.json "materials"): resolved paths and a short inventory of each folder.',
      shape: {},
      handler: async () => text(inventory(ctx.materials())),
    },
  ];
}
