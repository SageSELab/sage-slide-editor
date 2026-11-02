import SageTalkCore
import SwiftUI

/// The Claude tab of the right-hand column (PLAN 6.3): the streamed transcript with compact
/// tool rows, an inline permission card, a cost and context footer, and the prompt field.
struct ClaudePane: View {
    @Bindable var chat: ClaudeChat

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if chat.entries.isEmpty { empty }
                        ForEach(chat.entries) { entry in
                            ChatEntryView(entry: entry, chat: chat).id(entry.id)
                        }
                        if let p = chat.pendingPermission {
                            PermissionCard(request: p, chat: chat).id("permission")
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(10)
                }
                .onChange(of: chat.entries) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .onChange(of: chat.pendingPermission) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            }
            Divider()
            footer
            if !chat.attachments.isEmpty { attachmentChips }
            prompt
        }
        // Files dragged from the Materials tab (or the Finder) are attached to the next message.
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter(\.isFileURL)
            files.forEach(chat.attach)
            return !files.isEmpty
        } isTargeted: { dropTargeted = $0 }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor, lineWidth: 2).padding(2)
                    .allowsHitTesting(false)
            }
        }
        .accessibilityIdentifier("claude.pane")
    }

    @State private var dropTargeted = false

    /// The files attached to the next message, each removable.
    private var attachmentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(chat.attachments, id: \.self) { p in
                    HStack(spacing: 4) {
                        Image(systemName: "paperclip")
                        Text((p as NSString).lastPathComponent).lineLimit(1)
                        Button { chat.detach(p) } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.borderless).help("Remove \(p)")
                    }
                    .font(.caption)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                    .help(p)
                }
            }
            .padding(.horizontal, 10)
        }
        .padding(.top, 6)
        .accessibilityIdentifier("claude.attachments")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle().fill(stateColor).frame(width: 7, height: 7)
            Text(stateText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            Toggle(isOn: $chat.followsClaude) {
                Label("Follow", systemImage: chat.followsClaude ? "scope" : "pin.fill")
            }
            .toggleStyle(.button).controlSize(.small)
            .help(chat.followsClaude ? "The canvas follows the beat Claude edits. Click to pin it where you are."
                                     : "The canvas is pinned. Click to follow Claude's edits again.")
            .accessibilityIdentifier("claude.follow")
            Menu {
                Button("New Conversation") { Task { await chat.newConversation() } }
            } label: { Image(systemName: "ellipsis.circle") }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
    }

    private var stateText: String {
        switch chat.state {
        case .idle: chat.statusMessage ?? (chat.sessionId == nil ? "Claude" : "Ready")
        case .starting: chat.statusMessage ?? "Starting…"
        case .running: "Working…"
        case .error: chat.statusMessage ?? "Error"
        }
    }

    private var stateColor: Color {
        switch chat.state {
        case .idle: .green
        case .starting, .running: .orange
        case .error: .red
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Ask Claude to build or revise the talk.").font(.callout)
            Text("It edits the talk files, the canvas follows its changes, and it checks frames with the app.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 20)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 10) {
                if let c = chat.lastCost { Text("Last \(ClaudeFormat.usd(c))") }
                Text("Session \(ClaudeFormat.usd(chat.sessionCost))")
                if let n = chat.contextTokens { Text("Context \(ClaudeFormat.tokens(n))") }
            }
            .lineLimit(1).minimumScaleFactor(0.8)
            HStack(spacing: 12) {
                modelControl
                effortControl
                Spacer(minLength: 0)
            }
        }
        .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
        .padding(.horizontal, 10).padding(.vertical, 4)
        .accessibilityIdentifier("claude.footer")
    }

    /// The model the next message runs on (claude.send `model`; a running conversation switches
    /// with setModel, so the context is kept). Remembered across launches.
    private var modelControl: some View {
        HStack(spacing: 4) {
            Image(systemName: "cpu")
            Picker("Model", selection: $chat.chosenModel) {
                ForEach(ClaudeProtocol.Model.allCases, id: \.self) { m in
                    Text(m.label).tag(m)
                }
            }
            .pickerStyle(.menu).labelsHidden().controlSize(.mini).fixedSize()
            .accessibilityIdentifier("claude.model")
        }
        .help(modelHelp)
    }

    private var modelHelp: String {
        var lines = ClaudeProtocol.Model.allCases.map { "\($0.label): \($0.detail)" }
        if let running = chat.model, running != chat.chosenModel.rawValue {
            lines.append("The conversation is on \(running); the next message switches it.")
        }
        return "Claude model for the next message.\n" + lines.joined(separator: "\n")
    }

    /// The reasoning effort sent with the next message (the Agent SDK's `effort` option; a running
    /// conversation switches with applyFlagSettings, so changing it does not lose the context).
    private var effortControl: some View {
        HStack(spacing: 4) {
            Image(systemName: "gauge.with.dots.needle.33percent")
            Text("Effort")
            Picker("Effort", selection: $chat.effort) {
                ForEach(ClaudeProtocol.Effort.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu).labelsHidden().controlSize(.mini).fixedSize()
            .accessibilityIdentifier("claude.effort")
        }
        .help("Reasoning effort for the next message. Higher thinks longer and costs more.")
    }

    private var prompt: some View {
        HStack(alignment: .bottom, spacing: 6) {
            TextField("Message Claude", text: $chat.draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...6)
                .onSubmit { Task { await chat.send() } }
                .accessibilityIdentifier("claude.prompt")
            if chat.isBusy {
                Button { Task { await chat.stop() } } label: { Image(systemName: "stop.circle.fill").font(.title3) }
                    .buttonStyle(.borderless).help("Stop").accessibilityIdentifier("claude.stop")
            } else {
                Button { Task { await chat.send() } } label: { Image(systemName: "arrow.up.circle.fill").font(.title3) }
                    .buttonStyle(.borderless).disabled(!chat.canSend).keyboardShortcut(.return, modifiers: .command)
                    .help("Send (⌘↩)").accessibilityIdentifier("claude.send")
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color(nsColor: .textBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
        .padding(8)
    }
}

private struct ChatEntryView: View {
    let entry: ClaudeChat.Entry
    let chat: ClaudeChat

    var body: some View {
        switch entry {
        case .user(_, let text):
            Text(text)
                .textSelection(.enabled)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.accentColor.opacity(0.15)))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant(_, let text):
            MarkdownText(text: text)
        case .tool(let row):
            ToolRowView(row: row, chat: chat)
        case .notice(_, let text, let isError):
            Label(text, systemImage: isError ? "exclamationmark.triangle.fill" : "stop.circle")
                .font(.caption).foregroundStyle(isError ? .red : .secondary)
        }
    }
}

/// Assistant text as Markdown blocks with inline formatting.
private struct MarkdownText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(ChatMarkdown.blocks(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let s): inline(s)
                case .heading(let level, let s): inline(s).font(level <= 2 ? .headline : .subheadline.bold())
                case .bullet(let s): HStack(alignment: .firstTextBaseline, spacing: 6) { Text("•"); inline(s) }
                case .numbered(let n, let s): HStack(alignment: .firstTextBaseline, spacing: 6) { Text("\(n)."); inline(s) }
                case .code(let s):
                    Text(s).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.1)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func inline(_ s: String) -> Text { Text(Self.attributed(s)) }

    /// The runs of ChatMarkdown.runs with explicit SwiftUI attributes and no presentation intents:
    /// only code spans get the monospaced font; everything else inherits the body font.
    static func attributed(_ s: String) -> AttributedString {
        var out = AttributedString()
        for r in ChatMarkdown.runs(s) {
            var a = AttributedString(r.text)
            if r.code {
                // Font only: a translucent background colour on the run drew as opaque white
                // blocks in the window's own snapshot.
                a.font = .system(.body, design: .monospaced).weight(r.strong ? .semibold : .regular)
            } else if r.strong || r.emphasis {
                var f = Font.body
                if r.strong { f = f.bold() }
                if r.emphasis { f = f.italic() }
                a.font = f
            }
            if r.strike { a.strikethroughStyle = .single }
            if let l = r.link { a.link = l }
            out += a
        }
        return out
    }
}

/// One tool call: icon, name, summary, status; click to expand its result.
private struct ToolRowView: View {
    let row: ClaudeChat.ToolRow
    @Bindable var chat: ClaudeChat

    private var expanded: Bool { chat.expanded.contains(row.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                if expanded { chat.expanded.remove(row.id) } else { chat.expanded.insert(row.id) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: icon).frame(width: 14).foregroundStyle(.secondary)
                    Text(title).fontWeight(.medium)
                    Text(row.summary).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    status
                    if row.detail != nil {
                        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                            .rotationEffect(.degrees(expanded ? 90 : 0))
                    }
                }
                .font(.caption)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded, let d = row.detail {
                ScrollView {
                    Text(d).font(.system(.caption2, design: .monospaced)).textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 160)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.08)))
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 7).strokeBorder(.separator))
        .accessibilityIdentifier("claude.tool.\(row.id)")
    }

    private var title: String {
        switch row.name {
        case "talk_frame": "Frame"
        case "talk_goto": "Go to"
        case "talk_layout": "Layout"
        case "talk_state": "Canvas state"
        case "talk_materials": "Materials"
        case "talk_insert_beat": "Insert beat"
        case "talk_set_notes": "Notes"
        default: row.name
        }
    }

    private var icon: String {
        switch row.name {
        case "Read", "NotebookRead": "doc.text"
        case "Write", "Edit", "MultiEdit", "NotebookEdit": "pencil"
        case "Bash": "terminal"
        case "Glob", "Grep", "LS", "ToolSearch": "magnifyingglass"
        case "Skill": "book"
        case "WebFetch", "WebSearch": "globe"
        case "talk_frame": "photo"
        case "talk_goto": "arrow.right.circle"
        case "talk_layout": "list.number"
        case "talk_state": "scope"
        case "talk_materials": "books.vertical"
        case "talk_insert_beat": "plus.rectangle.on.rectangle"
        case "talk_set_notes": "text.bubble"
        default: "wrench.and.screwdriver"
        }
    }

    @ViewBuilder private var status: some View {
        switch row.status {
        case .running: ProgressView().controlSize(.mini)
        case .done: Image(systemName: "checkmark").foregroundStyle(.green)
        case .error: Image(systemName: "xmark").foregroundStyle(.red)
        case .denied: Image(systemName: "hand.raised.fill").foregroundStyle(.orange)
        }
    }
}

/// The approval card behind app.ask: Allow once, Allow for this talk, Deny.
struct PermissionCard: View {
    let request: ClaudeChat.PermissionRequest
    let chat: ClaudeChat

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(request.ask.title, systemImage: "hand.raised").font(.callout.weight(.semibold))
            Text(request.ask.reason).font(.caption).foregroundStyle(.secondary)
            if !request.ask.summary.isEmpty {
                Text(request.ask.summary).font(.system(.caption, design: .monospaced)).lineLimit(6)
                    .textSelection(.enabled)
                    .padding(6).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.secondary.opacity(0.1)))
            }
            HStack {
                Button("Deny") { chat.answer(request.id, .deny) }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Allow for this talk") { chat.answer(request.id, .allowTalk) }
                    .help("Saves: \(request.ask.scope)")
                Button("Allow once") { chat.answer(request.id, .allow) }.buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
            Text("“Allow for this talk” saves: \(request.ask.scope)").font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.orange.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Color.orange.opacity(0.5)))
        .accessibilityIdentifier("claude.permission")
    }
}
