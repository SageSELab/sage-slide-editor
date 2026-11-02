// Phase 0 SDK spike. Run: npx tsx spike.ts [A|B|C|D|all]
import { query, createSdkMcpServer, tool, type Options, type HookCallback, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { appendFileSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TALK = resolve(HERE, 'sandbox/talk');
const PAPER = resolve(HERE, 'sandbox/paper');
const PLUGIN = resolve(HERE, 'plugin');
const LOG = resolve(HERE, 'logs');
const MODEL = process.env.SPIKE_MODEL ?? 'claude-opus-5-5';

delete process.env.ANTHROPIC_API_KEY; // Q1: make sure no key is inherited
const env = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'sage-talk-editor-spike/0.0.0' };
delete (env as any).ANTHROPIC_API_KEY;

function log(run: string, kind: string, data: unknown) {
  appendFileSync(`${LOG}/${run}.ndjson`, JSON.stringify({ t: Date.now(), kind, data }) + '\n');
}

const talkServer = createSdkMcpServer({
  name: 'talk',
  version: '0.0.1',
  tools: [
    tool('talk_state', 'Current playhead state of the open talk (beat id and time in seconds).', {}, async () => ({
      content: [{ type: 'text', text: JSON.stringify({ beat: 'title', t: 5.0 }) }],
    })),
  ],
});

function inside(p: string, root: string) {
  const abs = resolve(TALK, p);
  return abs === root || abs.startsWith(root + '/');
}

function makeCanUseTool(run: string): CanUseTool {
  return async (toolName, input, opts) => {
    const fp = (input.file_path ?? input.notebook_path ?? input.path) as string | undefined;
    const rec = { toolName, input, blockedPath: opts.blockedPath, decisionReason: opts.decisionReason, title: opts.title, displayName: opts.displayName, suggestions: opts.suggestions, mcpServer: opts.mcpServer };
    const writeTools = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
    let decision: Awaited<ReturnType<CanUseTool>>;
    if (writeTools.includes(toolName) && fp && inside(fp, TALK)) decision = { behavior: 'allow', updatedInput: input };
    else if (toolName.startsWith('mcp__talk__')) decision = { behavior: 'allow', updatedInput: input };
    else decision = { behavior: 'deny', message: `SAGE spike policy: ${toolName} on ${fp ?? '(no path)'} is outside the talk folder.` };
    log(run, 'canUseTool', { ...rec, decision });
    console.log(`[canUseTool] ${toolName} ${fp ?? ''} -> ${decision.behavior}`);
    return decision;
  };
}

function makeHooks(run: string): Options['hooks'] {
  const h = (name: string): HookCallback => async (input) => {
    const i: any = input;
    log(run, `hook:${name}`, input);
    console.log(`[hook ${name}] ${i.tool_name ?? ''} ${i.tool_input?.file_path ?? i.file_path ?? ''} ${i.event ?? ''}`);
    return { continue: true };
  };
  return {
    PostToolUse: [{ hooks: [h('PostToolUse')] }],
    FileChanged: [{ hooks: [h('FileChanged')] }],
    PermissionDenied: [{ hooks: [h('PermissionDenied')] }],
  };
}

function baseOptions(run: string): Options {
  return {
    model: MODEL,
    cwd: TALK,
    additionalDirectories: [PAPER],
    env,
    includePartialMessages: true,
    permissionMode: 'default',
    canUseTool: makeCanUseTool(run),
    hooks: makeHooks(run),
    mcpServers: { talk: talkServer },
    allowedTools: ['mcp__talk__talk_state'],
    plugins: [{ type: 'local', path: PLUGIN }],
    maxBudgetUsd: 0.5,
    maxTurns: 8,
    stderr: (d) => log(run, 'stderr', d),
  };
}

type RunOut = { sessionId?: string; cost?: number; result?: string; init?: any; deltas: number; ttfdMs?: number };

async function run(name: string, prompt: string, extra: Partial<Options> = {}): Promise<RunOut> {
  if (existsSync(`${LOG}/${name}.ndjson`)) rmSync(`${LOG}/${name}.ndjson`);
  const out: RunOut = { deltas: 0 };
  const t0 = Date.now();
  console.log(`\n=== RUN ${name}: ${prompt}`);
  try {
    for await (const m of query({ prompt, options: { ...baseOptions(name), ...extra } }) as AsyncIterable<SDKMessage>) {
      const msg: any = m;
      if (msg.type === 'stream_event') {
        const e = msg.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          out.deltas++;
          if (out.ttfdMs === undefined) { out.ttfdMs = Date.now() - t0; log(name, 'first_text_delta', { ms: out.ttfdMs, sdk_ttft_ms: msg.ttft_ms, text: e.delta.text }); }
        }
        continue; // too many to log individually
      }
      log(name, msg.type + (msg.subtype ? ':' + msg.subtype : ''), msg);
      if (msg.type === 'system' && msg.subtype === 'init') {
        out.init = msg; out.sessionId = msg.session_id;
        console.log(`[init] session=${msg.session_id} apiKeySource=${msg.apiKeySource} model=${msg.model} cc=${msg.claude_code_version} perm=${msg.permissionMode}`);
        console.log(`[init] skills=${JSON.stringify(msg.skills)}`);
        console.log(`[init] plugins=${JSON.stringify(msg.plugins)} plugin_errors=${JSON.stringify(msg.plugin_errors ?? [])}`);
        console.log(`[init] mcp_servers=${JSON.stringify(msg.mcp_servers)}`);
        console.log(`[init] tools(mcp)=${JSON.stringify(msg.tools.filter((t: string) => t.startsWith('mcp__talk')))}`);
      } else if (msg.type === 'assistant') {
        for (const b of msg.message.content) {
          if (b.type === 'tool_use') console.log(`[tool_use] ${b.name} ${JSON.stringify(b.input).slice(0, 200)}`);
        }
      } else if (msg.type === 'result') {
        out.cost = msg.total_cost_usd; out.result = msg.result; out.sessionId = msg.session_id;
        console.log(`[result] subtype=${msg.subtype} is_error=${msg.is_error} cost=$${msg.total_cost_usd} turns=${msg.num_turns} dur=${msg.duration_ms}ms`);
        console.log(`[result] text: ${msg.result}`);
        if (msg.permission_denials?.length) console.log(`[result] permission_denials=${JSON.stringify(msg.permission_denials)}`);
      }
    }
  } catch (err: any) {
    console.log(`[ERROR] ${err?.stack ?? err}`);
    log(name, 'error', String(err?.stack ?? err));
  }
  console.log(`[stream] text_delta events=${out.deltas} time_to_first_delta=${out.ttfdMs}ms total=${Date.now() - t0}ms`);
  log(name, 'summary', out);
  return out;
}

const which = process.argv[2] ?? 'all';
const summary: Record<string, unknown> = existsSync(`${LOG}/summary.json`) ? JSON.parse(readFileSync(`${LOG}/summary.json`, 'utf8')) : {};
const save = () => writeFileSync(`${LOG}/summary.json`, JSON.stringify(summary, null, 2));

if (which === 'A' || which === 'all') {
  const r = await run('A', 'Two short tasks. 1) Read ../paper/main.tex and quote the percentage it reports. 2) Call the talk_state tool and report its beat and t. Answer in two lines.');
  summary.A = { sessionId: r.sessionId, cost: r.cost, deltas: r.deltas, ttfdMs: r.ttfdMs, result: r.result };
  save();
}
if (which === 'B' || which === 'all') {
  copyFileSync(resolve(HERE, 'sandbox/title.orig.html'), resolve(TALK, 'scenes/title.html'));
  if (existsSync(resolve(PAPER, 'notes.txt'))) rmSync(resolve(PAPER, 'notes.txt'));
  const r = await run('B', 'Two tasks, use the Edit and Write tools (not Bash). 1) In scenes/title.html change the heading text Hello to "Hello, world". 2) Create ../paper/notes.txt containing the word draft. If a step is denied, just say so; do not retry another way.');
  const html = readFileSync(resolve(TALK, 'scenes/title.html'), 'utf8');
  const paperWrite = existsSync(resolve(PAPER, 'notes.txt'));
  console.log(`[disk] title.html now: ${html.trim()}\n[disk] paper/notes.txt exists: ${paperWrite}`);
  summary.B = { sessionId: r.sessionId, cost: r.cost, deltas: r.deltas, ttfdMs: r.ttfdMs, result: r.result, titleHtml: html, paperNotesExists: paperWrite };
  save();
}
if (which === 'C' || which === 'all') {
  const sid = (summary.B as any)?.sessionId;
  const r = await run('C', 'What did I ask you to change earlier? One sentence.', { resume: sid });
  summary.C = { resumedFrom: sid, sessionId: r.sessionId, cost: r.cost, result: r.result };
  save();
}
if (which === 'D' || which === 'all') {
  const sid = (summary.B as any)?.sessionId;
  const r = await run('D', 'In one sentence: which file did you fail to create earlier, and why?', { resume: sid, forkSession: true });
  summary.D = { forkedFrom: sid, sessionId: r.sessionId, newId: r.sessionId !== sid, cost: r.cost, result: r.result };
  save();
}
if (which === 'E') {
  // Isolation + budget enforcement: no filesystem settings, tiny budget.
  const r = await run('E', 'Say hi in three words.', { settingSources: [], maxBudgetUsd: 0.01 });
  summary.E = { sessionId: r.sessionId, cost: r.cost, result: r.result, skills: r.init?.skills, mcp: r.init?.mcp_servers, apiKeySource: r.init?.apiKeySource };
  save();
}
console.log('\nSUMMARY', JSON.stringify(summary, null, 2));
