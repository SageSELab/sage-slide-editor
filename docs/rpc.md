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

The app starts one sidecar per open talk. A packaged app (`apps/mac/scripts/package.sh`,
docs/packaging.md) runs its own: `Contents/Resources/node/bin/node
Contents/Resources/sidecar/dist/main.mjs` with cwd `Contents/Resources/sidecar`
(`SidecarConfiguration.bundled`), needing nothing outside the app; only a `SAGE_REPO` that
names a real checkout overrides that. In development it is
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
  assigned?: string;         // element op on an address: the id the edit gave the element
}
```

| `op` | `args` |
|---|---|
| `setText` | `{id, html, scene?}`: inner HTML of `#id` |
| `setStyle` | `{id, style: {left?, top?, width?, height?, fontSize?, color?, textAlign?, fontWeight?, fontStyle?, fontFamily?, textDecoration?}, scene?}`: numbers are px (`fontWeight`: unitless), strings one CSS value each (no `;`, braces or line breaks outside quotes; else EditFailed `bad-style`), `null` removes. The text keys take strings only (`fontWeight` also a number) |
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
- `id` may instead be an **element address**, for an element without an id (the canvas's
  drill-down into a card's title): the nearest ancestor with an id, then one `>`-separated
  step per level, each the tag, the first class when it is a plain name, and `:n` for the n-th
  (0-based) sibling with that tag and class: `g1>div.t`, `c4>p.sub:1`, `g1>div.mini>div.ico`.
  The edit gives the element a readable id unique across the talk's scenes (`g1-t`, then
  `g1-t-2`, ...) inserted right after its tag name, applies the op to it, and returns the id
  as `assigned`; one patch, so one undo removes both. An address the source does not have
  (the film generated the element, or the source changed) is EditFailed `stale-path`; one
  whose element has an id is `stale-path` too (use the id). The runtime-text guard applies.
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
| -32010 | EditFailed | The core refused the edit. `data.code` is the core's code (`no-element`, `duplicate-element`, `stale-path`, `bad-address`, `no-end-tag`, `no-beat`, `no-chapter`, `duplicate-beat`, `bad-index`, `bad-prop`, `no-scene`, `invalid-spine`, ...) |
| -32011 | EditConflict | `talk.revert`: a file changed since the inverse was issued. `data.files` |

Fixtures: `talk.edit.request.<op>[-variant].json` (one per op), `talk.edit.response[.variant].json`,
`talk.revert.{request,response}.json`, `talk.built.notification.edit.json`,
`error.edit-failed.json`, `error.edit-conflict.json`.

### Canvas messages (WKScriptMessage, not RPC)

The app injects `packages/engine/src/canvas.js` into the canvas film of every editable
(beat-format) talk, never into a build, a presentation or a published file. There is no edit
mode: while the film is paused the canvas is directly editable, and while it plays the overlay
hides and the engine gets every click and key (canvas.js wraps `T.play`/`T.pause`; a seek
pauses, so scrubbing brings the overlay back at the new time, keeping the selection when the
element still shows). It posts `{kind: 'canvas', ...}` to the `sage` message handler; the app
turns each edit into a `talk.edit`. Numbers are stage px (1920x1080), whole px; `left`/`top`
are the element's CSS left/top; `rect` is `{x, y, w, h}` in the page's client px (the web
view's points), where the app floats its format bar. Every `id` is an element id or, for an
element without an id that the user drilled into (a card's title), its element address
(`g1>div.t`, see talk.edit above); the app passes it to `talk.edit` unchanged.

| `type` | Fields | App does |
|---|---|---|
| `select` | `{id: null}` or `{id, tag, left, top, width, height, fontSize, movable, editable, html, src, rect, text: {bold, italic, underline, color, align, family}}` | shows it in the inspector and the format bar |
| `move` | `{id, left, top}` (drag end, or arrow nudges after 300 ms of quiet) | `setStyle {left, top}` |
| `resize` | `{id, left, top, width, height}` | `setStyle {left, top, width, height}` |
| `text` | `{id, html}` (in-place edit committed and changed; inline `<b>/<i>/<u>` and `<span style="color:…">` from the format bar included) | `setText` |
| `style` | `{id, style}` (a format command for the whole element: `fontWeight`, `fontStyle`, `textDecoration`, `color`, `textAlign`, `fontSize`, `fontFamily`; already applied in the page) | `setStyle` |
| `editing` | `{id}` (the caret went into #id's text) or `{id: null}` (left it) | routes ⌘Z to the text's own undo |
| `format` | `{id, bold, italic, underline, color, range}` (the text selection's formatting while editing) | the format bar's state |
| `rect` | `{id, rect}` (the selection's box on screen changed) | moves the format bar |
| `refused` | `{id, reason: 'block-children'}` | says to click again to select the text inside |

The app drives it with `SageCanvas.enable()`, `disable()`, `select(id, {silent})` (restores
the selection after a reload), `key(name, {shift})` (keys the app's menus catch first),
`format(cmd, value)` (the format bar: inline on a selected range while editing, else the whole
element) and `takeText()` (ends text editing and returns its `text` message instead of posting
it, so the app can save it before an edit of its own), and `adopt(address, id)` (the edit
gave the addressed element the id `assigned`: the page's element takes it and the selection
follows). The app does not reload the canvas for the rebuild after an edit the canvas made
itself (`move`, `resize`, `text`, `style`: already on screen, so no flash and the selection
stays); it reads the selection back with `select(id, {silent})`. Inspector edits, undo, redo,
Claude's and external changes, and a failed edit reload it.
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
| `claude.send` | `{text: string, attachments?: string[], effort?: 'low'\|'medium'\|'high'\|'xhigh'\|'max', model?: string}` | `{turn}` | NoTalkOpen, UnsupportedForKind (legacy), InvalidParams |
| `claude.interrupt` | none | `{interrupted: boolean}` | |
| `claude.reset` | none | `{}` | NoTalkOpen |

- `claude.send` replies at once; the answer streams as notifications and ends with one
  `claude.result`. A send while a request is running is queued by the SDK and answered after it.
  Attachments are absolute or talk-relative paths, listed under the message text.
- `effort` is the Agent SDK's `effort` option (the pane's footer control). It applies to this
  and later requests: a new process starts with it; an idle live one switches with
  `Query.applyFlagSettings({effortLevel})` (no restart, so the conversation and cache stay); a
  change sent while a request runs waits for the next idle send.
- `model` is a Claude model id (`claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5`,
  `claude-haiku-5-5`; any `claude-…` id passes validation). It applies the same way: a new process
  starts with it, an idle live one switches with `Query.setModel` (else it restarts and resumes
  the conversation), and a change sent mid-request waits. The default is `claude-opus-5-5`.
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

## Themes and fonts

A theme (`sage-theme/1`) is the look of a whole talk: light and dark palettes, the display, body
and mono fonts, and an optional type scale. It is shared as a `.talktheme` folder (UTType
`io.sagelab.talktheme`): `theme.json`, a generated `theme.css`, and `fonts/*.woff2`. The schema
is `ThemeSchema` in `packages/core/src/theme.ts`; the skill's `references/themes.md` explains
it for Claude. Its own section of `protocol.ts` (`ThemeMethods`, `ThemeErrorCode`) and of Swift
(`ThemeProtocol.swift`); fixtures in `tests/rpc/themes/`, checked by `themes-protocol.test.ts`
and `ThemeProtocolTests.swift`. Source: `packages/sidecar/src/themes/`.

| Method | Params | Result | Errors |
|---|---|---|---|
| `theme.validate` | `{path}` (a `.talktheme`) or `{theme}` (a theme.json object) | `{ok, problems: string[], theme?, missingFonts: string[]}` | InvalidParams |
| `theme.save` | `{path, theme}` | `{path, theme, fonts: string[]}` | InvalidParams, ThemeInvalid, FontFailed |
| `theme.apply` | `{path}` | `{theme, fonts: string[], edit: EditResult}` | NoTalkOpen, UnsupportedForKind, InvalidParams, ThemeInvalid, FontFailed |
| `theme.extract` | `{path?, id?, name?, description?}` | `{theme, path?, fonts: string[]}` | NoTalkOpen, UnsupportedForKind, InvalidParams, ThemeInvalid |
| `fonts.search` | `{query, category?, limit?}` | `{fonts: FontInfo[], catalog: 'cache'\|'network'\|'stale'}` | InvalidParams, FontFailed |
| `fonts.add` | `{id, weights?, styles?, subset?}` | `{family, fontFamily, files: string[], edit: EditResult}` | NoTalkOpen, UnsupportedForKind, InvalidParams, FontFailed |
| `fonts.list` | none | `{fonts: {family, id, subset, weights, styles, files}[]}` | NoTalkOpen, UnsupportedForKind |

```ts
interface FontInfo { id: string /* Fontsource id */; family: string; category: string; weights: number[];
                     styles: string[]; subsets: string[]; defSubset: string; variable: boolean; license: string }
```

- **Where the theme goes.** `theme.apply` copies the theme's font files to the talk's
  `assets/fonts/` and rewrites two marked blocks at the top of the talk's theme file (`theme` in
  talk.json, default `theme.css`): `/* sage-fonts:begin */ … /* sage-fonts:end */` with one
  `@font-face` per file, then `/* sage-theme:begin {"id","name"} */ … /* sage-theme:end */` with
  `:root` and `.dk` custom properties (`--bg`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--panel`,
  `--a1..3`, `--display`, `--text`, `--mono`, the type scale `--t-xl … --t-eyebrow`,
  `--heading-weight`, `--ls-xl … --ls-s`), the dark passage's `#black` backdrop, and the theme's
  extra `css`. talk.css's type classes read those variables with today's sizes as fallbacks.
  The theme file is inlined after talk.css, so the blocks override the engine's defaults, and
  the talk's own rules below them still win. A talk without the blocks renders exactly as
  before; the SAGE built-in restates talk.css and renders byte-identical frames. Publishing
  inlines the fonts like any `assets/` file.
- **Undo.** `theme.apply` and `fonts.add` write like `talk.edit`: every file is announced to the
  watcher (`source: 'app'`) and written atomically, the talk rebuilds (`talk.built` with
  `trigger: 'edit'`), and `edit.inverse` goes to `talk.revert`. The inverse restores the theme
  file only; copied fonts stay in `assets/fonts/`, unreferenced. `edit.changed` lists the
  fonts written and the theme file. Applying a theme drops the previous theme's `@font-face`
  rules and keeps fonts added on their own with `fonts.add`. Applying the same theme twice
  changes nothing (empty inverse).
- **Fonts.** Google fonts come from the Fontsource API (no key): the catalog
  `https://api.fontsource.org/v1/fonts`, files
  `https://cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-<style>.woff2`,
  saved as `<id>-<subset>-<weight>-<style>.woff2`. Only fonts the catalog reports as `OFL-1.1`
  or `Apache-2.0` are offered. The catalog is cached for a week and files for good in
  `~/Library/Caches/io.sagelab.talk/fonts` (`SAGE_FONT_CACHE`); offline, a stale catalog is
  used. `theme.apply` takes fonts from the package and downloads only missing ones.
  `fonts.add` defaults to weights 400 and 700 (where the family has them), `normal`, `latin`;
  `fontFamily` is the CSS value to use, e.g. `Lora, Georgia, "Times New Roman", serif`.
- **Packages.** `theme.save` writes `theme.json`, the generated `theme.css` (fonts from `fonts/`)
  and `fonts/`, keeping files already there, downloading missing ones and deleting stale ones.
  `theme.extract` reads the open talk's look (talk.css's tokens overridden by the theme file's
  `:root` and `.dk` rules, hand-written or generated); with `path` it saves it, fonts copied
  from `assets/fonts/`. `theme.validate` with a path also lists missing font files.
- The library is the app's: built-ins in the skill (`assets/themes/`, read-only), the user's in
  `~/Library/Application Support/SAGE Talk/Themes` (`SAGE_THEME_LIBRARY` for the sidecar, which
  saves there for Claude's `talk_theme_create`). `theme.validate`, `theme.save` and
  `fonts.search` need no open talk and skip the request queue; the others are queued with edits.
- Claude's tools (`talk_theme_list`, `talk_theme_create`, `talk_theme_apply`,
  `talk_fonts_search`, `talk_fonts_add`) call the same code with author `claude`, so their
  changes are reported as `source: 'claude'`.
- `talkc theme <talk> <theme.talktheme>` applies a package from the command line (no downloads).

| Code | Name | Meaning |
|---|---|---|
| -32030 | ThemeInvalid | The theme does not validate. `data.problems`: `field.path: message` |
| -32031 | FontFailed | A font is not in the catalog (or not embeddable), lacks the weight/style/subset, could not be downloaded, or is not woff2. `data.code`: `unknown-font`, `variant`, `network`, `not-woff2` |

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
