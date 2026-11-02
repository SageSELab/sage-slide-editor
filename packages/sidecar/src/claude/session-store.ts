// session-store.ts — one conversation per talk (PLAN 6.1), remembered in <talk>/.sage/session.json.
//
// The SDK files transcripts under a folder derived from cwd, so the stored record keeps the
// cwd it was created with. Opening the same folder resumes the session; opening a talk that
// moved (or a copy) resumes it with forkSession, so the old location's conversation is never
// appended to from the new one.
import fs from 'node:fs';
import path from 'node:path';

export interface StoredSession {
  sessionId: string;
  /** The talk folder (canonical) the session ran in. */
  cwd: string;
  updatedAt: string;
  /** The session's running total_cost_usd at its last result (a resumed session continues from it). */
  totalCostUsd?: number;
}

export interface ResumePlan {
  resume?: string;
  forkSession?: boolean;
  /** 'new' | 'resume' | 'fork' — for the status line and tests. */
  mode: 'new' | 'resume' | 'fork';
}

export const sessionFile = (talkRoot: string) => path.join(talkRoot, '.sage', 'session.json');

export function loadSession(talkRoot: string): StoredSession | null {
  try {
    const j = JSON.parse(fs.readFileSync(sessionFile(talkRoot), 'utf8')) as Partial<StoredSession>;
    if (typeof j.sessionId !== 'string' || !j.sessionId || typeof j.cwd !== 'string') return null;
    const rec: StoredSession = { sessionId: j.sessionId, cwd: j.cwd, updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : '' };
    if (typeof j.totalCostUsd === 'number' && j.totalCostUsd >= 0) rec.totalCostUsd = j.totalCostUsd;
    return rec;
  } catch { return null; }
}

export function saveSession(talkRoot: string, sessionId: string, o: { totalCostUsd?: number | undefined; now?: Date } = {}) {
  const f = sessionFile(talkRoot);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const rec: StoredSession = { sessionId, cwd: talkRoot, updatedAt: (o.now ?? new Date()).toISOString() };
  if (o.totalCostUsd !== undefined) rec.totalCostUsd = o.totalCostUsd;
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
  fs.renameSync(tmp, f);
}

export function clearSession(talkRoot: string) {
  fs.rmSync(sessionFile(talkRoot), { force: true });
}

export function planResume(stored: StoredSession | null, talkRoot: string): ResumePlan {
  if (!stored) return { mode: 'new' };
  if (path.resolve(stored.cwd) === path.resolve(talkRoot)) return { mode: 'resume', resume: stored.sessionId };
  return { mode: 'fork', resume: stored.sessionId, forkSession: true };
}
