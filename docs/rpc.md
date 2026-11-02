# Sidecar RPC (protocol 1)

The Mac app and the Node sidecar talk JSON-RPC 2.0 over the sidecar's stdin and stdout
(PLAN 2, 6.1). This page is the contract. The source of truth is
`packages/sidecar/src/protocol.ts`, mirrored by the Codable structs in
`apps/mac/Sources/SageTalkCore/SidecarClient.swift` (`SidecarProtocol`). Every message shape
has a fixture in `tests/rpc/`, and both test suites decode the same files (PLAN 12.5).

## Wire format

- One JSON object per line, UTF-8, terminated by `\n` (a trailing `\r` is tolerated). Blank
  lines are ignored.
- stdout carries protocol messages only. stderr carries log text (`[sidecar <pid>] level: msg`)
  and never protocol messages. `SAGE_LOG=debug|info|warn|error` sets the level.
- Swift encodes with sorted keys and unescaped slashes. Key order carries no meaning.
- `jsonrpc` is always `"2.0"`. Ids are integers chosen by the requester.
- Either side may send requests. The sidecar sends `app.ask`, `app.state` and `app.goto` for the
  Claude pane (section "Claude"). The Swift client answers them
  through `setRequestHandler`, or with `-32601` when no handler is set.
- Every result is a JSON object, never `null`. Empty results are `{}`.
- Requests are handled one at a time in arrival order, so `talk.open` followed by `talk.layout`
  without waiting is safe. `app.ping` and the `claude.*` methods skip the queue.

| Message | Shape |
|---|---|
| Request | `{"jsonrpc":"2.0","id":1,"method":"talk.open","params":{...}}` (`params` optional) |
| Notification | `{"jsonrpc":"2.0","method":"talk.changed","params":{...}}` |
| Response | `{"jsonrpc":"2.0","id":1,"result":{...}}` |
| Error | `{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"...","data":...}}`. `id` is `null` when the request's id could not be read. |

## Lifecycle

The app starts one sidecar per open talk. In development this is
`node --import tsx src/main.ts`, run with cwd `packages/sidecar`
(`SidecarConfiguration.development`). The app finds the repository through `SAGE_REPO`, else
the path `apps/mac/scripts/bundle.sh` bakes into `Contents/Resources/sage-repo-path`, else the
folders above its executable; and `node` through `SAGE_NODE`, else the baked
`sage-node-path`, else PATH (`SidecarLocator`). `SidecarSupervisor` owns the client: it
restarts a sidecar that exits unexpectedly once (re-opening the talk), reports a second crash
instead of looping, and shuts the sidecar down when the app quits. Legacy decks open without
a sidecar. The sidecar logs `ready` to stderr. It needs no
handshake, but `app.ping` reports the protocol version.

The sidecar exits 0 when any of these happens:

- it receives `app.shutdown` (it replies first)
- its stdin closes (the app quit or crashed)
- it receives SIGTERM

Before exiting it stops the watcher and waits up to 3 s for a build in progress. If the sidecar
dies, the app sees EOF on stdout and then the process exit. `SidecarClient` fails every pending
request with `SidecarError.terminated` and emits `.terminated` on its event stream. `restart()`
launches a new process and re-sends the last `talk.open`.

## Types

```ts
type TalkKind = 'beatFormat' | 'legacy';            // matches TalkFolder.Kind
interface Diagnostic { severity: 'error'|'warning'|'info'; code: string; message: string; file?: string; beat?: string }
interface Hold { index: number /* 1-based */; at: number /* s */; label: string; backup: boolean;
                 beat: string /* 'chapter.beat' */; chapter: string; auto: boolean }
interface BuildResult { ok: boolean; diagnostics: Diagnostic[]; ms: number }
```

`Hold` is a superset of Swift's `Hold` (`index, at, label, backup`). `WireHold.hold` converts.
Paths in notifications and diagnostics are relative to the talk folder and use POSIX
separators.

## Methods (app to sidecar)

| Method | Params | Result | Errors |
|---|---|---|---|
| `app.ping` | none | `{pong: true, protocol: 1, version, pid}` | |
| `app.shutdown` | none | `{}`, then the process exits 0 | |
| `talk.open` | `{path: string /* absolute */, watch?: boolean = true}` | `{kind, root, filmURL, holds?, build?}` | NotATalk, InvalidParams |
| `talk.close` | none | `{}` | |
| `talk.build` | none | `BuildResult` | NoTalkOpen, UnsupportedForKind |
| `talk.layout` | none | `{holds: Hold[], duration: number, diagnostics: Diagnostic[]}` | NoTalkOpen, UnsupportedForKind |
| `talk.watch` | `{enabled: boolean}` | `{watching: boolean}` | NoTalkOpen |

Notes:

- `talk.open` closes any talk already open in this sidecar. `root` has symlinks resolved, so
  `/var/...` becomes `/private/var/...`. `filmURL` is the `file://` URL of `build/index.html`
  for a beatFormat talk, or of `index.html` for a legacy talk. For a beatFormat talk, open runs
  a build, which also emits `talk.built` with `trigger: "open"`. It then returns that build
  under `build` and the hold list under `holds`. Legacy decks are opened read-only: they get no
  build and no layout, but they are watched.
- A compile that fails is `{ok: false, diagnostics}`, not an RPC error. An RPC error means the
  request itself could not be carried out.
- "None" params means the request omits `params` or sends `{}`. Unknown keys are rejected with
  InvalidParams.

## Notifications (sidecar to app)

| Notification | Params |
|---|---|
| `talk.changed` | `{paths: string[], source: 'app' \| 'claude' \| 'external'}` |
| `talk.built` | `{ok, diagnostics, ms, trigger: 'open' \| 'request' \| 'change' \| 'edit', holds?}` |

The folder watcher uses `fs.watch` with `recursive`, which is FSEvents on macOS. It debounces
events for 150 ms (`SAGE_WATCH_DEBOUNCE_MS`). It ignores `build/`, `.sage/`, `node_modules/`,
`.git/`, `.DS_Store`, and editor swap and backup files.

After each batch the sidecar sends:

1. One `talk.changed` for the external paths and one for the app paths. Each is sent only if
   it has paths, so a batch with both kinds produces two notifications.
2. A rebuild, then `talk.built` with `trigger: "change"`. Change-triggered builds coalesce while
   one is queued.

When the build succeeds, `talk.built.holds` carries the fresh hold list. When `talk.json` is
unparsable, the build reports `ok: false` with diagnostic code `invalid-spine`.

**App writes compared with external writes.** Before the sidecar writes a file for the app,
it calls `expectWrite(path, content)` and then writes atomically: a temp file under
`.sage/tmp/`, then a rename (`atomicAppWrite` in `watcher.ts`). The watcher labels a changed
path `app` only when its current content hashes to the announced content, within 5 s. Anything
else is `external`, including a terminal edit that lands right after an app write. Phase 3
edits use this path. Claude's edits arrive through the Agent SDK's Write and Edit tools; the
bridge announces them with author `claude` (the predicted content from `canUseTool`, then the
actual content from its `PostToolUse` hook), so they are reported as `source: "claude"`.

## Error codes

| Code | Name | Meaning |
|---|---|---|
| -32700 | ParseError | The line is not JSON (`id: null`) |
| -32600 | InvalidRequest | Not a JSON-RPC 2.0 message |
| -32601 | MethodNotFound | Unknown method |
| -32602 | InvalidParams | Params failed validation. `data.problems` lists each problem |
| -32603 | InternalError | Unexpected exception. `message` carries the exception text |
| -32000 | NotATalk | The path is missing, or is not a talk folder, or `talk.json` is not sage-talk/1 |
| -32001 | NoTalkOpen | The method needs an open talk |
| -32002 | UnsupportedForKind | For example, `talk.layout` on a legacy deck. `data.kind` gives the kind |
| -32003 | ShuttingDown | Sent after `app.shutdown` |
| -32004 | Timeout | Local only. A peer's own request timed out. It never appears on the wire |

## Fixtures

`tests/rpc/<method>.<kind>[.<variant>].json` holds one message per file. `<kind>` is one of
`request`, `response`, `notification` or `error`. Error fixtures are named
`error.<slug>.json`.

- `packages/sidecar/test/protocol.test.ts` classifies each fixture's envelope and validates its
  payload with the runtime checkers in `protocol.ts`. It also asserts that every method,
  notification and wire error code has a fixture.
- `apps/mac/Tests/SageTalkCoreTests/RPCFixtureTests.swift` decodes each fixture into
  `RPCMessage` and re-encodes it, asserting that the JSON is semantically equal. It then
  round-trips the payload through the typed `SidecarProtocol` struct for its method. This
  catches fields that are renamed, added or missing on either side.

To change the protocol, edit `protocol.ts`, the Swift structs, this page and the fixtures
together.

## Editing (Phase 3)

Every human edit is written to disk at once through `@sage/core`'s source-edit functions
(PLAN 2, autosave rule). The app keeps the undo stack; the sidecar only applies edits and
inverses. Source lives in `packages/sidecar/src/edit.ts`; Swift types in
`apps/mac/Sources/SageTalkCore/EditProtocol.swift`.

| Method | Params | Result | Errors |
|---|---|---|---|
| `talk.edit` | `{op, args}` (below) | `EditResult` | NoTalkOpen, UnsupportedForKind, InvalidParams, EditFailed |
| `talk.revert` | `Inverse` | `EditResult` | NoTalkOpen, UnsupportedForKind, InvalidParams, EditConflict |

```ts
interface WirePatch { file: string; range: [start, end]; newText: string }  // UTF-16 offsets
interface Inverse { patches: WirePatch[]; digests: { [file: string]: string /* sha256 hex */ } }
interface EditResult {
  inverse: Inverse;          // apply with talk.revert to undo (its result's inverse redoes)
  changed: string[];         // talk-relative paths written, sorted
  ok: boolean;               // the rebuild after the write
  diagnostics: Diagnostic[];
  holds?: Hold[];            // after a successful rebuild
  stretch?: { stretched: number; skipped: { file, line, col, call, reason }[] };  // stretchBeat
}
```

| `op` | `args` |
|---|---|
| `setText` | `{id, html, scene?}`: inner HTML of `#id` |
| `setStyle` | `{id, style: {left?, top?, width?, height?, fontSize?}, scene?}`: numbers are px, strings raw CSS, `null` removes |
| `setAttr` | `{id, name, value: string \| true \| null, scene?}` (`true` = bare attribute, `null` removes) |
| `insertBeat` | `{chapter, index, beat: {id, label, notes?, hold?}}`; also adds an empty `Talk.beat` stub |
| `deleteBeat` | `{ref}` (`'chapter.beat'`); also removes its registration |
| `duplicateBeat` | `{ref, newId, label?}` |
| `moveBeat` | `{ref, chapter, index}` (index after removal); across chapters the registration moves and is renamed |
| `setHold` | `{ref, hold: number \| null}` (`null`: auto hold) |
| `setNotes` | `{ref, notes: string \| null}` |
| `stretchBeat` | `{ref, factor}` |
| `setBeat` | `{ref, props: {label?, backup?, dark?}}` (flags: `null` removes) |
| `setChapter` | `{chapter, props: {label?, dark?, private?, backup?}}` |

- Element ops find the one scene file (layers, chapter scenes, public scene) whose source has
  `#id`. `scene` names it explicitly. An id that only exists in generated DOM is EditFailed
  with `data.code: 'no-element'`.
- The edit is computed against the files as they are on disk. Every touched file is announced
  to the watcher and staged under `.sage/tmp/` before any is renamed into place, so the
  watcher reports the paths with `source: 'app'`, and a failure while staging writes nothing.
- The sidecar then rebuilds and sends `talk.built` with `trigger: 'edit'` before replying. The
  watcher's later batch for the same paths is still reported as `talk.changed` (`app`), but
  triggers no second build.
- An edit that changes nothing returns an empty inverse and `changed: []`, and does not build.
- `talk.revert` refuses an inverse when any file in `digests` no longer hashes to its digest
  (EditConflict, `data.files` lists them), and writes nothing. So an undo never overwrites an
  external or Claude edit made since. The app clears its undo stack on any `external` change
  anyway; the digest check covers the race between the two.
- A failed rebuild is `ok: false` with diagnostics; the files are still written (and the
  inverse still applies).

| Code | Name | Meaning |
|---|---|---|
| -32010 | EditFailed | The core refused the edit. `data.code` is the core's code (`no-element`, `duplicate-element`, `no-end-tag`, `no-beat`, `no-chapter`, `duplicate-beat`, `bad-index`, `bad-prop`, `no-scene`, `invalid-spine`, ...) |
| -32011 | EditConflict | `talk.revert`: a file changed since the inverse was issued. `data.files` |

Fixtures: `talk.edit.request.<op>[-variant].json` (one per op), `talk.edit.response[.variant].json`,
`talk.revert.{request,response}.json`, `talk.built.notification.edit.json`,
`error.edit-failed.json`, `error.edit-conflict.json`.

### Canvas messages (WKScriptMessage, not RPC)

In edit mode the app injects `packages/engine/src/canvas.js` into the canvas film (never into
a build, a presentation or a published file). It posts `{kind: 'canvas', ...}` to the `sage`
message handler; the app turns each into a `talk.edit`. Numbers are stage px (1920x1080),
whole px; `left`/`top` are the element's CSS left/top.

| `type` | Fields | App does |
|---|---|---|
| `select` | `{id: null}` or `{id, tag, left, top, width, height, fontSize, movable, editable, html, src}` | shows it in the inspector |
| `move` | `{id, left, top}` (drag end, or arrow nudges after 300 ms of quiet) | `setStyle {left, top}` |
| `resize` | `{id, left, top, width, height}` | `setStyle {left, top, width, height}` |
| `text` | `{id, html}` (in-place edit committed and changed) | `setText` |
| `refused` | `{id, reason: 'block-children'}` | says why the text cannot be edited in place |

The app drives it with `SageCanvas.enable()`, `disable()`, `select(id, {silent})` (restores
the selection after a reload) and `key(name, {shift})` (keys the app's menus catch first).
`packages/engine/test/canvas.test.ts` records these messages in Playwright WebKit.

## Claude (Phase 4)

The chat pane's protocol. It lives in its own section of `protocol.ts` (`ClaudeMethods`,
`ClaudeNotifications`, `AppRequests`) and of Swift (`ClaudeProtocol` in
`ClaudeProtocol.swift`); fixtures are in `tests/rpc/claude/`, checked by
`claude-protocol.test.ts` and `ClaudeProtocolTests.swift`. The bridge is
`packages/sidecar/src/claude/` (PLAN 6).

### Methods (app to sidecar)

| Method | Params | Result | Errors |
|---|---|---|---|
| `claude.send` | `{text: string, attachments?: string[], effort?: 'low'\|'medium'\|'high'\|'xhigh'\|'max'}` | `{turn}` | NoTalkOpen, UnsupportedForKind (legacy), InvalidParams |
| `claude.interrupt` | none | `{interrupted: boolean}` | |
| `claude.reset` | none | `{}` | NoTalkOpen |

- `claude.send` replies at once; the answer streams as notifications and ends with one
  `claude.result`. A send while a request is running is queued by the SDK and answered after it.
  Attachments are absolute or talk-relative paths, listed under the message text.
- `effort` is the Agent SDK's `effort` option (the pane's footer control). It applies to this
  and later requests: a new process starts with it; an idle live one switches with
  `Query.applyFlagSettings({effortLevel})` (no restart, so the conversation and cache stay); a
  change sent while a request runs waits for the next idle send.
- The `claude.*` methods skip the request queue (like `app.ping`), so Stop works while a build
  runs. The bridge is created on the first `claude.*` call and closed by `talk.open`,
  `talk.close` and shutdown.
- `claude.reset` ends the conversation and deletes `.sage/session.json`.

### Notifications (sidecar to app)

| Notification | Params |
|---|---|
| `claude.status` | `{state: 'idle'\|'starting'\|'running'\|'error', sessionId?, model?, message?, skillLoaded?}` |
| `claude.delta` | `{text}`: Markdown to append to the current assistant message |
| `claude.tool` | `{id, name, summary, status: 'running'\|'done'\|'error'\|'denied', detail?, path?, beat?}` |
| `claude.result` | `{cost, totalCost, usage: {inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextTokens}, sessionId, durationMs, turns, error?: {kind: 'budget'\|'max_turns'\|'execution'\|'interrupted'\|'process', message}}` |

- `claude.tool` is sent when a call starts (`running`) and again when it ends, with the same
  `id`. `name` drops the app server prefix (`talk_frame`). `path` is talk-relative, for file
  tools inside the talk. `beat` is the beat a Write or Edit touched, the beat `talk_insert_beat`
  added or `talk_set_notes` changed (or the beat `talk_goto` and `talk_frame` moved to): the canvas
  follows edits unless the user pinned the canvas.
- `talk_insert_beat` and `talk_set_notes` write through `talk.edit` labelled as Claude's, so
  their `talk.changed` has `source: 'claude'`.
- `cost` is this request's spend; `totalCost` is the conversation's spend since the sidecar
  started. `contextTokens` is the context size of the request's last model call.
- `error.kind: 'budget'` is the SDK's `error_max_budget_usd`: the request hit `maxBudgetUsd`
  (default 2 USD, `SAGE_CLAUDE_BUDGET_USD`). `process` means the SDK process failed before it
  produced a result.

### Requests (sidecar to app)

| Request | Params | Result |
|---|---|---|
| `app.ask` | `{tool, title, summary, path?, reason, scope}` | `{decision: 'allow'\|'allowTalk'\|'deny'}` |
| `app.state` | none | `{t, playing, hold?, beat?, label?, selection: string[], pinned}` |
| `app.goto` | `{t, beat?}` | `{t}` |

- `app.ask` is the approval card behind `canUseTool`. `scope` describes what `allowTalk` saves
  in `.sage/permissions.json` (for example `Bash commands starting with "npx talkc"`). It waits
  up to 30 minutes; an interrupt or a timeout counts as deny.
- `app.state` answers `talk_state`; `app.goto` moves the canvas for `talk_goto` and `talk_frame`.
  Both time out after 15 s.

### Permission policy (`claude/policy.ts`)

| Call | Outcome |
|---|---|
| Read, Glob, Grep, LS inside the talk or a materials folder | allowed |
| Write, Edit, MultiEdit, NotebookEdit inside the talk | allowed, announced to the watcher as `claude` |
| `mcp__talk__*`, Skill, ToolSearch, TodoWrite | allowed |
| AskUserQuestion | denied (Claude asks in its reply) |
| anything else: Bash, writes or reads elsewhere, web, subagents | `app.ask`, unless a saved rule matches |

Saved rules: Bash by its first two words (commands with shell metacharacters always ask), file
tools by folder, WebFetch by host, other tools by name.

## Publish and export (Phase 5)

PLAN 5.6 and the skill's `references/publishing.md`. Its own section of `protocol.ts`
(`PublishMethods`, `PublishNotifications`, `PublishErrorCode`) and of Swift
(`PublishProtocol.swift`); fixtures in `tests/rpc/publish/`, checked by
`publish-protocol.test.ts` and `PublishProtocolTests.swift`. Source: `packages/sidecar/src/publish/`.
All four methods run in the request queue, one at a time with builds and edits.

| Method | Params | Result | Errors |
|---|---|---|---|
| `talk.publish` | `{slug?}` | `{path, bytes, holds, duration, warnings: Diagnostic[]}` | NoTalkOpen, UnsupportedForKind, InvalidParams, PublishFailed |
| `talk.export` | `{kind: 'png'\|'pdf', holds?: 'all'\|number[], around?: number}` | `{kind, dir, files, frames, width, height, ms, errors}` | NoTalkOpen, UnsupportedForKind, InvalidParams, PublishFailed |
| `site.stage` | `{site: 'personal'\|'lab', repo, slug, paperEntry?}` | `{site, repo, url, files: {path, status}[], diff, notes}` | NoTalkOpen, InvalidParams, NotPublished, SiteFailed |
| `site.commit` | `{repo, paths, message}` | `{commit, summary}` | InvalidParams, SiteFailed |
| `talk.qr` | `{paper?, slides?, package?}` (http(s) URLs, at least one) | `{files}` | NoTalkOpen, UnsupportedForKind, InvalidParams |

| Notification | Params |
|---|---|
| `talk.exportProgress` | `{kind, done, total}`, after each frame of a `talk.export` |

- `talk.publish` is `talkc publish`: `<talk>/build/public/<slug>.html`, slug default the talk
  folder's name, slugified. `holds` and `duration` are the public film's (private chapters out,
  end card in). `warnings` are the core's non-fatal diagnostics, among them
  `publish-private-text` (a private chapter or beat label, or the opening of a speaker note, in
  a file the public build ships) and `publish-private-leak` (the same, found only in the
  finished page; text the engine itself carries is not counted). A failed cut is PublishFailed
  with `data.diagnostics`.
- `talk.export` rebuilds first (PublishFailed if the build fails), then renders
  `build/index.html` (backups included) in headless Chromium through `@sage/render`. `holds` are
  1-based hold numbers; `around` adds frames that many seconds before and after each hold.
  PNG: `build/export/png/hold-NN[-before|-after].png` plus `manifest.json`; the folder is emptied
  first. PDF: `build/export/<talk>.pdf`, one 1920x1080-point page per frame, assembled with
  pdf-lib. A hold number outside the film is InvalidParams.
- `site.stage` works in the repository at `repo`, which must be a working tree's top folder (no
  default: the app passes the path from its settings). It copies `build/public/<slug>.html` to
  `public/talks/<slug>.html`, adds the talk to `src/content/talks.yaml` (or gives its entry a
  `slides` link), and with `paperEntry` (an `id`, else an exact title) adds the `slides` link
  to that paper in `src/content/publications.yaml`. YAML edits are splices at the nodes' source
  ranges (`yaml`'s Document API), so comments, quoting and blank lines elsewhere are kept byte
  for byte. A YAML file whose header says it is generated (the lab site's) is not edited;
  `notes` says so, as it does for a paper that is not found. Nothing is staged or committed.
  `files` lists every file looked at with its status against HEAD; `diff` is the YAML diff,
  preceded by one line for the HTML file. Running it again changes nothing.
- `site.commit` commits exactly `paths` (other staged changes stay staged), with `message`. The
  app sends it only when the user clicks Commit. Nothing in the sidecar pushes.
- `talk.qr` writes `assets/qr-<name>.svg` for each URL given (the `qrcode` package, pure JS:
  SVG, margin 0, error correction M, as the skill's recipe), as app writes, so the watcher
  reports them with `source: 'app'` and the talk rebuilds.
- Dependencies: `yaml` (its Document API gives source ranges and keeps comments), `pdf-lib`
  (pure-JS PDF assembly; Chromium's `page.pdf()` would print the page's layout rather than the
  rendered frame), `qrcode`.

| Code | Name | Meaning |
|---|---|---|
| -32020 | PublishFailed | The public cut or the build failed. `data.diagnostics` |
| -32021 | NotPublished | `site.stage`: `build/public/<slug>.html` does not exist. `data.path` |
| -32022 | SiteFailed | Not a repository's top folder, a version-control command failed, a YAML file does not parse, nothing to commit |

## Setup (Phase 6)

The onboarding sheet's checks and the render browser download (docs/packaging.md). Source:
the Setup section of `protocol.ts`, `src/setup.ts` and `src/runtime.ts`; Swift types in
`SetupProtocol.swift`; fixtures in `tests/rpc/setup/`, checked by `setup.test.ts` and
`SetupProtocolTests.swift`. The `setup.*` methods skip the request queue and need no open talk.

| Method | Params | Result |
|---|---|---|
| `setup.check` | `{auth?: boolean}` | `SetupCheckResult` |
| `setup.installBrowser` | none | `{ok, message?, browser: BrowserStatus}` |

```ts
interface BrowserStatus { state: 'chrome' | 'installed' | 'missing'; path?: string; canInstall: boolean }
interface AuthStatus { state: 'login' | 'apiKey' | 'external' | 'none' | 'unknown';
                       account?, organization?, plan?, source?, provider?, message?: string }
interface SetupCheckResult {
  mode: 'bundled' | 'development'; version: string /* git describe, or 'development' */;
  node: string; nodePath: string;       // the node running the sidecar
  problems: string[];                   // missing engine / plugin / skill / talkc files
  claudeBinary?: string;                // the Agent SDK's native claude, when installed
  talkc: string;                        // bin/talkc in the app (first on Claude's PATH)
  browser: BrowserStatus; auth?: AuthStatus;
}
```

| Notification | Params |
|---|---|
| `setup.progress` | `{task: 'browser', fraction: 0...1, message}` |

- `auth: true` asks the Claude CLI for `accountInfo()` through the Agent SDK: `query()` is
  started in streaming-input mode with an input stream that never yields, so the CLI only does
  its local initialize handshake and no prompt or model call is ever sent. It takes a few
  seconds (the CLI starts). `unknown` means the CLI could not be asked (it is reported, not
  treated as logged out).
- The browser is an installed Google Chrome when there is one, else Playwright's
  chromium-headless-shell in `~/Library/Application Support/io.sagelab.talk/ms-playwright`.
  In development the report is Playwright's own Chromium (what the tests use) and
  `setup.installBrowser` refuses (`canInstall: false`).
- `setup.installBrowser` runs `playwright install chromium --only-shell` with the bundled
  node. A second call while one runs returns the same result.
