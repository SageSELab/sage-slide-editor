// Replays the recorded live session tests/claude/caption-frame.ndjson (insert a caption on the
// title beat of a temp copy, then talk_frame) through the bridge with no SDK process
// (PLAN 12.7). The bridge must send the same notifications it sent live, make the same
// permission decisions, give the same tool results, and the watcher must label the caption
// edit as Claude's. No network, no API calls.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeBridge } from '../src/claude/bridge.ts';
import type { FrameRenderer } from '../src/claude/frames.ts';
import type { ChangedParams } from '../src/protocol.ts';
import { claudeNotificationCheckers, type ClaudeNotificationName } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { LEAK_PATTERNS, readRecording, replayQuery, type Recorded } from './claude-trace.ts';
import { FIXTURE, REPO_ROOT, eventually } from './helpers.ts';

const RECORDING = path.join(REPO_ROOT, 'tests/claude/caption-frame.ndjson');

/** Recreates the folder layout the recording was made in (scripts/record-claude.ts). */
function stage() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-replay-')));
  const talk = path.join(base, 'talk');
  fs.cpSync(FIXTURE, talk, { recursive: true, filter: (s) => !s.includes(`${path.sep}build`) && !s.includes(`${path.sep}.sage`) });
  fs.mkdirSync(path.join(base, 'paper'));
  fs.writeFileSync(path.join(base, 'paper/main.tex'), '\\section{Results}\nPreliminary results: 12 of 20 bugs repaired.\n');
  const spine = JSON.parse(fs.readFileSync(path.join(talk, 'talk.json'), 'utf8'));
  spine.materials = { paper: '../paper' };
  fs.writeFileSync(path.join(talk, 'talk.json'), JSON.stringify(spine, null, 2) + '\n');
  return { base, talk };
}

type Note = { method: string; params: unknown };

describe('replay of a recorded Claude session', () => {
  let base = '', talk = '';
  let entries: Recorded[] = [];
  const got: Note[] = [];
  const changed: ChangedParams[] = [];
  const decisions: { recorded: string; now: string; tool: string }[] = [];
  const toolResults: { recorded: unknown; now: unknown }[] = [];
  const rendered: string[] = [];
  let session: Session;
  let bridge: ClaudeBridge;

  beforeAll(async () => {
    ({ base, talk } = stage());
    entries = readRecording(RECORDING, { talk, base, repo: REPO_ROOT });
    session = new Session({ changed: (p) => changed.push(p), built: () => {} }, undefined, () => {}, 60);
    await session.open({ path: talk, watch: true });
    const appAnswers = entries.filter((e): e is Extract<Recorded, { kind: 'app' }> => e.kind === 'app');
    const frames: FrameRenderer = {
      render: async (_html, shots) => { for (const s of shots) { fs.mkdirSync(path.dirname(s.file), { recursive: true }); fs.writeFileSync(s.file, 'png'); rendered.push(s.file); } return { errors: [] }; },
      close: async () => {},
    };
    const replay = replayQuery(entries, () => bridge.toolHandlers, {
      onCanUseTool: (e, now) => decisions.push({ recorded: e.behavior, now, tool: e.toolName }),
      onTool: (e, now) => toolResults.push({ recorded: e.result, now }),
      afterWrite: () => new Promise((r) => setTimeout(r, 20)),
    });
    bridge = new ClaudeBridge({
      root: session.root!,
      spine: () => session.spine(),
      layout: () => session.layout(),
      build: () => session.build(),
      expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
      notify: (method, params) => got.push({ method, params }),
      request: async (method) => {
        const i = appAnswers.findIndex((a) => a.method === method);
        if (i < 0) throw new Error(`unexpected app request ${method}`);
        return appAnswers.splice(i, 1)[0]!.result;
      },
      log: () => {},
    }, { queryFn: replay.fn, frames, budgetUsd: 1 });

    for (const e of entries.filter((x) => x.kind === 'send')) {
      const before = got.filter((n) => n.method === 'claude.result').length;
      await bridge.send({ text: (e as { text: string }).text });
      await eventually(() => got.filter((n) => n.method === 'claude.result').length > before, 30_000, 'claude.result');
    }
    await eventually(() => changed.find((c) => c.source === 'claude'), 8_000, 'talk.changed from claude');
  }, 120_000);

  afterAll(async () => {
    await bridge?.close();
    await session?.close();
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it('is a scrubbed recording of one session with two requests', () => {
    const text = fs.readFileSync(RECORDING, 'utf8');
    for (const re of LEAK_PATTERNS) expect(re.test(text), String(re)).toBe(false);
    const inits = entries.filter((e) => e.kind === 'sdk' && (e.msg as { subtype?: string }).subtype === 'init').map((e) => (e as { msg: Record<string, unknown> }).msg);
    expect(inits).toHaveLength(2); // the second request ran in a recycled process
    for (const init of inits) {
      expect(init.skills).toEqual(['sage-talk:academic-talk-film']);
      expect(init.mcp_servers).toEqual([{ name: 'talk', status: 'connected', source: 'sdk' }]);
      expect((init.tools as string[]).filter((t) => t.startsWith('mcp__talk__')).sort()).toEqual(['mcp__talk__talk_frame', 'mcp__talk__talk_goto', 'mcp__talk__talk_layout', 'mcp__talk__talk_materials', 'mcp__talk__talk_state']);
      expect(init.additional_directories).toEqual([path.join(base, 'paper')]);
      expect(init.model).toBe('claude-opus-5-5');
    }
    // The app tools were loaded up front: the model never searched for them.
    const used = entries.filter((e) => e.kind === 'sdk' && (e.msg as { type?: string }).type === 'assistant')
      .flatMap((e) => ((e as { msg: { message: { content: { type: string; name?: string }[] } } }).msg.message.content).filter((b) => b.type === 'tool_use').map((b) => b.name));
    expect(used).toEqual(['Read', 'Edit', 'mcp__talk__talk_frame', 'Read']);
    expect(used).not.toContain('ToolSearch');
  });

  it('sends the notifications it sent live, in order', () => {
    const recorded = entries.filter((e): e is Extract<Recorded, { kind: 'notify' }> => e.kind === 'notify').map((e) => ({ method: e.method, params: e.params }));
    expect(got).toEqual(recorded);
    for (const n of got) expect(claudeNotificationCheckers[n.method as ClaudeNotificationName](n.params), n.method).toEqual([]);
    const deltas = got.filter((n) => n.method === 'claude.delta').map((n) => (n.params as { text: string }).text).join('');
    expect(deltas).toContain('Preliminary results');
  });

  it('reports cost per request from the running total', () => {
    const results = got.filter((n) => n.method === 'claude.result').map((n) => n.params as { cost: number; totalCost: number; error?: unknown });
    const totals = entries.filter((e) => e.kind === 'sdk' && (e.msg as { type?: string }).type === 'result').map((e) => (e as { msg: { total_cost_usd: number } }).msg.total_cost_usd);
    expect(results).toHaveLength(2);
    expect(results[0]!.cost).toBeCloseTo(totals[0]!, 6);
    expect(results[1]!.cost).toBeCloseTo(totals[1]! - totals[0]!, 6);
    expect(results[1]!.totalCost).toBeCloseTo(totals[1]!, 6);
    expect(results.every((r) => r.error === undefined)).toBe(true);
  });

  it('makes the same permission decisions: the Edit in the talk and the app tool are allowed without asking', () => {
    expect(decisions).toEqual([{ recorded: 'allow', now: 'allow', tool: 'Edit' }, { recorded: 'allow', now: 'allow', tool: 'mcp__talk__talk_frame' }]);
  });

  it('round-trips talk_frame: same result, frames under .sage/frames, the canvas moved', () => {
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]!.now).toEqual(toolResults[0]!.recorded);
    expect(rendered).toEqual([path.join(talk, '.sage/frames/line.title-t5.000.png')]);
  });

  it('labels the caption edit as Claude\'s, rows it with its beat, and keeps the session', () => {
    expect(fs.readFileSync(path.join(talk, 'scenes/line.html'), 'utf8')).toContain('id="t-cap"');
    const claudeChanges = changed.filter((c) => c.source === 'claude').flatMap((c) => c.paths);
    expect(claudeChanges).toEqual(['scenes/line.html']);
    expect(changed.filter((c) => c.source === 'external').flatMap((c) => c.paths)).not.toContain('scenes/line.html');
    const edit = got.filter((n) => n.method === 'claude.tool').map((n) => n.params as { name: string; status: string; beat?: string }).find((p) => p.name === 'Edit' && p.status === 'done');
    expect(edit?.beat).toBe('line.title');
    const stored = JSON.parse(fs.readFileSync(path.join(talk, '.sage/session.json'), 'utf8'));
    const lastResult = got.filter((n) => n.method === 'claude.result').at(-1)!.params as { sessionId: string; totalCost: number };
    expect(stored).toMatchObject({ sessionId: lastResult.sessionId, cwd: talk });
    expect(stored.totalCostUsd).toBeCloseTo(lastResult.totalCost, 6);
  });
});
