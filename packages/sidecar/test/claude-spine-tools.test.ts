// talk_insert_beat and talk_set_notes (PLAN 6.2): the app tools that change the spine go through
// the sidecar's talk.edit on a real Session (a temp copy of the ISSTA fixture), so talk.json stays
// valid and formatted, the motion stub is added, and the watcher labels the change Claude's. Then
// a scripted SDK turn calling the tool is replayed through the translator: the tool row names the
// beat, so the app follows and badges it. No SDK process, no network.
import fs from 'node:fs';
import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeBridge, type QueryFn } from '../src/claude/bridge.ts';
import type { FrameRenderer } from '../src/claude/frames.ts';
import { spineToolBeat } from '../src/claude/translate.ts';
import type { ChangedParams } from '../src/protocol.ts';
import { claudeNotificationCheckers } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { eventually, tempTalk } from './helpers.ts';

const noFrames: FrameRenderer = { render: async () => ({ errors: [] }), close: async () => {} };
const SID = '99999999-2222-3333-4444-555555555555';

describe('spine tools through talk.edit', () => {
  const t = tempTalk();
  const changed: ChangedParams[] = [];
  const notes: { method: string; params: Record<string, unknown> }[] = [];
  let session: Session;
  let bridge: ClaudeBridge;
  let messages: SDKMessage[] = [];
  const queryFn: QueryFn = ({ prompt }) => {
    const it = prompt[Symbol.asyncIterator]();
    async function* gen(): AsyncGenerator<SDKMessage> { await it.next(); for (const m of messages) yield m; }
    const g = gen();
    return { [Symbol.asyncIterator]: () => g, interrupt: async () => undefined, close: () => { void it.return?.(); } };
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await bridge.toolHandlers.get(name)!(args);
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  const spine = () => JSON.parse(fs.readFileSync(path.join(t.root, 'talk.json'), 'utf8')) as { chapters: { id: string; beats: { id: string; label: string; notes?: string; hold?: number }[] }[] };
  const results = () => spine().chapters.find((c) => c.id === 'results')!.beats;

  beforeAll(async () => {
    session = new Session({ changed: (p) => changed.push(p), built: () => {} }, undefined, () => {}, 60);
    await session.open({ path: t.root, watch: true });
    bridge = new ClaudeBridge({
      root: t.root,
      spine: async () => (await session.spine()) as never,
      layout: () => session.layout(),
      build: () => session.build(),
      edit: (p) => session.edit(p, 'claude'),
      expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
      notify: (method, params) => notes.push({ method, params: params as unknown as Record<string, unknown> }),
      request: async () => ({ t: 0, playing: false, selection: [], pinned: false }),
      log: () => {},
    }, { queryFn, frames: noFrames });
  }, 60_000);
  afterAll(async () => { await bridge.close(); await session.close(); t.cleanup(); });

  it('talk_insert_beat adds a beat after another, with a motion stub, written as Claude', async () => {
    const before = fs.readFileSync(path.join(t.root, 'talk.json'), 'utf8');
    const r = await call('talk_insert_beat', { after: 'Results overview', id: 'numbers', label: 'Two numbers', notes: 'Forty-one of forty-six; eleven of fifty.', hold: 2.5 });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^Inserted beat results\.numbers \("Two numbers"\) at position 3 of chapter results\./);
    expect(r.text).toContain('It is hold 40 at t = 194.3 s.');
    expect(spineToolBeat(r.text)).toBe('results.numbers');
    const ids = results().map((b) => b.id);
    expect(ids.slice(2, 5)).toEqual(['overview', 'numbers', 'limits']);
    expect(results()[3]).toEqual({ id: 'numbers', label: 'Two numbers', notes: 'Forty-one of forty-six; eleven of fifty.', hold: 2.5 });
    // Only the new beat's lines were added; the rest of talk.json is byte-identical.
    const after = fs.readFileSync(path.join(t.root, 'talk.json'), 'utf8');
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.startsWith(before.slice(0, before.indexOf('"id": "overview"')))).toBe(true);
    expect(fs.readFileSync(path.join(t.root, 'beats/results.js'), 'utf8')).toMatch(/Talk\.beat\('results\.overview'[\s\S]*Talk\.beat\('results\.numbers', \(B\) => \{\n\}\);[\s\S]*Talk\.beat\('results\.limits'/);
    const lay = await session.layout();
    expect(lay.holds).toHaveLength(62);
    expect(lay.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const c = await eventually(() => changed.find((x) => x.paths.includes('talk.json')), 8_000, 'the watcher batch');
    expect(c).toEqual({ paths: ['beats/results.js', 'talk.json'], source: 'claude' });
  });

  it('talk_insert_beat by chapter and index, and its refusals', async () => {
    const ok = await call('talk_insert_beat', { chapter: 'results', index: 0, id: 'intro', label: 'Results' });
    expect(ok.isError, ok.text).toBe(false);
    expect(results()[0]).toEqual({ id: 'intro', label: 'Results' });
    expect(ok.text).toContain('(an auto hold');
    expect((await call('talk_insert_beat', { chapter: 'nope', id: 'x', label: 'X' })).text).toMatch(/^no chapter "nope" \(chapters: line, phone/);
    const dup = await call('talk_insert_beat', { chapter: 'results', id: 'numbers', label: 'Again' });
    expect(dup).toMatchObject({ isError: true });
    expect(dup.text).toContain('exists');
    const bad = await call('talk_insert_beat', { chapter: 'results', id: 'a.b', label: 'Dotted' });
    expect(bad).toMatchObject({ isError: true });
    expect((await call('talk_insert_beat', { after: 'no such beat', id: 'y', label: 'Y' })).isError).toBe(true);
    expect((await call('talk_insert_beat', { id: 'z', label: 'Z' })).text).toBe('Give chapter or after.');
  });

  it('talk_set_notes replaces notes by label, id or hold number, and removes them with ""', async () => {
    const r = await call('talk_set_notes', { beat: 'numbers', notes: 'Two numbers, one click.' });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^Set the notes of results\.numbers \("Two numbers", hold \d+\)\./);
    expect(results().find((b) => b.id === 'numbers')!.notes).toBe('Two numbers, one click.');
    await call('talk_set_notes', { beat: 'Results overview', notes: 'Overview.' });
    expect(results().find((b) => b.id === 'overview')!.notes).toBe('Overview.');
    await call('talk_set_notes', { beat: '1', notes: '' });
    expect(spine().chapters[0]!.beats[0]!.notes).toBeUndefined();
    expect((await call('talk_set_notes', { beat: 'nothing like it', notes: 'x' })).isError).toBe(true);
  });

  it('a replayed turn calling talk_insert_beat yields a tool row that names the beat', async () => {
    const input = { after: 'results.overview', id: 'numbers2', label: 'Two numbers' };
    const done = (await call('talk_insert_beat', input)).text;
    messages = [
      { type: 'system', subtype: 'init', session_id: SID, model: 'claude-opus-5-5', skills: ['sage-talk:academic-talk-film'], tools: [], mcp_servers: [{ name: 'talk', status: 'connected' }] },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu9', name: 'mcp__talk__talk_insert_beat', input }] }, parent_tool_use_id: null, session_id: SID },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu9', content: [{ type: 'text', text: done }] }] }, parent_tool_use_id: null, session_id: SID },
      { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1, usage: {}, session_id: SID },
    ] as unknown as SDKMessage[];
    await bridge.send({ text: 'split it' });
    await eventually(() => notes.some((n) => n.method === 'claude.result'), 5_000, 'the result');
    const rows = notes.filter((n) => n.method === 'claude.tool');
    for (const r of rows) expect(claudeNotificationCheckers['claude.tool'](r.params)).toEqual([]);
    expect(rows[0]!.params).toMatchObject({ id: 'tu9', name: 'talk_insert_beat', status: 'running', summary: 'numbers2 "Two numbers" after results.overview' });
    expect(rows.at(-1)!.params).toMatchObject({ id: 'tu9', status: 'done', beat: 'results.numbers2' });
  });
});
