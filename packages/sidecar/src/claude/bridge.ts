// bridge.ts — the Agent SDK bridge (PLAN 6.1): one long-lived streaming-input query() per open
// talk, driven by claude.send / claude.interrupt / claude.reset and reported to the app as
// claude.* notifications. Options are the ones Phase 0 verified (spikes/sdk/FINDINGS.md):
//
//   model claude-opus-5-5, cwd = the talk, additionalDirectories = its materials folders,
//   settingSources [] and strictMcpConfig (no personal settings, skills, allow rules or MCP
//   servers), the repo's academic-talk-film skill as the local plugin `sage-talk`, the app's
//   tools as the in-process MCP server `talk` (always loaded, pre-approved), permissionMode
//   'default' with canUseTool (policy.ts), PostToolUse to label Claude's writes, partial
//   messages for streaming, maxBudgetUsd per request, resume/fork from .sage/session.json.
//
// Budget: maxBudgetUsd counts the spend since its query() call started (the CLI's own docs), so
// a process that has spent anything is recycled after its request (closed, and resumed in a
// fresh process with a fresh cap). The conversation and the prompt cache carry over. A
// resumed session's total_cost_usd continues from its saved total; translate.ts reports each
// request's growth, seeded from the total kept in .sage/session.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSdkMcpServer, query as sdkQuery, tool,
  type CanUseTool, type HookCallback, type Options, type PermissionResult, type SDKMessage, type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AppGotoParams, AppGotoResult, AppStateResult, AskDecision, AskParams, AskResult, BuildResult, ClaudeInterruptResult,
  ClaudeNotificationName, ClaudeNotifications, ClaudeSendParams, ClaudeSendResult, LayoutResult,
} from '../protocol.ts';
import type { Log } from '../rpc.ts';
import { locateBeat } from './beat-locator.ts';
import { chromiumFrames, type FrameRenderer } from './frames.ts';
import { resolveMaterials, type Materials } from './materials.ts';
import { absFrom, relInside, truncate } from './paths.ts';
import { APP_TOOL_PREFIX, PermissionStore, WRITE_TOOLS, decide, type Decision } from './policy.ts';
import { clearSession, loadSession, planResume, saveSession, type ResumePlan } from './session-store.ts';
import { talkTools, type TalkTool, type ToolResult } from './tools.ts';
import { Translator, summarize, type InitInfo } from './translate.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const DEFAULT_BUDGET_USD = 2;
const here = path.dirname(fileURLToPath(import.meta.url));
/** packages/sidecar/plugin: .claude-plugin/plugin.json + skills/academic-talk-film (a symlink to skill/). */
export const DEFAULT_PLUGIN_DIR = path.resolve(here, '../../plugin');
const ASK_TIMEOUT_MS = 30 * 60_000;

export const SYSTEM_APPEND = [
  'You are the assistant pane of SAGE, a Mac app for editing, presenting and publishing Kevin Moran\'s animation-first research talk films.',
  'The working directory is a sage-talk/1 talk: talk.json (the spine: chapters, beats, holds, notes), scenes/*.html, beats/*.js (motion), lib/*.js, theme.css. build/ is generated.',
  'The user is watching the canvas while you work: every file you save is rebuilt and reloaded, and the canvas follows the beat you last edited.',
  'Use the academic-talk-film skill for the format, style and voice. Use the talk tools: talk_layout for holds and diagnostics, talk_goto to show the user a beat, talk_frame to look at frames (it builds and renders with Chromium; then Read the PNG), talk_state for what the user is looking at, talk_materials for the paper.',
  'Do not start browsers, servers or headless Chrome yourself. Keep replies short; the user sees your tool calls.',
].join('\n');

/** The slice of the sidecar the bridge needs. */
export interface BridgeHost {
  /** Canonical talk folder. */
  root: string;
  /** talk.json, parsed (materials, chapters). */
  spine(): Promise<{ materials?: Record<string, string>; chapters?: { id: string; scene?: string; motion?: string; beats?: { id: string }[] }[] }>;
  layout(): Promise<LayoutResult>;
  build(): Promise<BuildResult>;
  expectWrite(rel: string, content: string | null, author: 'claude'): void;
  notify<N extends ClaudeNotificationName>(method: N, params: ClaudeNotifications[N]): void;
  /** sidecar -> app request (app.ask, app.state, app.goto). */
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  log: Log;
}

export interface QueryLike extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
}
export type QueryFn = (p: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => QueryLike;

/** One line of a recorded session (tests/claude/*.ndjson). */
export type TraceEntry =
  | { kind: 'sdk'; msg: SDKMessage }
  | { kind: 'send'; text: string }
  | { kind: 'canUseTool'; toolName: string; input: Record<string, unknown>; toolUseID: string; title?: string; behavior: 'allow' | 'deny' }
  | { kind: 'app'; method: string; params: unknown; result: unknown }
  | { kind: 'tool'; name: string; args: Record<string, unknown>; result: ToolResult }
  | { kind: 'hook'; input: Record<string, unknown> };

export interface BridgeOptions {
  model?: string;
  /** maxBudgetUsd per request (SAGE_CLAUDE_BUDGET_USD, default 2). */
  budgetUsd?: number;
  pluginDir?: string;
  queryFn?: QueryFn;
  frames?: FrameRenderer;
  trace?: (e: TraceEntry) => void;
  env?: Record<string, string | undefined>;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
}

/** An AsyncIterable the bridge pushes user messages into (streaming-input mode). */
export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;
  push(m: SDKUserMessage) {
    if (this.ended) return;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: m, done: false }); } else this.items.push(m);
  }
  end() {
    this.ended = true;
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ value: undefined, done: true }); }
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const m = this.items.shift();
        if (m) return Promise.resolve({ value: m, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => { this.waiting = r; });
      },
      return: () => { this.end(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

interface Live { q: QueryLike; input: InputQueue; plan: ResumePlan; spent: number; done: Promise<void> }

export class ClaudeBridge {
  readonly model: string;
  readonly budgetUsd: number;
  readonly pluginDir: string;
  private live: Live | null = null;
  private translator: Translator;
  private store: PermissionStore;
  private materials: Materials = { entries: [], dirs: [], diagnostics: [] };
  private spineCache: Awaited<ReturnType<BridgeHost['spine']>> = {};
  private running = false;
  private sawResult = false;
  private turns = 0;
  private frames: FrameRenderer;
  private tools: TalkTool[];
  private closed = false;

  constructor(private host: BridgeHost, private opts: BridgeOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    const envBudget = Number(process.env.SAGE_CLAUDE_BUDGET_USD);
    this.budgetUsd = opts.budgetUsd ?? (envBudget > 0 ? envBudget : DEFAULT_BUDGET_USD);
    this.pluginDir = opts.pluginDir ?? process.env.SAGE_PLUGIN_DIR ?? DEFAULT_PLUGIN_DIR;
    this.frames = opts.frames ?? chromiumFrames();
    this.store = new PermissionStore(host.root);
    this.translator = this.makeTranslator();
    this.tools = talkTools({
      talkRoot: host.root,
      layout: () => host.layout(),
      build: () => host.build(),
      materials: () => this.materials,
      app: {
        state: () => this.appRequest<AppStateResult>('app.state', {}),
        goto: (p: AppGotoParams) => this.appRequest<AppGotoResult>('app.goto', p),
      },
      frames: this.frames,
    }).map((t) => ({
      ...t,
      handler: async (args: Record<string, unknown>) => {
        let result: ToolResult;
        try { result = await t.handler(args); } catch (e) { result = { content: [{ type: 'text', text: `${t.name} failed: ${(e as Error).message}` }], isError: true }; }
        this.opts.trace?.({ kind: 'tool', name: t.name, args, result });
        return result;
      },
    }));
  }

  get isRunning() { return this.running; }
  get totalCost() { return this.translator.totalCost; }
  /** The app tools with their handlers (the replay tests call them as the SDK would). */
  get toolHandlers(): ReadonlyMap<string, TalkTool['handler']> { return new Map(this.tools.map((t) => [t.name, t.handler])); }

  // ---------------------------------------------------------------------------------------
  // Methods

  async send(p: ClaudeSendParams): Promise<ClaudeSendResult> {
    if (this.closed) throw new Error('the Claude bridge is closed');
    this.opts.trace?.({ kind: 'send', text: p.text });
    if (this.live && !this.running && this.live.spent > 0) await this.recycle();
    const live = await this.ensureLive();
    const text = p.attachments?.length
      ? `${p.text}\n\nAttached files:\n${p.attachments.map((a) => `- ${absFrom(this.host.root, a)}`).join('\n')}`
      : p.text;
    this.turns += 1;
    this.running = true;
    this.sawResult = false;
    this.host.notify('claude.status', { state: 'running' });
    live.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, origin: { kind: 'human' } } as SDKUserMessage);
    return { turn: this.turns };
  }

  async interrupt(): Promise<ClaudeInterruptResult> {
    if (!this.live || !this.running) return { interrupted: false };
    this.translator.interrupting = true;
    try { await this.live.q.interrupt(); } catch (e) { this.host.log('warn', `interrupt failed: ${(e as Error).message}`); }
    return { interrupted: true };
  }

  async reset(): Promise<void> {
    await this.stopLive();
    clearSession(this.host.root);
    this.translator = this.makeTranslator();
    this.running = false;
    this.host.notify('claude.status', { state: 'idle', message: 'New conversation' });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.stopLive();
    await this.frames.close();
  }

  // ---------------------------------------------------------------------------------------
  // Message handling (public so recorded sessions replay through it)

  handleMessage(msg: SDKMessage) {
    this.opts.trace?.({ kind: 'sdk', msg });
    const isResult = (msg as { type?: string }).type === 'result';
    if (isResult) { this.sawResult = true; this.running = false; }
    this.translator.handle(msg);
    if (isResult) {
      if (this.live) this.live.spent += this.translator.lastCost;
      const sid = (msg as { session_id?: string }).session_id;
      if (sid) this.saveSession(sid);
    }
  }

  private saveSession(sessionId: string) {
    try { saveSession(this.host.root, sessionId, { totalCostUsd: this.translator.sessionTotal }); } catch (e) { this.host.log('warn', `could not save the session: ${(e as Error).message}`); }
  }

  /** canUseTool, exposed for the policy and replay tests. */
  readonly canUseTool: CanUseTool = async (toolName, input, o) => {
    const d = decide(toolName, input, { talkRoot: this.host.root, readRoots: [this.host.root, ...this.materials.dirs], rules: this.store.rules });
    const res = await this.apply(d, toolName, input, o.toolUseID, o.title, o.signal);
    this.opts.trace?.({ kind: 'canUseTool', toolName, input, toolUseID: o.toolUseID, ...(o.title ? { title: o.title } : {}), behavior: res.behavior });
    return res;
  };

  /** PostToolUse: re-announce the file as written, so a mispredicted Edit is still labelled 'claude'. */
  readonly postToolUse: HookCallback = async (input) => {
    const i = input as unknown as { tool_name?: string; tool_input?: Record<string, unknown> };
    this.opts.trace?.({ kind: 'hook', input: { hook_event_name: 'PostToolUse', tool_name: i.tool_name, tool_input: i.tool_input } });
    if (i.tool_name && WRITE_TOOLS.has(i.tool_name)) {
      const fp = (i.tool_input?.file_path ?? i.tool_input?.notebook_path) as string | undefined;
      const abs = fp ? absFrom(this.host.root, fp) : null;
      const rel = abs ? relInside(this.host.root, abs) : null;
      if (abs && rel !== null) {
        try { this.host.expectWrite(rel, fs.readFileSync(abs, 'utf8'), 'claude'); } catch { /* deleted or unreadable */ }
      }
    }
    return { continue: true };
  };

  // ---------------------------------------------------------------------------------------

  private makeTranslator() {
    return new Translator({
      talkRoot: this.host.root,
      emit: (m, p) => this.host.notify(m, p),
      locateBeat: (rel, input) => locateBeat(this.host.root, this.spineCache, rel, input),
      onInit: (info) => this.onInit(info),
    });
  }

  private onInit(info: InitInfo) {
    if (info.sessionId) this.saveSession(info.sessionId);
    const others = info.mcpServers.filter((s) => s.name !== 'talk').map((s) => s.name);
    if (others.length) this.host.log('warn', `MCP servers other than talk are loaded: ${others.length}`);
    if (!info.skillLoaded) this.host.log('warn', 'the bundled academic-talk-film skill is not listed in init');
  }

  private async apply(d: Decision, toolName: string, input: Record<string, unknown>, toolUseID: string, title: string | undefined, signal: AbortSignal): Promise<PermissionResult> {
    if (d.kind === 'allow') {
      if (d.announce) this.host.expectWrite(d.announce.rel, d.announce.content, 'claude');
      return { behavior: 'allow', updatedInput: input };
    }
    if (d.kind === 'deny') {
      this.translator.denied(toolUseID, toolName, input, d.message);
      return { behavior: 'deny', message: d.message };
    }
    const { summary } = summarize(toolName, input, this.host.root);
    const params: AskParams = {
      tool: toolName,
      title: title ?? `Claude wants to use ${toolName}${summary ? `: ${truncate(summary, 120)}` : ''}`,
      summary: truncate(toolName === 'Bash' ? String(input.command ?? '') : summary, 2000),
      reason: d.reason,
      scope: d.scope,
      ...(d.path ? { path: d.path } : {}),
    };
    let decision: AskDecision = 'deny';
    try {
      const r = await Promise.race([
        this.appRequest<AskResult>('app.ask', params, ASK_TIMEOUT_MS),
        new Promise<never>((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true })),
      ]);
      decision = r.decision;
    } catch (e) {
      this.host.log('info', `app.ask for ${toolName} ended without approval: ${(e as Error).message}`);
    }
    if (decision === 'allowTalk') this.store.add(d.rule);
    if (decision === 'allow' || decision === 'allowTalk') return { behavior: 'allow', updatedInput: input };
    const message = 'The user declined this action in SAGE. Do not retry it; ask in your reply if it is needed.';
    this.translator.denied(toolUseID, toolName, input, message);
    return { behavior: 'deny', message };
  }

  private async appRequest<R>(method: string, params: unknown, timeoutMs = 15_000): Promise<R> {
    const result = (await this.host.request(method, params, timeoutMs)) as R;
    this.opts.trace?.({ kind: 'app', method, params, result });
    return result;
  }

  /** Builds the query options (exported through `options()` for tests and the live smoke). */
  async options(plan: ResumePlan): Promise<Options> {
    this.spineCache = await this.host.spine().catch(() => ({}));
    this.materials = resolveMaterials(this.host.root, this.spineCache.materials);
    for (const d of this.materials.diagnostics) this.host.log('warn', d);
    const server = createSdkMcpServer({
      name: 'talk',
      version: '1.0.0',
      alwaysLoad: true, // not deferred behind ToolSearch (cost a turn in Phase 0)
      tools: this.tools.map((t) => tool(t.name, t.description, t.shape, (args) => t.handler(args as Record<string, unknown>) as never)),
    });
    const o: Options = {
      model: this.model,
      cwd: this.host.root,
      additionalDirectories: this.materials.dirs,
      env: { ...(this.opts.env ?? process.env), CLAUDE_AGENT_SDK_CLIENT_APP: 'sage-talk-editor/0.1.0' },
      settingSources: [],
      strictMcpConfig: true,
      plugins: [{ type: 'local', path: this.pluginDir }],
      mcpServers: { talk: server },
      allowedTools: this.tools.map((t) => APP_TOOL_PREFIX + t.name),
      permissionMode: 'default',
      canUseTool: this.canUseTool,
      hooks: { PostToolUse: [{ matcher: 'Write|Edit|MultiEdit|NotebookEdit', hooks: [this.postToolUse] }] },
      includePartialMessages: true,
      maxBudgetUsd: this.budgetUsd,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
      stderr: (s: string) => this.host.log('debug', `claude: ${s.trimEnd()}`),
      ...(this.opts.effort ? { effort: this.opts.effort } : {}),
      ...(this.opts.maxTurns ? { maxTurns: this.opts.maxTurns } : {}),
      ...(plan.resume ? { resume: plan.resume } : {}),
      ...(plan.forkSession ? { forkSession: true } : {}),
    };
    return o;
  }

  private async ensureLive(): Promise<Live> {
    if (this.live) return this.live;
    const stored = loadSession(this.host.root);
    const plan = planResume(stored, this.host.root);
    // The first process of this sidecar resuming a session: its results continue from the saved total.
    if (plan.resume && this.translator.sessionTotal === 0) this.translator.seedTotal(stored?.totalCostUsd ?? 0);
    const options = await this.options(plan);
    const notes = [
      ...(plan.mode === 'resume' ? ['Resuming the conversation'] : plan.mode === 'fork' ? ['The talk moved; continuing its conversation as a fork'] : []),
      ...this.materials.diagnostics,
    ];
    this.host.notify('claude.status', { state: 'starting', ...(notes.length ? { message: notes.join('; ') } : {}) });
    const input = new InputQueue();
    const q = (this.opts.queryFn ?? (sdkQuery as unknown as QueryFn))({ prompt: input, options });
    const live: Live = { q, input, plan, spent: 0, done: Promise.resolve() };
    live.done = this.pump(live);
    this.live = live;
    return live;
  }

  private async pump(live: Live) {
    try {
      for await (const m of live.q) this.handleMessage(m);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      // query() throws after an error result (e.g. error_max_budget_usd); that result was reported.
      if (this.running && !this.sawResult) {
        this.host.notify('claude.result', {
          cost: 0, totalCost: this.translator.totalCost,
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextTokens: 0 },
          sessionId: loadSession(this.host.root)?.sessionId ?? '', durationMs: 0, turns: 0,
          error: { kind: 'process', message: truncate(msg, 500) },
        });
        this.host.notify('claude.status', { state: 'error', message: truncate(msg, 300) });
      } else {
        this.host.log('info', `query ended: ${truncate(msg, 300)}`);
      }
    } finally {
      if (this.live === live) { this.live = null; this.running = false; }
    }
  }

  /** Ends the current process (its budget is spent) so the next request resumes in a fresh one. */
  private async recycle() {
    this.host.log('info', `recycling the query process after ${this.live?.spent.toFixed(4)} USD`);
    await this.stopLive();
  }

  private async stopLive() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    live.input.end();
    try { live.q.close(); } catch { /* already closed */ }
    await Promise.race([live.done, new Promise((r) => setTimeout(r, 3_000).unref())]);
  }
}
