# Packaging (Phase 6)

`apps/mac/scripts/package.sh` builds `apps/mac/build/SAGE Talk.app`: a self-contained,
ad-hoc-signed, hardened-runtime app that runs without this repository, without Node on the
Mac, and without `pnpm install`. `apps/mac/scripts/package-smoke.sh` proves that.
`apps/mac/scripts/notarize.sh` holds the Developer ID and notarization steps (untested: no
certificate or notary credentials exist here).

```sh
corepack pnpm install
bash apps/mac/scripts/package.sh          # -> apps/mac/build/SAGE Talk.app (+ build/package-size.txt)
bash apps/mac/scripts/package-smoke.sh    # copies it to a temp dir and runs it there
```

The development app (`scripts/bundle.sh`, `scripts/selftest.sh`) is unchanged: it still runs
the sidecar from this checkout with `node --import tsx`.

## Layout

```
SAGE Talk.app/Contents/
  Info.plist                 io.sagelab.talk, version from git describe, document types
  PkgInfo
  MacOS/SageTalk             SwiftPM release build, debug symbols stripped
  Resources/
    AppIcon.icns             packaging/AppIcon.svg, rendered by packaging/make-icon.swift
    canvas.js                the editing overlay (packages/engine/src/canvas.js)
    node/bin/node            Node 24.22.2 darwin-arm64 (official tarball), re-signed ad hoc
    node/LICENSE
    sidecar/
      manifest.json          {format: "sage-sidecar/1", version, node, agentSdk, playwright, chromiumRevision}
      dist/main.mjs          the sidecar: src/main.ts + @sage/core + @sage/render + zod, parse5, linkedom, acorn
      dist/talkc.mjs         @sage/core's CLI
      bin/talkc              sh shim: ../node/bin/node dist/talkc.mjs "$@"
      engine/                packages/engine/src (talk.js, talk.css, edit.js, talk-layout.js, font, ...)
      plugin/                packages/sidecar/plugin with the skill symlink resolved (evals/ left out)
      node_modules/
        @anthropic-ai/claude-agent-sdk/              sdk.mjs + package.json (sdk.mjs imports only Node built-ins)
        @anthropic-ai/claude-agent-sdk-darwin-arm64/ the native claude CLI, Anthropic's signature intact
        playwright-core/                             without types/
```

**What is bundled and what is not.** `packages/sidecar/scripts/bundle.ts` runs esbuild on two
entries. Only two packages stay external, because bundling them would break how they find
their own files:

- the Agent SDK, which resolves its native `claude` binary as a sibling package
  (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>`) relative to `sdk.mjs`;
- Playwright, which reads `browsers.json` and its injected scripts from its package folder and
  runs its own CLI to install browsers. `playwright` is mapped to `playwright-core` (the same
  API without the test runner).

esbuild hoists the external `import 'playwright-core'` to the top of both bundles, so it
loads at startup (it is in the app, so this costs only load time). @sage/core's `cli.ts` runs
`main()` when `argv[1]` is its own file; inside a bundle every module shares the bundle's
`import.meta.url`, so `bundle.ts` strips that guard (core's index re-exports the CLI, and the
guard would otherwise have run talkc inside the sidecar). `src/talkc.ts` calls `main()` itself.

**How the sidecar finds its files** (`packages/sidecar/src/runtime.ts`, tested by
`test/runtime.test.ts`). The entry module (`src/main.ts` or `dist/main.mjs`) sits one folder
below the sidecar root. A root with `manifest.json` (format `sage-sidecar/1`) is the bundled
layout above; otherwise it is `packages/sidecar` in the repository. `runtime-env.ts`, imported
first by both entries, exports a bundled runtime into the process environment, which the
Claude CLI, its Bash and `talkc` inherit:

| Variable | Bundled value | Read by |
|---|---|---|
| `SAGE_ENGINE_DIR` | `sidecar/engine` | `@sage/core` compile and publish (`defaultEngineDir()`) |
| `SAGE_PLUGIN_DIR` | `sidecar/plugin` | the Claude bridge (`plugins: [{type: 'local'}]`) |
| `PATH` | `sidecar/bin` prepended | Claude's Bash finds `talkc` |
| `SAGE_NODE` | the bundled node | |
| `SAGE_RENDER_CHANNEL` / `SAGE_RENDER_EXECUTABLE` | `chrome`, or a Chrome path | `@sage/render` (`browserLaunchOptions()`) |
| `PLAYWRIGHT_BROWSERS_PATH` | `~/Library/Application Support/io.sagelab.talk/ms-playwright` | Playwright |

Values already set win (except the browser pair, which follows the browser choice). In
development nothing is exported: the repository behaves exactly as before.

**How the app finds the sidecar** (`SidecarLocator`, `SidecarConfiguration.bundled`). When
`Contents/Resources` holds an executable `node/bin/node`, `sidecar/dist/main.mjs` and
`sidecar/manifest.json`, the app runs that, with cwd `Resources/sidecar`. Only a `SAGE_REPO`
naming a real checkout overrides it (a developer running a packaged app against the repo). A
packaged app has no `sage-repo-path` or `sage-node-path`. The editing overlay comes from
`Resources/canvas.js` in that mode.

## Sizes

Measured on this build (`build/package-size.txt`):

| Part | Size |
|---|---|
| **SAGE Talk.app** | **435 MB** |
| claude, the Agent SDK's native CLI | 296 MB (68 %) |
| node 24.22.2 | 116 MB (27 %) |
| playwright-core | 11.4 MB |
| sidecar bundle (main.mjs + talkc.mjs) | 5.5 MB |
| Swift executable (stripped) | 2.5 MB |
| sdk.mjs | 1.3 MB |
| plugin (skill) | 0.5 MB |
| engine | 0.1 MB |

Two binaries are 95 % of the app. Ways down, not taken yet: point the SDK at a `claude` the
user already has (`pathToClaudeCodeExecutable`, the Phase 0 finding) and drop the 296 MB
copy, at the cost of depending on the user's CLI version; or build Node as a single
executable application, which saves nothing since the Node binary dominates either way. A zip
of the app (`ditto -c -k`) is 175 MB, 41 % (Mach-O compresses well).

## The render browser

`talk_frame` (Claude looking at frames), `talkc shoot` and `talkc validate --render` need a
Chromium; the app's own canvas, thumbnails and presenting use WebKit and need none. Playwright's
Chromium is not bundled (it would add about 250 MB, or 100 MB for the headless shell, for a
feature some users never touch). The sidecar chooses (`chooseBrowser`):

1. **Google Chrome, when installed** (`/Applications`, launched with Playwright's
   `channel: 'chrome'`; `~/Applications`, by path). Preferred: most Macs that will run this have
   it, it costs nothing to download, and Google keeps it updated. The cost is that frames are
   not pixel-identical to the golden frames, which are pinned to Playwright's Chromium build.
   That matters for the repository's tests (development mode keeps Playwright's Chromium), not
   for Claude's previews or exports.
2. **Playwright's chromium-headless-shell**, downloaded on first use into
   `~/Library/Application Support/io.sagelab.talk/ms-playwright` by Playwright's own
   installer (`playwright install chromium --only-shell`, run with the bundled node). The
   onboarding sheet offers it, with progress (`setup.installBrowser`, `setup.progress`). It is
   complete when `chromium_headless_shell-<revision>/INSTALLATION_COMPLETE` exists, with the
   revision from playwright-core's `browsers.json` (recorded in the manifest).
3. Otherwise missing: the sheet says so and offers the download.

`SAGE_RENDER_BROWSER=chromium` skips Chrome (to use or test the download path);
`SAGE_RENDER_BROWSER=chrome` insists on it. The download itself has not been run here (the
rules for this build allowed downloading only npm packages and the Node tarball); its
progress parsing and failure reporting are tested with a stand-in installer
(`test/setup.test.ts`).

## Info.plist

`CFBundleIdentifier` `io.sagelab.talk`; `CFBundleShortVersionString` from the latest
`vX.Y.Z` tag in `git describe` (0.6.0 while there is none); `CFBundleVersion` the commit
count; the full `git describe` in `SAGEGitDescribe` and in the sidecar manifest (shown on the
onboarding sheet); category `public.app-category.productivity`; minimum macOS 15.0 (the
SwiftPM platform); arm64 only. Document types: folders (a talk is a folder with `talk.json`,
or a legacy `index.html` deck) and `public.json` (opening a `talk.json` opens its folder),
both rank Alternate so the app never claims folders or JSON by default; they make Open With
and drops on the Dock icon work (`application(_:open:)`).

## Signing and entitlements

`package.sh` signs ad hoc (`codesign --sign -`), innermost first, all with the hardened
runtime (`--options runtime`):

- **`Resources/node/bin/node`**, with `packaging/node.entitlements`:
  `com.apple.security.cs.allow-jit` only. V8 generates machine code in `MAP_JIT` memory;
  re-signed with the hardened runtime and no entitlements, Node 24.22.2 aborts at startup with
  `Fatal process out of memory: Failed to reserve virtual memory for CodeRange` (tried while
  writing this). With `allow-jit` alone a JIT-heavy loop runs, so
  `allow-unsigned-executable-memory` (a broader exception older V8 builds needed) is not
  requested. The sidecar loads no native addons, so library validation stays on. The official
  binary is signed by the Node.js Foundation with six entitlements, including
  `get-task-allow` and `disable-library-validation`; re-signing replaces them with this one.
  `package.sh` runs a JIT probe on the signed binary and fails the build if it cannot.
- **the `claude` binary** keeps Anthropic's Developer ID signature (hardened runtime, secure
  timestamp); `package.sh` only verifies it. Re-signing would discard Anthropic's identity and
  its own entitlements.
- **the app**, with `packaging/SageTalk.entitlements`: empty. WKWebView's JavaScript JIT runs
  in WebKit's WebContent process, which has Apple's entitlements, not in the app process; the
  app is not sandboxed (PLAN 13.3: it spawns Node and reads arbitrary paper folders); it loads
  no third-party libraries.

`codesign --verify --strict --deep` passes on the result. Ad hoc signatures are enough to run
on the Mac that built the app; another Mac's Gatekeeper rejects them once the app carries a
quarantine attribute (downloaded or AirDropped), which is what Developer ID and notarization
fix.

## Developer ID and notarization (untested)

Not run: there is no Developer ID certificate or notary profile here. `scripts/notarize.sh`
is the procedure as written, for when there is:

1. Once: create a *Developer ID Application* certificate in the Apple Developer account and
   install it in the login keychain; make an app-specific password and store a notary profile:
   `xcrun notarytool store-credentials sage-notary --apple-id … --team-id … --password …`.
2. `bash apps/mac/scripts/package.sh`, then
   `SAGE_SIGN_IDENTITY="Developer ID Application: … (TEAMID)" SAGE_NOTARY_PROFILE=sage-notary bash apps/mac/scripts/notarize.sh`, which
   - verifies Anthropic's signature on `claude` (notarization accepts nested code signed by
     another team, as long as it has the hardened runtime and a secure timestamp, which it has);
   - re-signs `node` with `--timestamp --options runtime --entitlements packaging/node.entitlements`;
   - signs any other Mach-O it finds (none today), then the app, with the same flags and
     `packaging/SageTalk.entitlements`;
   - zips with `ditto -c -k --keepParent`, submits with `xcrun notarytool submit --wait`, and
     on rejection prints `notarytool log`;
   - staples (`xcrun stapler staple`), validates, re-zips, and checks with
     `spctl --assess --type execute`.

Expected trouble spots: the notary service scans every Mach-O, including the 296 MB `claude`;
if Anthropic's binary were ever unsigned or lacked a timestamp, it would have to be re-signed
with our identity and its entitlements (`codesign -d --entitlements -` shows them) carried
over. Node in `Contents/Resources` rather than `Contents/MacOS` or `Contents/Helpers` is
legal for signing but unusual; if notarization or Gatekeeper ever objects, move it to
`Contents/Helpers/node` and change `SidecarConfiguration.Bundled.node`.

## Onboarding

On the first launch on a Mac (`UserDefaults` `onboardingCompleted.v1`), and from
*SAGE Talk ▸ Setup Assistant…*, a sheet checks, using a short-lived sidecar of its own:

| Check | How |
|---|---|
| Node runtime | the located configuration's node exists and is executable; the version comes back from the sidecar |
| Sidecar | `setup.check` answers; `problems` lists missing engine, plugin, skill or talkc files |
| Claude | `setup.check {auth: true}`: the Agent SDK's `accountInfo()`, from a CLI started with an input stream that never yields a message. The CLI does its local initialize handshake and answers; no prompt is sent and no model is called. login / API key / cloud provider / none / unknown |
| Render browser | Chrome, downloaded Chromium, or missing with a *Download Chromium* button and a progress bar |

It also shows the caveat from PLAN 6.4: the app reuses the Mac's Claude login through the
Agent SDK, and Anthropic's terms do not allow offering claude.ai login in third-party products
without approval, so the login is for Kevin's own copy and an API key is the way for anything
shared.

The Claude CLI finds a login stored in the keychain only when `USER` is set; an app started
from Finder has it (launchd sets `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `PATH`), and
`package-smoke.sh` passes exactly those.

## The smoke test

`apps/mac/scripts/package-smoke.sh` copies the app (`ditto`) and a temp copy of
`fixtures/issta26` into a new temp folder and runs from there with `env -i` and only the
variables launchd gives a Finder launch, so nothing can reach the checkout: no `SAGE_REPO`, no
`SAGE_NODE`, no node on `PATH`, cwd the temp folder. It checks:

1. the copied app's signature verifies; no `sage-repo-path`; no file in the app (binaries
   included) contains the repository's path;
2. the app in `SAGE_SELFTEST` mode (never activated; draws only its own views) with
   `SAGE_SELFTEST_EXPECT_MODE=bundled`: every self-test check passes (talk built and opened
   through the bundled sidecar, all 61 thumbnails, presenting, the external-edit and edit
   round trips, the Claude pane replay via `SAGE_SELFTEST_CLAUDE_TRACE`, `talk.publish`,
   `talk.export` and site staging through the sidecar, onboarding with the real auth check);
   the app's log shows the sidecar's `ready (… bundled …)` line and no
   development one;
3. `talkc` as Claude's Bash would find it (`Resources/sidecar/bin` first on `PATH`):
   `talkc publish` writes `build/public/issta26.html` byte-identical to the repository's
   `talkc publish` of the same talk, and `talkc shoot` renders a frame through the bundled
   playwright-core in the chosen browser (skipped when there is none).

Result on this Mac (macOS 27, Chrome installed, signed in to Claude): all 19 checks pass, with
63 self-test checks inside; the sidecar answers its first request in about 0.3 s.
