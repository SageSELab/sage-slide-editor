// Live smoke test of the Claude bridge (PLAN 12.7). Costs real money, so it is skipped unless
// SAGE_LIVE_CLAUDE=1; each request is capped by maxBudgetUsd (SAGE_LIVE_BUDGET_USD, default
// 0.75). It uses the user's Claude Code login (or ANTHROPIC_API_KEY when set).
//
//   SAGE_LIVE_CLAUDE=1 npx vitest run test/claude-live.test.ts
//
// 1. On a temp copy of the fixture, Claude inserts a caption on the title beat: the file
//    changes, the watcher labels it 'claude', the talk still builds, and init shows only the
//    app's MCP server and the bundled skill.
// 2. The talk folder moves; a new bridge forks the stored session and still remembers it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ClaudeBridge, type TraceEntry } from '../src/claude/bridge.ts';
import type { ChangedParams } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { FIXTURE, eventually } from './helpers.ts';

const LIVE = process.env.SAGE_LIVE_CLAUDE === '1';
const BUDGET = Number(process.env.SAGE_LIVE_BUDGET_USD ?? 0.75);

describe.skipIf(!LIVE)('Claude live smoke (SAGE_LIVE_CLAUDE=1)', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-live-')));
  let spent = 0;
  afterAll(() => {
    process.stderr.write(`[live] spent ${spent.toFixed(4)} USD\n`);
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function run(talk: string, text: string) {
    const notes: { method: string; params: Record<string, unknown> }[] = [];
    const changed: ChangedParams[] = [];
    const trace: TraceEntry[] = [];
    const session = new Session({ changed: (p) => changed.push(p), built: () => {} }, undefined, () => {});
    await session.open({ path: talk, watch: true });
    const bridge = new ClaudeBridge({
      root: session.root!,
      spine: () => session.spine(), layout: () => session.layout(), build: () => session.build(),
      expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
      notify: (method, params) => notes.push({ method, params: params as unknown as Record<string, unknown> }),
      request: async (method, params) => {
        if (method === 'app.ask') return { decision: 'deny' }; // nothing outside the talk is needed
        if (method === 'app.goto') return { t: (params as { t: number }).t };
        return { t: 0, playing: false, selection: [], pinned: false };
      },
      log: () => {},
    }, { budgetUsd: BUDGET, trace: (e) => trace.push(e) });
    await bridge.send({ text });
    await eventually(() => notes.find((n) => n.method === 'claude.result'), 300_000, 'claude.result');
    await new Promise((r) => setTimeout(r, 1_000));
    await bridge.close();
    const layout = await session.layout();
    await session.close();
    const result = notes.find((n) => n.method === 'claude.result')!.params as { cost: number; error?: unknown };
    spent += result.cost;
    return { notes, changed, trace, result, layout };
  }

  it('inserts a caption on a fixture beat, labelled as Claude\'s write', async () => {
    const talk = path.join(base, 'talk');
    fs.cpSync(FIXTURE, talk, { recursive: true, filter: (s) => !s.includes(`${path.sep}build`) && !s.includes(`${path.sep}.sage`) });
    const r = await run(talk, 'In scenes/line.html, inside the title block (the div that holds #t-lg), add one line after the logos: <p class="cap" id="t-live" style="margin-top:18px">Live smoke test</p> (no data-a attribute, no motion). Make exactly one Edit, then reply with one short sentence.');
    expect(r.result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(talk, 'scenes/line.html'), 'utf8')).toContain('id="t-live"');
    expect(r.changed.filter((c) => c.source === 'claude').flatMap((c) => c.paths)).toContain('scenes/line.html');
    expect(r.layout.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const init = r.trace.find((e) => e.kind === 'sdk' && (e.msg as { subtype?: string }).subtype === 'init') as { msg: Record<string, unknown> };
    expect((init.msg.mcp_servers as { name: string }[]).map((s) => s.name)).toEqual(['talk']);
    expect(init.msg.skills as string[]).toContain('sage-talk:academic-talk-film');
    expect(fs.existsSync(path.join(talk, '.sage/session.json'))).toBe(true);
  }, 360_000);

  it('forks the stored session after the talk moved, and remembers it', async () => {
    const before = JSON.parse(fs.readFileSync(path.join(base, 'talk/.sage/session.json'), 'utf8'));
    const moved = path.join(base, 'moved');
    fs.renameSync(path.join(base, 'talk'), moved);
    const r = await run(moved, 'What was the id of the element you added in this conversation? Answer with the id only; do not use tools.');
    expect(r.result.error).toBeUndefined();
    expect(r.notes.find((n) => n.method === 'claude.status')!.params.message).toContain('fork');
    const text = r.notes.filter((n) => n.method === 'claude.delta').map((n) => n.params.text).join('');
    expect(text).toContain('t-live');
    const after = JSON.parse(fs.readFileSync(path.join(moved, '.sage/session.json'), 'utf8'));
    expect(after.sessionId).not.toBe(before.sessionId);
    expect(after.cwd).toBe(moved);
  }, 360_000);
});
