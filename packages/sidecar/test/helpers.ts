import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../src/core-port.ts';

export { REPO_ROOT };
export const FIXTURE = path.join(REPO_ROOT, 'fixtures/issta26');
export const RPC_FIXTURES = path.join(REPO_ROOT, 'tests/rpc');

/** Copies fixtures/issta26 into a fresh temp dir (never write into fixtures/). */
export function tempTalk(): { root: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-sidecar-'));
  const root = path.join(base, 'issta26');
  fs.cpSync(FIXTURE, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}build`) });
  return { root: fs.realpathSync(root), cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

/** Polls until `fn` returns a truthy value or the deadline passes. */
export async function eventually<T>(fn: () => T | undefined | null | false, timeoutMs = 8_000, what = 'condition'): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Beat count and the sum of explicit holds, read from a talk's own talk.json (the fixture is still growing). */
export function spineStats(root: string): { beats: number; explicitDuration: number | null } {
  const spine = JSON.parse(fs.readFileSync(path.join(root, 'talk.json'), 'utf8')) as { chapters: { beats?: { hold?: number }[] }[] };
  const beats = spine.chapters.flatMap((c) => c.beats ?? []);
  const allExplicit = beats.every((b) => typeof b.hold === 'number');
  const sum = beats.reduce((s, b) => s + (b.hold ?? 0), 0);
  return { beats: beats.length, explicitDuration: allExplicit ? Math.round((sum + 1) * 1e6) / 1e6 : null };
}
