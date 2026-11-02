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
- Either side may send requests. In protocol 1 only the app does. From Phase 4 the sidecar also
  sends requests to the app (approval sheet, frame capture). The Swift client answers them
  through `setRequestHandler`, or with `-32601` when no handler is set.
- Every result is a JSON object, never `null`. Empty results are `{}`.
- Requests are handled one at a time in arrival order, so `talk.open` followed by `talk.layout`
  without waiting is safe. `app.ping` skips the queue.

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
| `talk.changed` | `{paths: string[], source: 'app' \| 'external'}` |
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
edits use this path. Phase 4 Claude edits arrive through the Agent SDK's Edit tool and are
`external` to the watcher. The bridge can label them separately from its `PostToolUse` hook.

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

## Phase 4 additions (not in protocol 1)

- Methods: `claude.send {text, attachments}`, `claude.interrupt`, `claude.respond {requestId,
  allow, scope}`.
- Notifications: `claude.delta` (text and tool-input deltas from `includePartialMessages`),
  `claude.tool` (tool rows, including `PostToolUse` edits with `structuredPatch`),
  `claude.result` (cost, `permission_denials`, errors such as `error_max_budget_usd`).
- Sidecar-to-app requests: `app.ask` (the approval sheet behind `canUseTool`), `app.state`
  (for `talk_state`), `app.frame` and `app.goto` (for `talk_frame` and `talk_goto`).
