import AppKit
import SageTalkCore
import SwiftUI

/// SAGE_SELFTEST, Claude pane: plays the recorded live session tests/claude/caption-frame.ndjson
/// into the window's chat (no sidecar calls, no API calls), checks that the canvas followed the
/// beat Claude edited and that app.state / app.goto answer, opens a permission card, and writes
///   claude-pane.png     the pane alone, drawn off screen from its SwiftUI view
///   window-claude.png   the talk window with the Claude tab showing the card
///   claude.txt          the transcript as the model holds it
extension SelfTest {
    static func claudePane(model: TalkWindowModel, out: URL) async {
        let env = ProcessInfo.processInfo.environment
        guard let repo = SidecarLocator.repoRoot(environment: env, resources: Bundle.main.resourceURL, executable: Bundle.main.executableURL),
              let text = try? String(contentsOf: repo.appendingPathComponent("tests/claude/caption-frame.ndjson"), encoding: .utf8) else {
            check(false, "claude: the recorded session was found"); return
        }
        let chat = model.chat
        let live = chat.commands
        // Sends go nowhere while the recording plays: the self-test never reaches Claude.
        chat.commands = .init(send: { _ in }, interrupt: {}, reset: {})
        defer { chat.commands = live }
        chat.clear()
        chat.followsClaude = true

        // Start away from the title so following the edit is visible.
        model.select(min(4, model.holds.count))
        _ = await waitFor(seconds: 5) { model.t > 6 }
        let start = model.t
        var sent = 0, notes = 0
        for line in text.split(separator: "\n") {
            guard case .object(let o)? = try? JSONDecoder().decode(JSONValue.self, from: Data(line.utf8)),
                  case .string(let kind)? = o["kind"] else { continue }
            if kind == "send", case .string(let t)? = o["text"] {
                chat.draft = t
                await chat.send()
                sent += 1
            } else if kind == "notify", case .string(let m)? = o["method"] {
                chat.apply(method: m, params: o["params"])
                notes += 1
                if m == ClaudeProtocol.Notification.delta { try? await Task.sleep(for: .milliseconds(5)) }
            }
        }
        check(sent == 2 && notes > 40, "claude: replayed \(sent) messages and \(notes) notifications")
        let title = model.holds.first { $0.beat == "line.title" }
        let followed = await waitFor(seconds: 5) { abs(model.t - (title?.at ?? -1)) < 1e-6 }
        check(followed, "claude: the canvas followed the edited beat line.title (t \(start) -> \(model.t))")
        let rows = chat.entries.compactMap { if case .tool(let r) = $0 { r } else { nil } }
        check(rows.map(\.name) == ["Read", "Edit", "talk_frame", "Read"] && rows.allSatisfy { $0.status == .done },
              "claude: four finished tool rows (\(rows.map { "\($0.name):\($0.status.rawValue)" }.joined(separator: " ")))")
        check(chat.state == .idle && chat.sessionCost > 0 && chat.skillLoaded == true, "claude: idle, cost \(ClaudeFormat.usd(chat.sessionCost)), skill loaded")

        // The app's answers to the sidecar's requests.
        if let st = try? await model.answerAppRequest(ClaudeProtocol.AppRequest.state, nil),
           let s: ClaudeProtocol.StateResult = try? st.decode() {
            check(s.beat == "line.title" && !s.pinned && abs(s.t - model.t) < 1e-6, "claude: app.state reports t \(s.t), beat \(s.beat ?? "-")")
        } else { check(false, "claude: app.state answered") }
        let target = model.holds.count >= 2 ? model.holds[1].at : 0
        chat.followsClaude = false
        let pinned = try? await model.answerAppRequest(ClaudeProtocol.AppRequest.goto, .object(["t": .number(target)]))
        check(pinned == .object(["t": .number(model.t)]) && model.t != target, "claude: a pinned canvas stays put on app.goto")
        chat.followsClaude = true
        _ = try? await model.answerAppRequest(ClaudeProtocol.AppRequest.goto, .object(["t": .number(target)]))
        let moved = await waitFor(seconds: 5) { abs(model.t - target) < 1e-6 }
        check(moved, "claude: app.goto moved the canvas to \(target)")

        // Inline code in a reply: only the spans are monospaced (the pane PNG shows it).
        let reply = "\n\nRun `talkc validate --render` before you shoot, then **look** at each frame of `line.title`."
        chat.apply(method: ClaudeProtocol.Notification.delta, params: .object(["text": .string(reply)]))
        let lastText: String? = if case .assistant(_, let t)? = chat.entries.last { t } else { nil }
        let runs = ChatMarkdown.runs(ChatMarkdown.blocks(lastText ?? "").last.flatMap { if case .paragraph(let p) = $0 { p } else { nil } } ?? "")
        check(runs.filter(\.code).map(\.text) == ["talkc validate --render", "line.title"] && runs.contains { !$0.code && $0.text.hasPrefix("Run") },
              "claude: inline code is its own runs in a plain paragraph (\(runs.count) runs)")
        // The effort control and an attachment chip, as a drop from the Materials tab leaves it.
        chat.effort = .xhigh
        if let paper = model.filmRoot?.appendingPathComponent("talk.json") { chat.attach(paper) }
        check(chat.attachments == ["talk.json"], "claude: a dropped file is attached as \(chat.attachments)")

        // A permission card, as app.ask would show it.
        if let edit = rows.first(where: { $0.name == "Edit" }) { chat.expanded.insert(edit.id) }
        let ask = ClaudeProtocol.AskParams(tool: "Bash", title: "Claude wants to use Bash: Build the talk", summary: "npx talkc build .",
                                           reason: "Shell commands can change files anywhere.", scope: "Bash commands starting with \"npx talkc\"")
        let answer = Task { await chat.ask(ask) }
        _ = await waitFor(seconds: 2) { chat.pendingPermission != nil }
        try? await Task.sleep(for: .milliseconds(400))

        writePane(chat, to: out.appendingPathComponent("claude-pane.png"))
        writePane(chat, to: out.appendingPathComponent("claude-pane-light.png"), appearance: .aqua)
        if let win = model.canvas.webView.window {
            await writeWindow(win, films: [model.canvas], to: out.appendingPathComponent("window-claude.png"))
        }
        chat.answer(nil, .deny)
        check(await answer.value == .deny && chat.permissions.isEmpty, "claude: the permission card answered deny")
        chat.detach("talk.json")
        chat.effort = .high

        let transcript = chat.entries.map { e -> String in
            switch e {
            case .user(_, let t): "USER: \(t)"
            case .assistant(_, let t): "CLAUDE: \(t)"
            case .tool(let r): "TOOL \(r.name) [\(r.status.rawValue)] \(r.summary)\(r.beat.map { " beat=\($0)" } ?? "")"
            case .notice(_, let t, _): "NOTICE: \(t)"
            }
        }
        try? (transcript.joined(separator: "\n") + "\nfooter: last \(chat.lastCost ?? 0) session \(chat.sessionCost) context \(chat.contextTokens ?? 0)\n")
            .write(to: out.appendingPathComponent("claude.txt"), atomically: true, encoding: .utf8)
    }

    /// SAGE_SELFTEST, Materials tab: a temp paper folder and package declared as a talk's
    /// materials (the fixture itself has none and is never written), listed into the window's
    /// navigator tab, and
    ///   materials.png          the tab alone, drawn off screen
    ///   window-materials.png   the talk window showing the tab
    static func materialsTab(model: TalkWindowModel, out: URL) async {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-selftest-materials-\(UUID().uuidString)").resolvingSymlinksInPath()
        defer { try? fm.removeItem(at: base) }
        let files = ["talk/talk.json": #"{"format":"sage-talk/1","title":"T","materials":{"paper":"../paper","pdf":"../paper/main.pdf","package":"../UI-Program-Repair"},"chapters":[]}"#,
                     "paper/main.tex": "\\section{Introduction}\n", "paper/main.pdf": "%PDF-1.4\n", "paper/sections/intro.tex": "x", "paper/sections/results.tex": "x",
                     "paper/figures/overview.pdf": "x", "paper/figures/rq1.png": "x", "paper/references.bib": "x",
                     "UI-Program-Repair/README.md": "# package\n", "UI-Program-Repair/derived/outcomes.csv": "bug,tool,outcome\n",
                     "UI-Program-Repair/patches/ChatRepair/114.diff": "x", "UI-Program-Repair/.git/HEAD": "x"]
        for (rel, text) in files {
            let u = base.appendingPathComponent(rel)
            try? fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? text.write(to: u, atomically: true, encoding: .utf8)
        }
        let entries = Materials.load(talkRoot: base.appendingPathComponent("talk"))
        let paper = entries.first { $0.key == "paper" }
        check(entries.map(\.key) == ["package", "paper", "pdf"] && paper?.items.map(\.name) == ["figures", "sections", "main.pdf", "main.tex", "references.bib"]
              && entries.first?.items.map(\.name) == ["derived", "patches", "README.md"],
              "materials: three entries listed, folders first, .git skipped (\(entries.map { "\($0.key):\($0.items.count)" }.joined(separator: " ")))")
        let savedTab = model.navigatorTab, saved = model.materials
        model.materials = entries
        model.navigatorTab = .materials
        try? await Task.sleep(for: .milliseconds(400))
        writeView(MaterialsView(entries: entries, attach: { _ in }), size: NSSize(width: 280, height: 560), to: out.appendingPathComponent("materials.png"))
        if let win = model.canvas.webView.window {
            await writeWindow(win, films: [model.canvas], to: out.appendingPathComponent("window-materials.png"))
        }
        // What a drop of main.tex on the Claude pane does (the drop handler calls attach).
        if let tex = paper?.items.first(where: { $0.name == "main.tex" }) {
            model.chat.attach(tex.url)
            check(model.chat.attachments == [tex.url.path], "materials: a dropped file is attached by path (\(model.chat.attachments))")
            model.chat.detach(tex.url.path)
        }
        model.materials = saved
        model.navigatorTab = savedTab
    }

    /// Draws the pane's SwiftUI view into a PNG in an off-screen window (never on screen).
    private static func writePane(_ chat: ClaudeChat, to url: URL, appearance: NSAppearance.Name = .darkAqua) {
        writeView(ClaudePane(chat: chat), size: NSSize(width: 380, height: 860), to: url, appearance: appearance)
    }

    /// Draws a SwiftUI view into a PNG in an off-screen window (never on screen). cacheDisplay
    /// draws no window background, so the view gets one, in the requested appearance.
    private static func writeView(_ view: some View, size: NSSize, to url: URL, appearance: NSAppearance.Name = .darkAqua) {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height)
            .background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: appearance)
        host.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -10_000, y: -10_000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        host.layoutSubtreeIfNeeded()
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        window.contentView = nil
    }
}
