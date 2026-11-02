// Test helpers: small in-memory talks.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTalkFrom, memoryHost, type LoadedTalk } from '../src/load.ts';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ISSTA = path.join(REPO, 'fixtures/issta26');

export interface MiniBeat { id: string; label?: string; notes?: string; hold?: number | undefined; backup?: boolean; dark?: boolean }
export interface MiniChapter { id: string; label?: string; scene?: string; motion?: string; dark?: boolean; private?: boolean; backup?: boolean; beats: MiniBeat[] }

/** A spine object with sensible defaults (labels, notes). */
export function spineOf(chapters: MiniChapter[], extra: Record<string, unknown> = {}) {
  return {
    format: 'sage-talk/1', title: 'Mini', ...extra,
    chapters: chapters.map((c) => ({
      label: c.id, ...c,
      beats: c.beats.map((b) => ({ label: b.id, notes: 'n', ...b })),
    })),
  };
}

/**
 * An in-memory talk. `files` maps paths to text; a `talk.json` object is serialized with
 * 2-space JSON. `assets` lists paths that exist but have no text.
 */
export function mini(spine: unknown, files: Record<string, string> = {}, assets: string[] = []): LoadedTalk {
  const all = { 'talk.json': typeof spine === 'string' ? spine : JSON.stringify(spine, null, 2), ...files };
  return loadTalkFrom(memoryHost(all, assets));
}

/** One chapter `c` with scene + motion, beats given as [id, motion body] pairs. */
export function oneChapter(beats: [string, string, Partial<MiniBeat>?][], scene: string, opts: { lib?: Record<string, string>; layers?: string } = {}): LoadedTalk {
  const motion = beats.map(([id, body]) => `Talk.beat('c.${id}', (B) => {\n${body}\n});`).join('\n\n') + '\n';
  const spine = spineOf([{ id: 'c', scene: 'scenes/c.html', motion: 'beats/c.js', beats: beats.map(([id, , b]) => ({ id, hold: 5, ...b })) }],
    { ...(opts.lib ? { lib: Object.keys(opts.lib) } : {}), ...(opts.layers !== undefined ? { layers: 'scenes/layers.html' } : {}) });
  return mini(spine, { 'scenes/c.html': scene, 'beats/c.js': motion, ...(opts.lib ?? {}), ...(opts.layers !== undefined ? { 'scenes/layers.html': opts.layers } : {}) });
}
