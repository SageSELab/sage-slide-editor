# Phase 0 SDK spike: findings

Run 2026-11-01 on macOS arm64, Node 24, with `ANTHROPIC_API_KEY` unset (`env -u` plus a
`delete` in the script). Script: `spike.ts` (`npx tsx spike.ts A|B|C|D|E`). Raw logs are in
`logs/*.ndjson`, with a summary in `logs/summary.json`. Options sketch: `bridge-sketch.ts`
(type-checks with `tsc --strict`).

| Run | What | Result | `total_cost_usd` |
|---|---|---|---|
| A | init, skills, plugin, stream, read the paper, in-process tool | success, 4 turns | 0.2381 |
| B | Edit inside the talk, Write into the paper (denied), hooks | success, 4 turns | 0.1460 |
| C | `resume` B and ask for recall | success, 1 turn | 0.1614 |
| D | `resume` B with `forkSession: true` | success, 1 turn | 0.1697 |
| E | `settingSources: []` with `maxBudgetUsd: 0.01` | `error_max_budget_usd` | 0.0416 |
| **Total** | | | **0.757 USD** |

A single short turn costs about 0.15 USD on Opus 5.5 because the Claude Code system prompt
and tool definitions are large. Expect real editing turns to cost 0.2 to 1 USD.

## 10. Versions and binary: PASS
- `@anthropic-ai/claude-agent-sdk` **0.3.316**. In init: `claude_code_version: "2.1.316"`.
- The optional dependency `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.316` installed
  under plain `npm install`. It holds a native `claude` binary of 310 MB. No postinstall
  script was needed (npm's allow-scripts warning only concerned esbuild, which tsx uses).
- Implication: the bundled sidecar carries a native binary of about 300 MB. As an alternative,
  `pathToClaudeCodeExecutable` can point at an installed `claude`.

## 1. Auth with no API key: PASS
- Every run's init reported `apiKeySource: "none"`, `model: "claude-opus-5-5"`,
  `permissionMode: "default"`, and the API calls succeeded. According to the type docs,
  `'none'` means "no API key in use, e.g. claude.ai OAuth login". The CLI reused the user's
  stored Claude Code login. No error occurred and no key was set.
- Implication: login reuse works for a personal app on Kevin's Mac with no key handling.
  This does not change the policy risk in PLAN 6.4. Before distributing the app, ask
  Anthropic, or require an API key, which goes in `env.ANTHROPIC_API_KEY` from the Keychain.
- A side effect of the login: the claude.ai connectors (`claude.ai Dropbox`,
  `claude.ai Microsoft 365`, `claude.ai Claude Docs`, all `source: "claudeai"`) appear in
  `mcp_servers`, **even with `settingSources: []`** (run E).

## 2. Skills and plugins: PASS (with a caveat)
- Default `settingSources` (run A): `skills` includes
  **`"anthropic-skills:academic-talk-film"`** (namespaced, because the skill comes from the
  synced `anthropic-skills` bucket), together with `moran-paper-voice`, `pdf`, `pptx`, and
  others. The user skills `lecture-to-youtube` and `update-cv` are listed as well.
- Local plugin `plugins: [{type:'local', path:<abs>/plugin}]` loaded. Init excerpt:
  `plugins: [{"name":"sage-spike-plugin","path":".../spikes/sdk/plugin","source":"sage-spike-plugin@inline","version":"0.0.1"}, cc-plugin-sec-default, cc-plugin-agents-md, cc-plugin-telemetry, cc-plugin-plugin-authoring (builtin)]`.
  Its skill is listed as **`"sage-spike-plugin:hello-skill"`**, and `plugin_errors` was empty.
- With `settingSources: []` (run E), the `~/.claude` skills disappear, including
  academic-talk-film. The plugin skill and the built-in skills remain.
- Implication: the app should ship academic-talk-film as a bundled local plugin
  (`<plugin>:academic-talk-film`) and not depend on the user's synced copy. With default
  settings, both copies would appear under different names. To pin the visible set, use
  `skills: ['sage-talk:academic-talk-film', ...]`; this was not tested live. PLAN 12.7's check
  "init must list `academic-talk-film`" should match by suffix, because names are namespaced.

## 3. Streaming: PASS
- With `includePartialMessages: true`, messages with `type:'stream_event'` and
  `event.type === 'content_block_delta'` and `event.delta.type === 'text_delta'` arrived.
  Counts per run: A 7, B 21, C 10, D 6, E 2.
- Time from calling `query()` to the first text delta:
  - A, a cold first spawn with two tool turns before any text: 11.9 s. Init came about 5 s
    after the call, and the text came 7.0 s after init.
  - B: 7.8 s.
  - C and D (one turn, no tools): 2.6 s and 2.5 s.
- Deltas are coarse (several words each). Without tools, the first text appears about 2.5 s
  after the call. Process spawn adds about 1 s when warm and about 5 s when cold (A also
  connected the user's MCP servers). Implication: keep one long-lived `query()` per open talk
  (streaming-input mode) rather than spawning one per message.

## 4. File access through `additionalDirectories`: PASS
- Run A: `Read {"file_path":".../sandbox/paper/main.tex"}` ran with no `canUseTool` call
  (none logged in A) and no prompt. Answer:
  `1) main.tex says: "In our study, 67\% of patches did not compile."`
- Reads inside `cwd` and `additionalDirectories` are auto-allowed in `permissionMode: 'default'`.

## 5. Hooks: PASS for PostToolUse, NOT OBSERVED for FileChanged
- `PostToolUse` fired for every tool: Read, ToolSearch, `mcp__talk__talk_state`, and Edit.
  Payload for the Edit (run B), abridged:
  ```json
  {"hook_event_name":"PostToolUse","tool_name":"Edit","session_id":"18d7382b-...","permission_mode":"default",
   "tool_input":{"file_path":".../sandbox/talk/scenes/title.html","old_string":"<h1 id=\"t-h\">Hello</h1>","new_string":"<h1 id=\"t-h\">Hello, world</h1>","replace_all":false},
   "tool_response":{"filePath":"...","structuredPatch":[{"oldStart":1,"lines":[" <section ...>","-  <h1 id=\"t-h\">Hello</h1>","+  <h1 id=\"t-h\">Hello, world</h1>"," </section>"]}],"userModified":false},
   "tool_use_id":"toolu_01DbT5...","duration_ms":4,"transcript_path":"~/.claude/projects/<cwd-slug>/<session>.jsonl"}
  ```
- On disk afterwards: `<h1 id="t-h">Hello, world</h1>`.
- `FileChanged` exists in `HOOK_EVENTS` (`{file_path, event: 'change'|'add'|'unlink'}`). It was
  registered but **never fired**. According to the types, its watch list comes from
  `watchPaths` returned by a `SessionStart`/`CwdChanged`/`FileChanged` hook output, so it is
  not a general watcher by default. `PermissionDenied` also did not fire for a `canUseTool`
  deny. Implication: use `PostToolUse` (matcher `Write|Edit|MultiEdit|NotebookEdit|Bash`)
  together with the sidecar's own fs watcher, as PLAN 6.1 already says. Note that
  `tool_response.structuredPatch` lets the app highlight the changed lines without diffing.

## 6. Permissions: PASS
- `permissionMode: 'default'` with `canUseTool`.
- Run B: Claude tried the paper Write first, and it was denied. What `canUseTool` received:
  ```json
  {"toolName":"Write","input":{"file_path":".../sandbox/paper/notes.txt","content":"draft\n"},
   "displayName":"Write","suggestions":[{"type":"setMode","mode":"acceptEdits","destination":"session"}]}
  ```
  (`blockedPath`, `decisionReason`, and `title` were undefined.) The deny message was passed
  to the model verbatim. The `result` message carried
  `permission_denials:[{"tool_name":"Write","tool_use_id":"toolu_01Gi...","tool_input":{...}}]`,
  and `sandbox/paper/notes.txt` was not created. The Edit inside the talk went through
  `canUseTool` too and was allowed.
- Surprise: the SDK warns at startup
  `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for: mcp__talk__talk_state. Bare allowedTools entries auto-approve the whole tool ... Allow rules from settings files can also shadow the callback but are not visible here.`
  Allow rules in `~/.claude/settings.json` would therefore silently bypass the approval sheet
  under the default `settingSources`. This is a further reason to use `settingSources: []`.

## 7. In-process tools: PASS
- `createSdkMcpServer({name:'talk', tools:[tool('talk_state', desc, {}, handler)]})`, passed as
  `mcpServers: { talk: server }`. Init: `{"name":"talk","status":"connected","source":"sdk"}`,
  `tools` contains `"mcp__talk__talk_state"`.
- The `allowedTools` format that worked is **`mcp__talk__talk_state`** (`mcp__<serverKey>__<tool>`).
  Answer: `2) talk_state: beat = \`title\`, t = 5.`
- Surprise: the model first called `ToolSearch {"query":"select:mcp__talk__talk_state"}`,
  which means MCP tools are deferred by default. This costs an extra turn. For the app's core
  tools, consider mentioning them in the system prompt append, or check whether the SDK has a
  per-tool "always load" setting (not tested).

## 8. Sessions: PASS
- C: `resume: "18d7382b-..."` kept the same `session_id` and answered: "You asked me to change
  the heading in `scenes/title.html` from "Hello" to "Hello, world" (and to create
  `../paper/notes.txt` ..., which was blocked)."
- D: `resume` + `forkSession: true` gave a **new** `session_id` (`f956d4a4-...`) that still had
  B's history ("I couldn't create `../paper/notes.txt` because the SAGE spike policy blocks
  writes...").
- Sessions persist under `~/.claude/projects/<cwd-slug>/<id>.jsonl`. Note that the slug
  depends on `cwd`, so moving a talk folder may break `resume`. Store the id in
  `.sage/session.json`, as PLAN says, and test resuming after a move.

## 9. Cost and budget: PASS (with a caveat)
- The option is `maxBudgetUsd` (0.5 per run here). All runs used `model: 'claude-opus-5-5'`,
  which was accepted, and init echoed it. Costs are listed in the table above.
- Run E (`maxBudgetUsd: 0.01`): `result.subtype: "error_max_budget_usd"`, `is_error: true`,
  `total_cost_usd: 0.0416`. **The cap is checked after a turn, so a turn can overshoot it.**
  After the result message, the iterator also **throws**
  `Error: Claude Code returned an error result: Reached maximum budget ($0.01)`. The bridge
  must catch this.
- `modelUsage` also showed small `claude-haiku-5-5` calls (housekeeping), which are included
  in the cost.

## Recommended sidecar options (see `bridge-sketch.ts`)
```ts
{ model: 'claude-opus-5-5', cwd: talkDir, additionalDirectories: [paperDir, pkgDir],
  env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'sage-talk-editor/x.y' }, // no API key -> login
  settingSources: [], plugins: [{ type: 'local', path: bundledSkillPlugin }],
  mcpServers: { talk: createSdkMcpServer({...}) }, allowedTools: ['mcp__talk__talk_state', ...read-only tools],
  permissionMode: 'default', canUseTool, hooks: { PostToolUse: [{ hooks: [onEdit] }] },
  includePartialMessages: true, maxBudgetUsd: 0.5, resume: sessionId }
```
Open items for Phase 4:
- Does `strictMcpConfig: true` drop the claude.ai connectors?
- Does `skills: [...]` restrict the listing as expected?
- Can a long-lived streaming-input `query()` avoid the per-message spawn cost?
- What does "Allow for this talk" look like through `updatedPermissions` with `destination: 'session'`?
