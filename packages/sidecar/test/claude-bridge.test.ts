// The bridge with a scripted query() (no SDK process): options, streaming, tool rows, budget
// errors, recycling, interrupt and reset.
import fs from 'node:fs';
import path from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeBridge, type BridgeHost, type QueryFn, type QueryLike } from '../src/claude/bridge.ts';
import type { FrameRenderer } from '../src/claude/frames.ts';
import { tempTalk } from './helpers.ts';

const SID = '11111111-2222-3333-4444-555555555555';
const init = (): SDKMessage => ({ type: 'system', subtype: 'init', session_id: SID, model: 'claude-opus-5-5', skills: ['sage-talk:academic-talk-film'], tools: ['Read', 'mcp__talk__talk_frame'], mcp_servers: [{ name: 'talk', status: 'connected' }] } as unknown as SDKMessage);
const ev = (event: object): SDKMessage => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: SID } as unknown as SDKMessage);
const assistant = (id: string, content: object[]): SDKMessage => ({ type: 'assistant', message: { id, content, usage: { input_tokens: 3, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, output_tokens: 50 } }, parent_tool_use_id: null, session_id: SID } as unknown as SDKMessage);
const toolResult = (id: string, text: string, isError = false): SDKMessage => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] }, parent_tool_use_id: null, session_id: SID } as unknown as SDKMessage);
const result = (total: number, extra: object = {}): SDKMessage => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: total, duration_ms: 1200, num_turns: 2, usage: { input_tokens: 10, output_tokens: 60, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300 }, session_id: SID, ...extra } as unknown as SDKMessage);

/** A query() whose output per user message is scripted; records options and prompts. */
function scripted(turns: ((o: Options) => SDKMessage[] | Promise<SDKMessage[]>)[], opts: { throwAfter?: string; flags?: unknown[]; models?: unknown[] } = {}) {
  const calls: { options: Options; prompts: string[]; closed: boolean }[] = [];
  let turn = 0;
  const fn: QueryFn = ({ prompt, options }) => {
    const rec = { options, prompts: [] as string[], closed: false };
    calls.push(rec);
    const it = prompt[Symbol.asyncIterator]();
    async function* gen(): AsyncGenerator<SDKMessage> {
      let first = true;
      for (;;) {
        const n = await it.next();
        if (n.done || rec.closed) return;
        rec.prompts.push(String((n.value as SDKUserMessage).message.content));
        const script = turns[turn++];
        if (!script) return;
        if (first) { yield init(); first = false; }
        for (const m of await script(options)) yield m;
        if (opts.throwAfter) throw new Error(opts.throwAfter);
      }
    }
    const g = gen();
    const q: QueryLike = { [Symbol.asyncIterator]: () => g, interrupt: async () => undefined, close: () => { rec.closed = true; void it.return?.(); } };
    if (opts.flags) q.applyFlagSettings = async (f) => { opts.flags!.push(f); };
    if (opts.models) q.setModel = async (m) => { opts.models!.push(m); };
    return q;
  };
  return { fn, calls };
}

const noFrames: FrameRenderer = { render: async (_h, shots) => { for (const s of shots) { fs.mkdirSync(path.dirname(s.file), { recursive: true }); fs.writeFileSync(s.file, 'png'); } return { errors: [] }; }, close: async () => {} };

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

function setup(turns: Parameters<typeof scripted>[0], o: { throwAfter?: string; ask?: string; flags?: unknown[]; models?: unknown[] } = {}) {
  const t = tempTalk();
  cleanup = t.cleanup;
  const notes: { method: string; params: Record<string, unknown> }[] = [];
  const requests: { method: string; params: unknown }[] = [];
  const writes: { rel: string; content: string | null }[] = [];
  const host: BridgeHost = {
    root: t.root,
    spine: async () => JSON.parse(fs.readFileSync(path.join(t.root, 'talk.json'), 'utf8')),
    layout: async () => ({ holds: [{ index: 1, at: 5, label: 'Title', backup: false, beat: 'line.title', chapter: 'line', auto: false }], duration: 6, diagnostics: [] }),
    build: async () => ({ ok: true, diagnostics: [], ms: 1 }),
    expectWrite: (rel, content) => writes.push({ rel, content }),
    notify: (method, params) => notes.push({ method, params: params as unknown as Record<string, unknown> }),
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === 'app.ask') return { decision: o.ask ?? 'deny' };
      if (method === 'app.goto') return { t: (params as { t: number }).t };
      return { t: 0, playing: false, selection: [], pinned: false };
    },
    log: () => {},
  };
  const q = scripted(turns, o);
  const bridge = new ClaudeBridge(host, { queryFn: q.fn, frames: noFrames, budgetUsd: 0.5 });
  const waitResult = async (n = 1) => {
    for (let i = 0; i < 200 && notes.filter((x) => x.method === 'claude.result').length < n; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { t, bridge, notes, requests, writes, q, waitResult };
}

describe('ClaudeBridge', () => {
  it('starts a query with the Phase 0 options and isolation', async () => {
    const s = setup([() => [result(0.1)]]);
    await s.bridge.send({ text: 'hi' });
    await s.waitResult();
    const o = s.q.calls[0]!.options;
    expect(o).toMatchObject({
      model: 'claude-opus-5-5', cwd: s.t.root, additionalDirectories: [], settingSources: [], strictMcpConfig: true,
      permissionMode: 'default', includePartialMessages: true, maxBudgetUsd: 0.5,
    });
    expect(o.allowedTools).toBeUndefined(); // the policy allows the app tools; bare entries would shadow canUseTool
    expect(o.plugins).toEqual([{ type: 'local', path: expect.stringMatching(/packages\/sidecar\/plugin$/) }]);
    expect(fs.existsSync(path.join((o.plugins![0] as { path: string }).path, 'skills/academic-talk-film/SKILL.md'))).toBe(true);
    expect(Object.keys(o.mcpServers!)).toEqual(['talk']);
    expect(o.resume).toBeUndefined();
    expect(o.canUseTool).toBeTypeOf('function');
    expect(o.hooks?.PostToolUse?.[0]?.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit');
    // The in-process server marks its tools always-loaded (not deferred behind ToolSearch).
    const server = o.mcpServers!.talk as unknown as { instance: { _registeredTools?: Record<string, { _meta?: Record<string, unknown> }> } };
    const reg = server.instance._registeredTools;
    expect(Object.keys(reg ?? {})).toHaveLength(12);
    for (const t of Object.values(reg ?? {})) expect(t._meta?.['anthropic/alwaysLoad']).toBe(true);
    // The session id from init is stored for the next open.
    expect(JSON.parse(fs.readFileSync(path.join(s.t.root, '.sage/session.json'), 'utf8')).sessionId).toBe(SID);
  });

  it('streams text, pairs tool rows, and reports the result', async () => {
    const s = setup([(o) => [
      ev({ type: 'message_start', message: { id: 'm1' } }),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Adding ' } }),
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'it.' } }),
      assistant('m1', [{ type: 'text', text: 'Adding it.' }, { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: path.join(o.cwd!, 'beats/line.js'), old_string: "B.in('#c1-eye'", new_string: "B.in('#c1-eye'" } }]),
      toolResult('tu1', 'The file has been updated.'),
      assistant('m2', [{ type: 'text', text: 'Done.' }]),
      result(0.25),
    ]]);
    await s.bridge.send({ text: 'go', attachments: ['../paper/a.tex'] });
    await s.waitResult();
    expect(s.q.calls[0]!.prompts[0]).toBe(`go\n\nAttached files:\n- ${path.resolve(s.t.root, '../paper/a.tex')}`);
    const m = s.notes.map((n) => n.method);
    expect(m[0]).toBe('claude.status'); // starting
    expect(s.notes.filter((n) => n.method === 'claude.delta').map((n) => n.params.text)).toEqual(['Adding ', 'it.', 'Done.']); // after a tool row: a new text entry, no separator
    const tools = s.notes.filter((n) => n.method === 'claude.tool').map((n) => n.params);
    expect(tools).toEqual([
      { id: 'tu1', name: 'Edit', summary: 'beats/line.js', status: 'running', path: 'beats/line.js' },
      { id: 'tu1', name: 'Edit', summary: 'beats/line.js', status: 'done', path: 'beats/line.js', beat: 'line.fifteen', detail: 'The file has been updated.' },
    ]);
    const r = s.notes.find((n) => n.method === 'claude.result')!.params;
    expect(r).toEqual({ cost: 0.25, totalCost: 0.25, sessionId: SID, durationMs: 1200, turns: 2, usage: { inputTokens: 10, outputTokens: 60, cacheReadTokens: 2000, cacheCreationTokens: 300, contextTokens: 1203 } });
    expect(s.notes.at(-1)).toEqual({ method: 'claude.status', params: { state: 'idle', sessionId: SID } });
  });

  it('recycles a process that spent money, resuming the same session with a fresh cap', async () => {
    // A resumed session's running total continues from the saved one: 0.3, then 0.5.
    const s = setup([() => [result(0.3)], () => [result(0.5)]]);
    await s.bridge.send({ text: 'one' });
    await s.waitResult(1);
    await s.bridge.send({ text: 'two' });
    await s.waitResult(2);
    expect(s.q.calls).toHaveLength(2);
    expect(s.q.calls[0]!.closed).toBe(true);
    expect(s.q.calls[1]!.options).toMatchObject({ resume: SID, maxBudgetUsd: 0.5 });
    expect(s.q.calls[1]!.options.forkSession).toBeUndefined();
    const results = s.notes.filter((n) => n.method === 'claude.result').map((n) => [n.params.cost, n.params.totalCost]);
    expect(results).toEqual([[0.3, 0.3], [0.2, 0.5]]);
  });

  it('reports a budget stop as a result with an error, then survives the thrown error', async () => {
    const s = setup([() => [result(0.61, { subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget ($0.5)'] })]], { throwAfter: 'Claude Code returned an error result: Reached maximum budget ($0.5)' });
    await s.bridge.send({ text: 'big job' });
    await s.waitResult();
    await new Promise((r) => setTimeout(r, 20));
    const results = s.notes.filter((n) => n.method === 'claude.result');
    expect(results).toHaveLength(1);
    expect(results[0]!.params.error).toEqual({ kind: 'budget', message: 'Stopped: this request reached its budget (Reached maximum budget ($0.5)).' });
    expect(s.bridge.isRunning).toBe(false);
  });

  it('reports a process failure without a result', async () => {
    const s = setup([() => []], { throwAfter: 'spawn failed' });
    await s.bridge.send({ text: 'x' });
    await s.waitResult();
    const r = s.notes.find((n) => n.method === 'claude.result')!.params;
    expect(r.error).toEqual({ kind: 'process', message: 'spawn failed' });
    expect(s.notes.at(-1)).toEqual({ method: 'claude.status', params: { state: 'error', message: 'spawn failed' } });
  });

  it('asks the app for a shell command, denies on its answer, and marks the row denied', async () => {
    const s = setup([async (o) => {
      const bash = { command: 'rm -rf build', description: 'Clean the build' };
      const msgs: SDKMessage[] = [assistant('m1', [{ type: 'tool_use', id: 'tb', name: 'Bash', input: bash }])];
      const r = await o.canUseTool!('Bash', bash, { signal: new AbortController().signal, toolUseID: 'tb', requestId: 'r' } as never);
      expect(r).toMatchObject({ behavior: 'deny' });
      return [...msgs, toolResult('tb', 'denied', true), result(0.1)];
    }]);
    await s.bridge.send({ text: 'clean' });
    await s.waitResult();
    expect(s.requests).toEqual([{ method: 'app.ask', params: { tool: 'Bash', title: 'Claude wants to use Bash: Clean the build', summary: 'rm -rf build', reason: 'Shell commands can change files anywhere.', scope: 'Bash commands starting with "rm -rf"' } }]);
    const rows = s.notes.filter((n) => n.method === 'claude.tool').map((n) => n.params.status);
    // canUseTool ran before the bridge read the tool_use here, so the row starts as denied and stays so.
    expect(rows).toEqual(['denied', 'denied']);
  });

  it('interrupt marks the result as interrupted; reset forgets the session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const s = setup([async () => { await gate; return [result(0.05, { subtype: 'error_during_execution', is_error: true, errors: [] })]; }]);
    await s.bridge.send({ text: 'long' });
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.bridge.interrupt()).toEqual({ interrupted: true });
    release();
    await s.waitResult();
    expect(s.notes.find((n) => n.method === 'claude.result')!.params.error).toEqual({ kind: 'interrupted', message: 'Stopped.' });
    expect(fs.existsSync(path.join(s.t.root, '.sage/session.json'))).toBe(true);
    await s.bridge.reset();
    expect(fs.existsSync(path.join(s.t.root, '.sage/session.json'))).toBe(false);
    expect(await s.bridge.interrupt()).toEqual({ interrupted: false });
  });

  it('resumes the stored session on the next open, and forks it when the talk moved', async () => {
    const s = setup([() => [result(1.25)]]);
    fs.mkdirSync(path.join(s.t.root, '.sage'), { recursive: true });
    fs.writeFileSync(path.join(s.t.root, '.sage/session.json'), JSON.stringify({ sessionId: 'old-id', cwd: '/somewhere/else/talk', updatedAt: '', totalCostUsd: 1 }));
    await s.bridge.send({ text: 'hi' });
    await s.waitResult();
    expect(s.q.calls[0]!.options).toMatchObject({ resume: 'old-id', forkSession: true });
    expect(s.notes[0]).toEqual({ method: 'claude.status', params: { state: 'starting', message: 'The talk moved; continuing its conversation as a fork' } });
    // The forked session's total continues from the saved 1.00 USD: this request cost 0.25.
    expect(s.notes.find((n) => n.method === 'claude.result')!.params).toMatchObject({ cost: 0.25, totalCost: 0.25 });
    expect(JSON.parse(fs.readFileSync(path.join(s.t.root, '.sage/session.json'), 'utf8'))).toMatchObject({ sessionId: SID, cwd: s.t.root, totalCostUsd: 1.25 });
  });

  it('effort: the option on the first query, applyFlagSettings on a live one, a restart without it', async () => {
    const flags: unknown[] = [];
    const s = setup([() => [result(0)], () => [result(0)], () => [result(0)], () => [result(0)]], { flags });
    await s.bridge.send({ text: 'one', effort: 'medium' });
    await s.waitResult(1);
    expect(s.q.calls[0]!.options.effort).toBe('medium');
    // Same effort, or none given: nothing changes.
    await s.bridge.send({ text: 'two' });
    await s.waitResult(2);
    expect(flags).toEqual([]);
    // A new effort on an idle live process: switched in place, same process.
    await s.bridge.send({ text: 'three', effort: 'max' });
    await s.waitResult(3);
    expect(flags).toEqual([{ effortLevel: 'max' }]);
    expect(s.q.calls).toHaveLength(1);
    expect(s.bridge.effort).toBe('max');
    expect(s.q.calls[0]!.prompts).toEqual(['one', 'two', 'three']);
  });

  it('effort: a query without applyFlagSettings is restarted with the new option', async () => {
    const s = setup([() => [result(0)], () => [result(0)]]);
    await s.bridge.send({ text: 'one' });
    await s.waitResult(1);
    expect(s.q.calls[0]!.options.effort).toBeUndefined();
    await s.bridge.send({ text: 'two', effort: 'low' });
    await s.waitResult(2);
    expect(s.q.calls).toHaveLength(2);
    expect(s.q.calls[0]!.closed).toBe(true);
    expect(s.q.calls[1]!.options).toMatchObject({ effort: 'low', resume: SID });
  });

  it('model: the default on the first query, setModel on a live one, a restart without it', async () => {
    const models: unknown[] = [];
    const s = setup([() => [result(0)], () => [result(0)], () => [result(0)]], { models });
    await s.bridge.send({ text: 'one' });
    await s.waitResult(1);
    expect(s.q.calls[0]!.options.model).toBe('claude-opus-5-5');
    await s.bridge.send({ text: 'two', model: 'claude-opus-5-5' });
    await s.waitResult(2);
    expect(models).toEqual([]);
    await s.bridge.send({ text: 'three', model: 'claude-fable-5-1' });
    await s.waitResult(3);
    expect(models).toEqual(['claude-fable-5-1']);
    expect(s.q.calls).toHaveLength(1);
    expect(s.bridge.model).toBe('claude-fable-5-1');
  });

  it('model: a query without setModel is restarted on the new model, resuming', async () => {
    const s = setup([() => [result(0)], () => [result(0)]]);
    await s.bridge.send({ text: 'one', model: 'claude-fable-5-1' });
    await s.waitResult(1);
    expect(s.q.calls[0]!.options.model).toBe('claude-fable-5-1');
    await s.bridge.send({ text: 'two', model: 'claude-sonnet-5-5' });
    await s.waitResult(2);
    expect(s.q.calls).toHaveLength(2);
    expect(s.q.calls[0]!.closed).toBe(true);
    expect(s.q.calls[1]!.options).toMatchObject({ model: 'claude-sonnet-5-5', resume: SID });
  });

  it('serves the app tools: talk_goto and talk_frame move the canvas; talk_layout lists holds', async () => {
    const s = setup([]);
    const tools = s.bridge.toolHandlers;
    expect([...tools.keys()]).toEqual(['talk_state', 'talk_layout', 'talk_goto', 'talk_frame', 'talk_insert_beat', 'talk_set_notes', 'talk_theme_list', 'talk_theme_create', 'talk_theme_apply', 'talk_fonts_search', 'talk_fonts_add', 'talk_materials']);
    expect((await tools.get('talk_layout')!({})).content[0]!.text).toContain('1\t5\tline.title\tTitle');
    expect((await tools.get('talk_goto')!({ beat: 'title' })).content[0]!.text).toBe('The canvas is at t = 5 s (hold 1, line.title, "Title").');
    const frame = await tools.get('talk_frame')!({ beat: 'line.title', around: 0.5 });
    expect(frame.content[0]!.text.split('\n')).toEqual([
      'Rendered 3 frames around hold 1 (line.title, "Title"); the canvas is at t = 5 s:',
      `${path.join(s.t.root, '.sage/frames/t4.500.png')}  (t = 4.5 s)`,
      `${path.join(s.t.root, '.sage/frames/line.title-t5.000.png')}  (t = 5 s)`,
      `${path.join(s.t.root, '.sage/frames/t5.500.png')}  (t = 5.5 s)`,
    ]);
    expect(s.requests.filter((r) => r.method === 'app.goto').map((r) => r.params)).toEqual([{ t: 5, beat: 'line.title' }, { t: 5, beat: 'line.title' }]);
    expect((await tools.get('talk_goto')!({ beat: 'nope' })).isError).toBe(true);
    expect((await tools.get('talk_materials')!({})).content[0]!.text).toContain('declares no materials');
  });
});

