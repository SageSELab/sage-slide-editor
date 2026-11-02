import Foundation

// The Claude section of the sidecar protocol (Phase 4; packages/sidecar/src/protocol.ts,
// docs/rpc.md "Claude"). Kept apart from SidecarProtocol so other protocol additions merge
// cleanly. Fixtures: tests/rpc/claude/*.json, decoded by ClaudeProtocolTests.

public enum ClaudeProtocol {
    public enum Method {
        public static let send = "claude.send"
        public static let interrupt = "claude.interrupt"
        public static let reset = "claude.reset"
    }

    public enum Notification {
        public static let status = "claude.status"
        public static let delta = "claude.delta"
        public static let tool = "claude.tool"
        public static let result = "claude.result"
        public static let all = [status, delta, tool, result]
    }

    /// Requests the sidecar sends to the app.
    public enum AppRequest {
        public static let ask = "app.ask"
        public static let state = "app.state"
        public static let goto = "app.goto"
    }

    /// Reasoning effort (the Agent SDK's `effort` option; the pane's footer control).
    public enum Effort: String, Codable, CaseIterable, Sendable {
        case low, medium, high, xhigh, max
        public var label: String {
            switch self {
            case .low: "Low"
            case .medium: "Medium"
            case .high: "High"
            case .xhigh: "Extra high"
            case .max: "Max"
            }
        }
    }

    /// The models the pane's menu offers (claude.send `model`), most capable first.
    public enum Model: String, Codable, CaseIterable, Sendable {
        case fable51 = "claude-fable-5-1"
        case opus55 = "claude-opus-5-5"
        case sonnet55 = "claude-sonnet-5-5"
        case haiku55 = "claude-haiku-5-5"
        /// The sidecar's default.
        public static let standard: Model = .opus55
        public var label: String {
            switch self {
            case .fable51: "Fable 5.1"
            case .opus55: "Opus 5.5"
            case .sonnet55: "Sonnet 5.5"
            case .haiku55: "Haiku 5.5"
            }
        }
        public var detail: String {
            switch self {
            case .fable51: "Most capable, highest cost"
            case .opus55: "Strong and balanced (default)"
            case .sonnet55: "Faster, lower cost"
            case .haiku55: "Fastest, lowest cost"
            }
        }
    }

    public struct SendParams: Codable, Equatable, Sendable {
        public var text: String
        public var attachments: [String]?
        public var effort: Effort?
        public var model: String?
        public init(text: String, attachments: [String]? = nil, effort: Effort? = nil, model: String? = nil) {
            self.text = text; self.attachments = attachments; self.effort = effort; self.model = model
        }
    }
    public struct SendResult: Codable, Equatable, Sendable { public var turn: Int }
    public struct InterruptResult: Codable, Equatable, Sendable { public var interrupted: Bool }

    public enum State: String, Codable, Sendable { case idle, starting, running, error }

    public struct StatusParams: Codable, Equatable, Sendable {
        public var state: State
        public var sessionId: String?
        public var model: String?
        public var message: String?
        public var skillLoaded: Bool?
        public init(state: State, sessionId: String? = nil, model: String? = nil, message: String? = nil, skillLoaded: Bool? = nil) {
            self.state = state; self.sessionId = sessionId; self.model = model; self.message = message; self.skillLoaded = skillLoaded
        }
    }

    public struct DeltaParams: Codable, Equatable, Sendable {
        public var text: String
        public init(text: String) { self.text = text }
    }

    public enum ToolStatus: String, Codable, Sendable { case running, done, error, denied }

    public struct ToolParams: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
        public var summary: String
        public var status: ToolStatus
        public var detail: String?
        public var path: String?
        public var beat: String?
        public init(id: String, name: String, summary: String, status: ToolStatus, detail: String? = nil, path: String? = nil, beat: String? = nil) {
            self.id = id; self.name = name; self.summary = summary; self.status = status; self.detail = detail; self.path = path; self.beat = beat
        }
    }

    public struct Usage: Codable, Equatable, Sendable {
        public var inputTokens: Int
        public var outputTokens: Int
        public var cacheReadTokens: Int
        public var cacheCreationTokens: Int
        public var contextTokens: Int
    }

    public enum ErrorKind: String, Codable, Sendable { case budget, maxTurns = "max_turns", execution, interrupted, process }

    public struct ResultError: Codable, Equatable, Sendable {
        public var kind: ErrorKind
        public var message: String
    }

    public struct ResultParams: Codable, Equatable, Sendable {
        public var cost: Double
        public var totalCost: Double
        public var usage: Usage
        public var sessionId: String
        public var durationMs: Double
        public var turns: Int
        public var error: ResultError?
    }

    public struct AskParams: Codable, Equatable, Sendable {
        public var tool: String
        public var title: String
        public var summary: String
        public var path: String?
        public var reason: String
        public var scope: String
        public init(tool: String, title: String, summary: String, path: String? = nil, reason: String, scope: String) {
            self.tool = tool; self.title = title; self.summary = summary; self.path = path; self.reason = reason; self.scope = scope
        }
    }

    public enum AskDecision: String, Codable, Sendable { case allow, allowTalk, deny }
    public struct AskResult: Codable, Equatable, Sendable {
        public var decision: AskDecision
        public init(decision: AskDecision) { self.decision = decision }
    }

    public struct StateResult: Codable, Equatable, Sendable {
        public var t: Double
        public var playing: Bool
        public var hold: Int?
        public var beat: String?
        public var label: String?
        public var selection: [String]
        public var pinned: Bool
        public init(t: Double, playing: Bool, hold: Int? = nil, beat: String? = nil, label: String? = nil, selection: [String] = [], pinned: Bool) {
            self.t = t; self.playing = playing; self.hold = hold; self.beat = beat; self.label = label; self.selection = selection; self.pinned = pinned
        }
    }

    public struct GotoParams: Codable, Equatable, Sendable {
        public var t: Double
        public var beat: String?
    }
    public struct GotoResult: Codable, Equatable, Sendable {
        public var t: Double
        public init(t: Double) { self.t = t }
    }
}

extension SidecarClient {
    public func claudeSend(_ params: ClaudeProtocol.SendParams) async throws -> ClaudeProtocol.SendResult {
        try await call(ClaudeProtocol.Method.send, params)
    }

    public func claudeInterrupt() async throws -> ClaudeProtocol.InterruptResult {
        try await call(ClaudeProtocol.Method.interrupt)
    }

    public func claudeReset() async throws {
        let _: SidecarProtocol.Empty = try await call(ClaudeProtocol.Method.reset)
    }
}
