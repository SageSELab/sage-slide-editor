// translate.ts — Agent SDK messages to the chat pane's notifications (claude.delta, claude.tool,
// claude.result, claude.status). Stateful (it pairs tool_use with tool_result and knows which
// assistant messages were already streamed) but free of I/O beyond the injected callbacks, so
// recorded sessions replay through it with no SDK process (tests/claude/*.ndjson).
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  ClaudeErrorKind, ClaudeNotificationName, ClaudeNotifications, ClaudeResultParams, ClaudeToolParams, ClaudeUsage,
} from '../protocol.ts';
import { absFrom, relInside, truncate } from './paths.ts';
import { APP_TOOL_PREFIX, WRITE_TOOLS } from './policy.ts';

export const SKILL_NAME = 'sage-talk:academic-talk-film';

export type Emit = <N extends ClaudeNotificationName>(method: N, params: ClaudeNotifications[N]) => void;

export interface InitInfo { sessionId: string; model: string; skillLoaded: boolean; tools: string[]; mcpServers: { name: string; status: string }[] }

export interface TranslatorOptions {
  talkRoot: string;
  emit: Emit;
  /** Beat touched by a write inside the talk (beat-locator), for the canvas to follow. */
  locateBeat?: (rel: string, input: Record<string, unknown>) => string | undefined;
  onInit?: (info: InitInfo) => void;
  onResult?: (r: ClaudeResultParams) => void;
}

interface ToolCall { name: string; summary: string; input: Record<string, unknown>; path?: string; beat?: string | undefined; status: ClaudeToolParams['status'] }

type Block = { type: string; [k: string]: unknown };
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function shortToolName(name: string) {
  return name.startsWith(APP_TOOL_PREFIX) ? name.slice(APP_TOOL_PREFIX.length) : name;
}

/** One line describing a tool call for its row in the chat. */
export function summarize(name: string, input: Record<string, unknown>, talkRoot: string): { summary: string; path?: string } {
  const short = shortToolName(name);
  const fp = s(input.file_path) || s(input.notebook_path);
  if (fp) {
    const abs = absFrom(talkRoot, fp);
    const rel = relInside(talkRoot, abs);
    return rel !== null ? { summary: rel, path: rel } : { summary: abs };
  }
  const at = (o: Record<string, unknown>) =>
    typeof o.beat === 'string' ? `beat ${o.beat}` : typeof o.time === 'number' ? `t = ${o.time} s` : '';
  switch (short) {
    case 'Bash': return { summary: truncate(s(input.description) || s(input.command), 100) };
    case 'Glob': return { summary: s(input.pattern) + (s(input.path) ? ` in ${s(input.path)}` : '') };
    case 'Grep': return { summary: `"${truncate(s(input.pattern), 60)}"` + (s(input.path) ? ` in ${relInside(talkRoot, absFrom(talkRoot, s(input.path))) ?? s(input.path)}` : '') };
    case 'Skill': return { summary: s(input.skill) || s(input.command) || s(input.name) };
    case 'ToolSearch': return { summary: s(input.query) };
    case 'WebFetch': return { summary: s(input.url) };
    case 'WebSearch': return { summary: s(input.query) };
    case 'Task': case 'Agent': return { summary: s(input.description) };
    case 'talk_frame': {
      const a = at(input);
      return { summary: (a || 'current time') + (typeof input.around === 'number' ? ` ±${input.around} s` : '') };
    }
    case 'talk_goto': return { summary: at(input) };
    case 'talk_insert_beat': {
      const where = s(input.after) ? `after ${s(input.after)}` : s(input.chapter) ? `in ${s(input.chapter)}` : '';
      return { summary: [`${s(input.id)} "${truncate(s(input.label), 40)}"`, where].filter(Boolean).join(' ') };
    }
    case 'talk_set_notes': return { summary: s(input.beat) };
    default: {
      const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined;
      return { summary: first ? truncate(first, 80) : '' };
    }
  }
}

/** The app's spine tools; their result names the beat they changed (for the canvas to follow). */
export const SPINE_TOOLS = new Set(['talk_insert_beat', 'talk_set_notes']);
export function spineToolBeat(result: string): string | undefined {
  return /^(?:Inserted beat|Set the notes of) ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/.exec(result)?.[1];
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      const o = asObj(b);
      if (o.type === 'text') return s(o.text);
      if (o.type === 'image') return '[image]';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

const ERROR_KINDS: Record<string, ClaudeErrorKind> = {
  error_max_budget_usd: 'budget',
  error_max_turns: 'max_turns',
  error_during_execution: 'execution',
};

export class Translator {
  private calls = new Map<string, ToolCall>();
  private streamed = new Set<string>();
  private currentMessage: string | null = null;
  private last: 'text' | 'tool' | null = null;
  private pendingSeparator = false;
  private lastUsage: ClaudeUsage | null = null;
  /**
   * total_cost_usd is the session's running total: cumulative across the turns of a process,
   * and a resumed or forked session starts from the total its transcript saved (the CLI's own
   * field docs). A request costs the growth since the last total seen; a total below it means
   * the running total restarted (a transcript without a saved total), and then all of it is
   * this request's.
   */
  private lastTotal = 0;
  private conversationTotal = 0;
  /** The cost of the last result. */
  lastCost = 0;
  /** Set by the bridge before an interrupt, so the error result reads as 'interrupted'. */
  interrupting = false;

  constructor(private o: TranslatorOptions) {}

  /** The running total of the session about to be resumed (from .sage/session.json). */
  seedTotal(total: number) { this.lastTotal = total; }

  /** The session's running total at the last result. */
  get sessionTotal() { return this.lastTotal; }
  get totalCost() { return this.conversationTotal; }

  /** A call canUseTool denied; its tool_result arrives later as an error and keeps the 'denied' status. */
  denied(id: string, name: string, input: Record<string, unknown>, message: string) {
    const c = this.call(id, name, input);
    c.status = 'denied';
    this.emitTool(id, c, message);
  }

  handle(msg: SDKMessage): void {
    const m = msg as unknown as Record<string, unknown>;
    switch (m.type) {
      case 'system': return this.system(m);
      case 'stream_event': return this.stream(m);
      case 'assistant': return this.assistant(m);
      case 'user': return this.user(m);
      case 'result': return this.result(m);
      default: return;
    }
  }

  // -------------------------------------------------------------------------------------

  private system(m: Record<string, unknown>) {
    if (m.subtype !== 'init') return;
    const skills = Array.isArray(m.skills) ? (m.skills as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const info: InitInfo = {
      sessionId: s(m.session_id),
      model: s(m.model),
      skillLoaded: skills.includes(SKILL_NAME),
      tools: Array.isArray(m.tools) ? (m.tools as string[]) : [],
      mcpServers: Array.isArray(m.mcp_servers) ? (m.mcp_servers as { name: string; status: string }[]) : [],
    };
    this.o.onInit?.(info);
    this.o.emit('claude.status', { state: 'running', sessionId: info.sessionId, model: info.model, skillLoaded: info.skillLoaded });
  }

  private stream(m: Record<string, unknown>) {
    if (m.parent_tool_use_id) return; // a subagent's stream
    const ev = asObj(m.event);
    switch (ev.type) {
      case 'message_start': {
        const id = s(asObj(ev.message).id);
        this.currentMessage = id || null;
        return;
      }
      case 'content_block_start': {
        if (asObj(ev.content_block).type === 'text' && this.last === 'text') this.pendingSeparator = true;
        return;
      }
      case 'content_block_delta': {
        const d = asObj(ev.delta);
        if (d.type !== 'text_delta' || !s(d.text)) return;
        if (this.currentMessage) this.streamed.add(this.currentMessage);
        this.text(s(d.text));
        return;
      }
      default: return;
    }
  }

  private text(t: string) {
    if (this.pendingSeparator) { t = '\n\n' + t; this.pendingSeparator = false; }
    this.last = 'text';
    this.o.emit('claude.delta', { text: t });
  }

  private assistant(m: Record<string, unknown>) {
    if (m.parent_tool_use_id) return;
    const message = asObj(m.message);
    const id = s(message.id);
    const usage = asObj(message.usage);
    if (Object.keys(usage).length) {
      const n = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
      this.lastUsage = {
        inputTokens: n('input_tokens'), outputTokens: n('output_tokens'),
        cacheReadTokens: n('cache_read_input_tokens'), cacheCreationTokens: n('cache_creation_input_tokens'),
        contextTokens: n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens'),
      };
    }
    const blocks = Array.isArray(message.content) ? (message.content as Block[]) : [];
    for (const b of blocks) {
      if (b.type === 'text') {
        if (!this.streamed.has(id) && s(b.text)) {
          if (this.last === 'text') this.pendingSeparator = true;
          this.text(s(b.text));
        }
      } else if (b.type === 'tool_use') {
        const tid = s(b.id);
        if (!tid || this.calls.has(tid)) continue;
        const c = this.call(tid, s(b.name), asObj(b.input));
        this.last = 'tool';
        this.emitTool(tid, c);
      }
    }
  }

  private user(m: Record<string, unknown>) {
    if (m.parent_tool_use_id) return;
    const content = asObj(m.message).content;
    if (!Array.isArray(content)) return;
    for (const raw of content) {
      const b = asObj(raw);
      if (b.type !== 'tool_result') continue;
      const id = s(b.tool_use_id);
      const c = this.calls.get(id);
      if (!c) continue;
      const text = resultText(b.content);
      if (c.status !== 'denied') {
        c.status = b.is_error === true ? 'error' : 'done';
        if (c.status === 'done' && c.path && WRITE_TOOLS.has(c.name)) { const b = this.o.locateBeat?.(c.path, c.input); if (b) c.beat = b; }
        if (c.status === 'done' && SPINE_TOOLS.has(c.name)) { const b = spineToolBeat(text); if (b) c.beat = b; }
      }
      this.emitTool(id, c, text);
    }
  }

  private result(m: Record<string, unknown>) {
    const total = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0;
    const cost = total >= this.lastTotal ? total - this.lastTotal : total;
    this.lastTotal = total;
    this.lastCost = cost;
    this.conversationTotal += cost;
    const usage = asObj(m.usage);
    const n = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
    const params: ClaudeResultParams = {
      cost: round6(cost),
      totalCost: round6(this.conversationTotal),
      usage: {
        inputTokens: n('input_tokens'), outputTokens: n('output_tokens'),
        cacheReadTokens: n('cache_read_input_tokens'), cacheCreationTokens: n('cache_creation_input_tokens'),
        contextTokens: this.lastUsage?.contextTokens ?? 0,
      },
      sessionId: s(m.session_id),
      durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : 0,
      turns: typeof m.num_turns === 'number' ? m.num_turns : 0,
    };
    if (m.subtype !== 'success' || m.is_error === true) {
      const kind: ClaudeErrorKind = this.interrupting ? 'interrupted' : ERROR_KINDS[s(m.subtype)] ?? 'execution';
      const errors = Array.isArray(m.errors) ? (m.errors as unknown[]).map(String).filter(Boolean) : [];
      const message = kind === 'budget' ? `Stopped: this request reached its budget (${errors[0] ?? 'max budget'}).`
        : kind === 'interrupted' ? 'Stopped.'
        : errors.join('; ') || s(m.result) || `The request ended with ${s(m.subtype) || 'an error'}.`;
      params.error = { kind, message };
    }
    this.interrupting = false;
    this.last = null;
    this.pendingSeparator = false;
    // Rows still running when the request ended (an interrupt) are closed as errors.
    for (const [id, c] of this.calls) if (c.status === 'running') { c.status = 'error'; this.emitTool(id, c, 'Stopped before it finished.'); }
    this.calls.clear();
    this.o.onResult?.(params);
    this.o.emit('claude.result', params);
    this.o.emit('claude.status', { state: 'idle', sessionId: params.sessionId });
  }

  private call(id: string, name: string, input: Record<string, unknown>): ToolCall {
    let c = this.calls.get(id);
    if (!c) {
      const { summary, path } = summarize(name, input, this.o.talkRoot);
      c = { name: shortToolName(name), summary, input, status: 'running', ...(path ? { path } : {}) };
      const short = c.name;
      if ((short === 'talk_goto' || short === 'talk_frame') && typeof input.beat === 'string') c.beat = input.beat;
      this.calls.set(id, c);
    }
    return c;
  }

  private emitTool(id: string, c: ToolCall, detail?: string) {
    const p: ClaudeToolParams = { id, name: c.name, summary: c.summary, status: c.status };
    if (detail) p.detail = truncate(detail, 4000);
    if (c.path) p.path = c.path;
    if (c.beat) p.beat = c.beat;
    this.o.emit('claude.tool', p);
  }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
