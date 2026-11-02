import Foundation
import Observation

/// The chat pane's model (PLAN 6.3): the transcript built from claude.* notifications, the
/// pending permission requests behind app.ask, cost and context, and the canvas-follow switch.
/// AppKit-free; the view (SageTalk/ClaudePane.swift) and TalkWindowModel drive it.
@MainActor @Observable
public final class ClaudeChat {
    public struct ToolRow: Equatable, Sendable {
        public var id: String
        public var name: String
        public var summary: String
        public var status: ClaudeProtocol.ToolStatus
        public var detail: String?
        public var path: String?
        public var beat: String?
    }

    public enum Entry: Identifiable, Equatable, Sendable {
        case user(id: Int, text: String)
        case assistant(id: Int, text: String)
        case tool(ToolRow)
        /// A status line in the transcript: a stop, an error, the budget.
        case notice(id: Int, text: String, isError: Bool)

        public var id: String {
            switch self {
            case .user(let id, _): "u\(id)"
            case .assistant(let id, _): "a\(id)"
            case .tool(let row): "t\(row.id)"
            case .notice(let id, _, _): "n\(id)"
            }
        }
    }

    public struct PermissionRequest: Identifiable, Equatable, Sendable {
        public let id: Int
        public let ask: ClaudeProtocol.AskParams
    }

    /// Sends commands to the sidecar (TalkWindowModel wires it to SidecarClient).
    public struct Commands: Sendable {
        public var send: @Sendable (String, [String]?) async throws -> Void
        public var interrupt: @Sendable () async throws -> Void
        public var reset: @Sendable () async throws -> Void
        public init(send: @escaping @Sendable (String, [String]?) async throws -> Void,
                    interrupt: @escaping @Sendable () async throws -> Void,
                    reset: @escaping @Sendable () async throws -> Void) {
            self.send = send; self.interrupt = interrupt; self.reset = reset
        }
    }

    public private(set) var entries: [Entry] = []
    public private(set) var state: ClaudeProtocol.State = .idle
    public private(set) var statusMessage: String?
    public private(set) var model: String?
    public private(set) var sessionId: String?
    public private(set) var skillLoaded: Bool?
    /// USD of the last request, and of this conversation since the app opened it.
    public private(set) var lastCost: Double?
    public private(set) var sessionCost: Double = 0
    public private(set) var contextTokens: Int?
    /// Permission cards, oldest first; the first is shown.
    public private(set) var permissions: [PermissionRequest] = []
    /// The beat Claude last edited (navigator highlight, canvas follow).
    public private(set) var lastEditedBeat: String?
    /// When false the user pinned the canvas: Claude's edits and talk_goto do not move it.
    public var followsClaude = true
    public var draft = ""
    /// Rows the user expanded.
    public var expanded: Set<String> = []

    public var commands: Commands?
    /// Called when Claude finished an edit to a beat (and the canvas should follow it).
    @ObservationIgnored public var onEditedBeat: ((String) -> Void)?

    @ObservationIgnored private var nextId = 0
    @ObservationIgnored private var waiting: [Int: CheckedContinuation<ClaudeProtocol.AskDecision, Never>] = [:]

    public init() {}

    public var isBusy: Bool { state == .running || state == .starting }
    public var pendingPermission: PermissionRequest? { permissions.first }
    public var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && commands != nil }

    // MARK: Notifications

    /// Applies one claude.* notification. Unknown methods and undecodable params are ignored.
    public func apply(method: String, params: JSONValue?) {
        switch method {
        case ClaudeProtocol.Notification.status:
            guard let p: ClaudeProtocol.StatusParams = try? params?.decode() else { return }
            state = p.state
            if let s = p.sessionId { sessionId = s }
            if let m = p.model { model = m }
            if let k = p.skillLoaded { skillLoaded = k }
            if p.message != nil || p.state == .idle { statusMessage = p.message }
            if p.state == .error, let m = p.message { notice(m, isError: true) }
        case ClaudeProtocol.Notification.delta:
            guard let p: ClaudeProtocol.DeltaParams = try? params?.decode() else { return }
            appendText(p.text)
        case ClaudeProtocol.Notification.tool:
            guard let p: ClaudeProtocol.ToolParams = try? params?.decode() else { return }
            upsert(ToolRow(id: p.id, name: p.name, summary: p.summary, status: p.status, detail: p.detail, path: p.path, beat: p.beat))
        case ClaudeProtocol.Notification.result:
            guard let p: ClaudeProtocol.ResultParams = try? params?.decode() else { return }
            lastCost = p.cost
            sessionCost = p.totalCost
            if p.usage.contextTokens > 0 { contextTokens = p.usage.contextTokens }
            sessionId = p.sessionId
            if let e = p.error { notice(e.message, isError: e.kind != .interrupted) }
            // A request that ended leaves no question open.
            for id in permissions.map(\.id) { answer(id, .deny) }
        default:
            break
        }
    }

    private func appendText(_ text: String) {
        if case .assistant(let id, let existing)? = entries.last {
            entries[entries.count - 1] = .assistant(id: id, text: existing + text)
        } else {
            entries.append(.assistant(id: take(), text: text.trimmingLeadingNewlines))
        }
    }

    private func upsert(_ row: ToolRow) {
        if let i = entries.lastIndex(where: { if case .tool(let r) = $0 { r.id == row.id } else { false } }) {
            entries[i] = .tool(row)
        } else {
            entries.append(.tool(row))
        }
        if row.status == .done, let beat = row.beat, Self.editingTools.contains(row.name) {
            lastEditedBeat = beat
            if followsClaude { onEditedBeat?(beat) }
        }
    }

    /// Tools whose finished row names a beat Claude changed: file edits and the app's spine tools.
    public static let editingTools: Set<String> = ["Write", "Edit", "MultiEdit", "NotebookEdit", "talk_insert_beat", "talk_set_notes"]

    private func notice(_ text: String, isError: Bool) {
        entries.append(.notice(id: take(), text: text, isError: isError))
    }

    private func take() -> Int { nextId += 1; return nextId }

    // MARK: Permissions (app.ask)

    /// Shows a permission card and waits for the user's answer.
    public func ask(_ params: ClaudeProtocol.AskParams) async -> ClaudeProtocol.AskDecision {
        let id = take()
        permissions.append(PermissionRequest(id: id, ask: params))
        return await withCheckedContinuation { waiting[id] = $0 }
    }

    /// The user's answer to the card `id` (the first pending one when nil).
    public func answer(_ id: Int? = nil, _ decision: ClaudeProtocol.AskDecision) {
        guard let id = id ?? permissions.first?.id else { return }
        permissions.removeAll { $0.id == id }
        waiting.removeValue(forKey: id)?.resume(returning: decision)
    }

    // MARK: Commands

    /// Sends the draft. The user's message goes into the transcript at once.
    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let commands else { return }
        draft = ""
        entries.append(.user(id: take(), text: text))
        state = .running
        do { try await commands.send(text, nil) } catch {
            state = .error
            notice("Could not send: \(error.localizedDescription)", isError: true)
        }
    }

    public func stop() async {
        guard let commands else { return }
        try? await commands.interrupt()
    }

    public func newConversation() async {
        guard let commands else { return }
        for id in permissions.map(\.id) { answer(id, .deny) }
        try? await commands.reset()
        entries = []
        lastCost = nil
        contextTokens = nil
        lastEditedBeat = nil
    }

    /// Replaces the transcript with a recorded one (self-test, previews).
    public func clear() {
        for id in permissions.map(\.id) { answer(id, .deny) }
        entries = []; state = .idle; statusMessage = nil; lastCost = nil; sessionCost = 0; contextTokens = nil
        lastEditedBeat = nil; expanded = []
    }
}

extension String {
    fileprivate var trimmingLeadingNewlines: String {
        String(drop(while: { $0 == "\n" }))
    }
}

/// Footer text helpers.
public enum ClaudeFormat {
    public static func usd(_ v: Double) -> String {
        v < 0.01 && v > 0 ? "<$0.01" : String(format: "$%.2f", v)
    }

    public static func tokens(_ n: Int) -> String {
        n >= 1000 ? String(format: "%.1fk", Double(n) / 1000) : "\(n)"
    }
}

/// Splits streamed Markdown into blocks the pane draws: fenced code, headings, list items and
/// paragraphs (inline Markdown inside them is left to AttributedString). An unclosed fence
/// (still streaming) is a code block too.
public enum ChatMarkdown {
    public enum Block: Equatable, Sendable {
        case paragraph(String)
        case heading(level: Int, String)
        case bullet(String)
        case numbered(String, String)
        case code(String)
    }

    public static func blocks(_ text: String) -> [Block] {
        var out: [Block] = []
        var para: [String] = []
        var code: [String]? = nil
        func flush() {
            let p = para.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !p.isEmpty { out.append(.paragraph(p)) }
            para = []
        }
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                if let c = code { out.append(.code(c.joined(separator: "\n"))); code = nil } else { flush(); code = [] }
                continue
            }
            if code != nil { code!.append(raw); continue }
            if line.isEmpty { flush(); continue }
            if let h = line.firstIndex(where: { $0 != "#" }), line.hasPrefix("#"), line[h] == " " {
                flush()
                out.append(.heading(level: line.distance(from: line.startIndex, to: h), String(line[h...]).trimmingCharacters(in: .whitespaces)))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                flush(); out.append(.bullet(String(line.dropFirst(2))))
            } else if let dot = line.firstIndex(of: "."), line[..<dot].allSatisfy(\.isNumber), !line[..<dot].isEmpty,
                      line[line.index(after: dot)...].hasPrefix(" ") {
                flush(); out.append(.numbered(String(line[..<dot]), String(line[line.index(dot, offsetBy: 2)...])))
            } else {
                para.append(line)
            }
        }
        if let c = code { out.append(.code(c.joined(separator: "\n"))) }
        flush()
        return out
    }
}
