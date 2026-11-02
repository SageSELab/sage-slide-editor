// claude-trace.ts — recorded Agent SDK sessions (tests/claude/*.ndjson): scrubbing before commit,
// and a fake query() that replays one through the bridge with no SDK process (PLAN 12.7).
//
// A recording is one TraceEntry per line, in the order the bridge saw them: SDK messages,
// canUseTool calls, app tool calls, PostToolUse hooks, app requests, and the notifications the
// bridge sent ({kind: 'notify'}). Placeholders replace machine-specific paths:
// <TALK> the talk folder, <BASE> its parent (materials live there), <REPO>, ~ for $HOME.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn, QueryLike, TraceEntry } from '../src/claude/bridge.ts';

export type Recorded = TraceEntry | { kind: 'notify'; method: string; params: unknown } | { kind: 'meta'; [k: string]: unknown };

export interface Places { talk: string; base: string; repo: string; home?: string }

const OWN_PLUGIN = 'sage-talk';

/** Replaces machine paths with placeholders, longest first. */
export function scrubText(s: string, p: Places): string {
  const pairs: [string, string][] = [[p.talk, '<TALK>'], [p.base, '<BASE>'], [p.repo, '<REPO>'], [p.home ?? os.homedir(), '~']];
  // macOS reports temp folders both as /var/... and /private/var/...
  const all = pairs.flatMap(([a, b]) => (a.startsWith('/private/') ? [[a, b], [a.slice('/private'.length), b]] : [[a, b]]) as [string, string][]);
  all.sort((x, y) => y[0].length - x[0].length);
  for (const [a, b] of all) s = s.split(a).join(b);
  return s;
}

export function unscrubText(s: string, p: Places): string {
  return s.split('<TALK>').join(p.talk).split('<BASE>').join(p.base).split('<REPO>').join(p.repo);
}

/**
 * The init message lists the user's own skills, plugins, MCP servers, agents and slash
 * commands when any leak in; only the app's own survive a recording.
 */
export function scrubInit(msg: Record<string, unknown>): Record<string, unknown> {
  const m = { ...msg };
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  m.skills = strs(m.skills).filter((s) => s.startsWith(OWN_PLUGIN + ':'));
  m.slash_commands = strs(m.slash_commands).filter((s) => s.startsWith(OWN_PLUGIN + ':'));
  m.tools = strs(m.tools).filter((t) => !t.startsWith('mcp__') || t.startsWith('mcp__talk__'));
  m.mcp_servers = (Array.isArray(m.mcp_servers) ? m.mcp_servers : []).filter((s) => (s as { name?: string })?.name === 'talk');
  m.plugins = (Array.isArray(m.plugins) ? m.plugins : []).filter((s) => (s as { name?: string })?.name === OWN_PLUGIN);
  for (const k of ['agents', 'plugin_errors', 'memory_paths', 'messaging_socket_path', 'account', 'organization', 'email']) delete m[k];
  return m;
}

export function scrubEntry(e: Recorded, p: Places): Recorded {
  let out = e;
  const msg = e.kind === 'sdk' ? (e.msg as unknown as Record<string, unknown>) : null;
  if (msg?.type === 'system' && msg.subtype === 'init') {
    out = { kind: 'sdk', msg: scrubInit(msg) as unknown as SDKMessage };
  } else if (msg?.type === 'stream_event') {
    // Tool-input deltas split paths across chunks, where no placeholder can match them. The
    // bridge does not use them (the full input arrives with the assistant message).
    const ev = msg.event as { delta?: { type?: string; partial_json?: string } } | undefined;
    if (ev?.delta?.type === 'input_json_delta') {
      out = { kind: 'sdk', msg: { ...msg, event: { ...ev, delta: { ...ev.delta, partial_json: '' } } } as unknown as SDKMessage };
    }
  }
  // Image payloads (a Read of a frame PNG) are large and irrelevant to the bridge.
  const elide = (_k: string, v: unknown) => (typeof v === 'string' && v.length > 2000 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 2000)) ? '<base64 elided>' : v);
  return JSON.parse(scrubText(JSON.stringify(out, elide), p)) as Recorded;
}

/** Strings a committed recording must not contain. */
export const LEAK_PATTERNS = [/\/Users\//, /\/var\/folders\//, /\/private\/var/, /sage-rec-/, /cc-socks/];

export function readRecording(file: string, p: Places): Recorded[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(unscrubText(l, p)) as Recorded);
}

/** Applies a recorded Write/Edit to disk, as the CLI would after canUseTool allowed it. */
export function applyWrite(toolName: string, input: Record<string, unknown>) {
  const fp = String(input.file_path ?? '');
  if (!fp) return;
  if (toolName === 'Write') { fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, String(input.content ?? '')); return; }
  if (toolName === 'Edit') {
    const text = fs.readFileSync(fp, 'utf8');
    const o = String(input.old_string), n = String(input.new_string);
    fs.writeFileSync(fp, input.replace_all === true ? text.split(o).join(n) : text.replace(o, () => n));
  }
}

export interface ReplayHooks {
  /** Called for each recorded canUseTool entry with what the bridge decided now. */
  onCanUseTool?: (recorded: Extract<TraceEntry, { kind: 'canUseTool' }>, behavior: 'allow' | 'deny') => void;
  onTool?: (recorded: Extract<TraceEntry, { kind: 'tool' }>, result: unknown) => void;
  /** Lets the test wait (e.g. for the watcher) after a write was applied. */
  afterWrite?: (toolName: string, input: Record<string, unknown>) => Promise<void>;
}

/**
 * A QueryFn over a recording. Each `send` entry waits for the bridge to push a user message;
 * SDK messages are yielded; canUseTool / tool / hook entries are re-enacted by calling the
 * bridge's own callbacks (from the options it built, and its tool handlers). One cursor is
 * shared, so a bridge that recycles its process continues where the last one stopped.
 */
export function replayQuery(entries: Recorded[], tools: () => ReadonlyMap<string, (a: Record<string, unknown>) => Promise<unknown>>, hooks: ReplayHooks = {}) {
  let i = 0;
  const calls: { options: Options }[] = [];
  const fn: QueryFn = ({ prompt, options }) => {
    calls.push({ options });
    const input = prompt[Symbol.asyncIterator]();
    let closed = false;
    async function* run(): AsyncGenerator<SDKMessage> {
      while (i < entries.length && !closed) {
        const e = entries[i]!;
        if (e.kind === 'send') {
          const next = await input.next();
          if (next.done) return;
          const content = (next.value as SDKUserMessage).message.content;
          if (typeof content !== 'string' || !content.startsWith(e.text)) throw new Error(`replay: expected send "${e.text.slice(0, 40)}", got "${String(content).slice(0, 40)}"`);
          i++;
          continue;
        }
        i++;
        // A bridge that recycles its process after a result ends this input; the send entry
        // then stays for the next process's generator.
        if (e.kind === 'sdk') {
          yield e.msg;
        } else if (e.kind === 'canUseTool') {
          const r = await options.canUseTool!(e.toolName, e.input, { signal: new AbortController().signal, toolUseID: e.toolUseID, requestId: 'replay', ...(e.title ? { title: e.title } : {}) } as Parameters<NonNullable<Options['canUseTool']>>[2]);
          hooks.onCanUseTool?.(e, r?.behavior ?? 'deny');
          if (r?.behavior === 'allow' && (e.toolName === 'Write' || e.toolName === 'Edit')) {
            applyWrite(e.toolName, e.input);
            await hooks.afterWrite?.(e.toolName, e.input);
          }
        } else if (e.kind === 'tool') {
          const h = tools().get(e.name);
          if (!h) throw new Error(`replay: no handler for ${e.name}`);
          hooks.onTool?.(e, await h(e.args));
        } else if (e.kind === 'hook') {
          const post = options.hooks?.PostToolUse?.[0]?.hooks[0];
          await post?.(e.input as never, undefined, { signal: new AbortController().signal });
        }
        // 'app' entries are answered by the test's fake app; 'notify' and 'meta' are expectations.
      }
    }
    const gen = run();
    const q: QueryLike = {
      [Symbol.asyncIterator]: () => gen,
      interrupt: async () => undefined,
      close: () => { closed = true; void input.return?.(); },
    };
    return q;
  };
  return { fn, calls, get position() { return i; } };
}
