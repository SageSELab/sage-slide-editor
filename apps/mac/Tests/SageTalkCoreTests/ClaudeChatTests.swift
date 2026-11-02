import Foundation
import Testing
@testable import SageTalkCore

/// The chat pane's model, driven by the recorded live session tests/claude/caption-frame.ndjson
/// (the same file the sidecar's replay test uses): its `send` lines go through ClaudeChat.send,
/// its `notify` lines are the notifications the sidecar sent the app.
enum ClaudeRecording {
    static let url = RPCFixtures.directory.deletingLastPathComponent().appendingPathComponent("claude/caption-frame.ndjson")

    static func lines() throws -> [[String: JSONValue]] {
        let text = try String(contentsOf: url, encoding: .utf8)
        return try text.split(separator: "\n").map { line in
            guard case .object(let o) = try JSONDecoder().decode(JSONValue.self, from: Data(line.utf8)) else { throw CocoaError(.coderInvalidValue) }
            return o
        }
    }
}

private actor Sent {
    var texts: [String] = []
    func add(_ t: String) { texts.append(t) }
}

@MainActor @Suite struct ClaudeChatTests {
    /// Plays the recording into a chat; returns the chat, what it sent, and the beats it followed.
    static func play() async throws -> (ClaudeChat, [String], [String]) {
        let chat = ClaudeChat()
        let sent = Sent()
        chat.commands = .init(send: { t, _ in await sent.add(t) }, interrupt: {}, reset: {})
        var followed: [String] = []
        chat.onEditedBeat = { followed.append($0) }
        for line in try ClaudeRecording.lines() {
            guard case .string(let kind)? = line["kind"] else { continue }
            if kind == "send", case .string(let text)? = line["text"] {
                chat.draft = text
                await chat.send()
            } else if kind == "notify", case .string(let method)? = line["method"] {
                chat.apply(method: method, params: line["params"])
            }
        }
        return (chat, await sent.texts, followed)
    }

    @Test func transcriptFromTheRecordedSession() async throws {
        let (chat, sent, followed) = try await Self.play()
        #expect(sent.count == 2)
        let kinds = chat.entries.map { e -> String in
            switch e {
            case .user: "user"
            case .assistant: "text"
            case .tool(let r): "\(r.name):\(r.status.rawValue)"
            case .notice: "notice"
            }
        }
        #expect(kinds.first == "user")
        #expect(kinds.filter { $0 == "user" }.count == 2)
        #expect(kinds.contains("Edit:done"))
        #expect(kinds.contains("talk_frame:done"))
        #expect(!kinds.contains { $0.hasSuffix(":running") }, "every row finished: \(kinds)")
        #expect(kinds.last == "text")
        // Rows are updated in place, not duplicated.
        let rowIds = chat.entries.compactMap { if case .tool(let r) = $0 { r.id } else { nil } }
        #expect(Set(rowIds).count == rowIds.count)
        let edit = chat.entries.compactMap { if case .tool(let r) = $0, r.name == "Edit" { r } else { nil } }.first
        #expect(edit?.path == "scenes/line.html")
        #expect(edit?.beat == "line.title")
        #expect(followed == ["line.title"])
        #expect(chat.lastEditedBeat == "line.title")
        // The final answer streamed into one assistant entry.
        if case .assistant(_, let text)? = chat.entries.last { #expect(text.contains("caption is visible")) }
        #expect(chat.state == .idle)
        #expect(chat.model == "claude-opus-5-5")
        #expect(chat.skillLoaded == true)
        #expect(chat.sessionCost > 0.2 && chat.sessionCost < 0.3)
        #expect((chat.lastCost ?? 0) > 0 && (chat.lastCost ?? 1) < chat.sessionCost)
        #expect((chat.contextTokens ?? 0) > 1000)
    }

    @Test func pinnedCanvasDoesNotFollow() async throws {
        let chat = ClaudeChat()
        var followed: [String] = []
        chat.onEditedBeat = { followed.append($0) }
        chat.followsClaude = false
        let edit = ClaudeProtocol.ToolParams(id: "t1", name: "Edit", summary: "beats/line.js", status: .done, path: "beats/line.js", beat: "line.fifteen")
        chat.apply(method: ClaudeProtocol.Notification.tool, params: try JSONValue.encoding(edit))
        #expect(followed.isEmpty)
        #expect(chat.lastEditedBeat == "line.fifteen")
        // A Read with a beat is not an edit.
        chat.followsClaude = true
        let frame = ClaudeProtocol.ToolParams(id: "t2", name: "talk_frame", summary: "beat x", status: .done, beat: "line.title")
        chat.apply(method: ClaudeProtocol.Notification.tool, params: try JSONValue.encoding(frame))
        #expect(followed.isEmpty)
    }

    /// talk_insert_beat / talk_set_notes rows name the beat they changed (the sidecar's
    /// claude-spine-tools test produces these params): the canvas follows them like file edits.
    @Test func spineToolRowsAreFollowed() async throws {
        let chat = ClaudeChat()
        var followed: [String] = []
        chat.onEditedBeat = { followed.append($0) }
        let running = ClaudeProtocol.ToolParams(id: "tu9", name: "talk_insert_beat", summary: "numbers \"Two numbers\" after results.overview", status: .running)
        chat.apply(method: ClaudeProtocol.Notification.tool, params: try JSONValue.encoding(running))
        #expect(followed.isEmpty)
        let done = ClaudeProtocol.ToolParams(id: "tu9", name: "talk_insert_beat", summary: running.summary, status: .done, detail: "Inserted beat results.numbers", beat: "results.numbers")
        chat.apply(method: ClaudeProtocol.Notification.tool, params: try JSONValue.encoding(done))
        let notes = ClaudeProtocol.ToolParams(id: "tu10", name: "talk_set_notes", summary: "39", status: .done, beat: "results.overview")
        chat.apply(method: ClaudeProtocol.Notification.tool, params: try JSONValue.encoding(notes))
        #expect(followed == ["results.numbers", "results.overview"])
        #expect(chat.lastEditedBeat == "results.overview")
        #expect(chat.entries.count == 2)
    }

    @Test func permissionCardsQueueAndResolve() async throws {
        let chat = ClaudeChat()
        let fixture = try JSONDecoder().decode(RPCMessage.self, from: Data(contentsOf: RPCFixtures.directory.appendingPathComponent("claude/app.ask.request.json")))
        let ask: ClaudeProtocol.AskParams = try #require(fixture.params).decode()
        let first = Task { await chat.ask(ask) }
        let second = Task { await chat.ask(ClaudeProtocol.AskParams(tool: "Write", title: "Write notes", summary: "/tmp/x", reason: "outside", scope: "Write in /tmp")) }
        while chat.permissions.count < 2 { await Task.yield() }
        #expect(chat.pendingPermission?.ask == ask)
        chat.answer(nil, .allowTalk)
        #expect(await first.value == .allowTalk)
        #expect(chat.pendingPermission?.ask.tool == "Write")
        // The request ended (here: an interrupt) while a card was open: it counts as deny.
        let result = """
        {"cost":0.01,"totalCost":0.01,"usage":{"inputTokens":1,"outputTokens":1,"cacheReadTokens":0,"cacheCreationTokens":0,"contextTokens":10},"sessionId":"s","durationMs":5,"turns":1,"error":{"kind":"interrupted","message":"Stopped."}}
        """
        chat.apply(method: ClaudeProtocol.Notification.result, params: try JSONDecoder().decode(JSONValue.self, from: Data(result.utf8)))
        #expect(await second.value == .deny)
        #expect(chat.permissions.isEmpty)
        if case .notice(_, let text, let isError)? = chat.entries.last { #expect(text == "Stopped." && !isError) } else { Issue.record("no notice") }
    }

    @Test func sendFailureIsShown() async {
        struct Down: Error {}
        let chat = ClaudeChat()
        chat.commands = .init(send: { _, _ in throw Down() }, interrupt: {}, reset: {})
        chat.draft = "  hello  "
        #expect(chat.canSend)
        await chat.send()
        #expect(chat.draft.isEmpty)
        #expect(chat.state == .error)
        #expect(chat.entries.count == 2)
        if case .user(_, let t) = chat.entries[0] { #expect(t == "hello") }
    }

    @Test func markdownBlocks() {
        let md = "# Plan\nFirst *line*\nsame para\n\n- one\n- two\n1. first\n```js\nB.in('#a')\n```\nTail"
        #expect(ChatMarkdown.blocks(md) == [
            .heading(level: 1, "Plan"), .paragraph("First *line*\nsame para"), .bullet("one"), .bullet("two"),
            .numbered("1", "first"), .code("B.in('#a')"), .paragraph("Tail"),
        ])
        #expect(ChatMarkdown.blocks("```\nstill streaming") == [.code("still streaming")])
        #expect(ClaudeFormat.usd(0.4123) == "$0.41")
        #expect(ClaudeFormat.tokens(31877) == "31.9k")
    }
}
