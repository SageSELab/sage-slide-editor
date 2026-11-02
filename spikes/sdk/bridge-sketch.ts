// Minimal options object for the SAGE sidecar's Agent SDK bridge (from the Phase 0 spike,
// SDK 0.3.316 / bundled Claude Code 2.1.316). Not production code: wire `ask` to the
// native approval sheet and `emit` to the NDJSON JSON-RPC channel.
import { query, createSdkMcpServer, tool, type Options, type CanUseTool, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { resolve } from 'node:path';

export interface BridgeCtx {
  talkDir: string;               // absolute; becomes cwd
  materialDirs: string[];        // absolute paper / replication-package folders
  skillPluginDir: string;        // app-bundled copy of academic-talk-film as a local plugin
  resumeSessionId?: string;      // from <talk>/.sage/session.json
  emit: (event: unknown) => void;                       // -> Swift
  ask: (req: { toolName: string; input: Record<string, unknown>; title?: string }) => Promise<boolean>; // approval sheet
  talkState: () => object;       // current beat/time/selection from the canvas
}

const within = (p: string, root: string) => { const a = resolve(p); return a === root || a.startsWith(root + '/'); };
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function bridgeOptions(ctx: BridgeCtx): Options {
  const talkServer = createSdkMcpServer({
    name: 'talk', version: '1.0.0',
    tools: [
      tool('talk_state', 'Current beat, time, selection and display size of the open talk.', {}, async () => ({
        content: [{ type: 'text', text: JSON.stringify(ctx.talkState()) }],
      })),
      // talk_layout, talk_goto, talk_frame, talk_materials, talk_insert_beat, talk_set_notes ...
    ],
  });

  // Called only for tools that are not already allowed (reads inside cwd/additionalDirectories
  // never reach it in permissionMode 'default'; nor do bare names listed in allowedTools).
  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    const fp = (input.file_path ?? input.notebook_path) as string | undefined;
    if (WRITE_TOOLS.has(toolName) && fp && within(fp, ctx.talkDir)) return { behavior: 'allow', updatedInput: input };
    const ok = await ctx.ask({ toolName, input, title: opts.title });
    return ok ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'The user declined this action in SAGE.' };
  };

  const onPostToolUse: HookCallback = async (input) => {
    const i = input as { tool_name: string; tool_input?: { file_path?: string } };
    ctx.emit({ type: 'file_touched', tool: i.tool_name, path: i.tool_input?.file_path });
    return { continue: true };
  };

  return {
    model: 'claude-opus-5-5',
    cwd: ctx.talkDir,
    additionalDirectories: ctx.materialDirs,
    // No ANTHROPIC_API_KEY: the bundled CLI uses the user's Claude Code login (apiKeySource 'none').
    // A Keychain key would be injected here as ANTHROPIC_API_KEY instead.
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'sage-talk-editor/0.1.0' },
    // Isolation: ignore ~/.claude settings (user MCP servers, allow rules that would shadow
    // canUseTool, user skills). The skill comes from the app bundle instead.
    settingSources: [],
    plugins: [{ type: 'local', path: ctx.skillPluginDir }],
    strictMcpConfig: true,       // in the spike claude.ai connectors still appeared with settingSources: []; untested whether this drops them
    mcpServers: { talk: talkServer },
    allowedTools: ['mcp__talk__talk_state'], // read-only app tools: pre-approved (format mcp__<server>__<tool>)
    permissionMode: 'default',
    canUseTool,
    hooks: { PostToolUse: [{ hooks: [onPostToolUse] }] },
    includePartialMessages: true,
    maxBudgetUsd: 0.5,           // checked after each turn, so a run can overshoot it
    ...(ctx.resumeSessionId ? { resume: ctx.resumeSessionId } : {}),
  };
}

export async function* ask(ctx: BridgeCtx, prompt: string) {
  // query() throws after an error result (e.g. error_max_budget_usd), so callers must catch.
  yield* query({ prompt, options: bridgeOptions(ctx) });
}
