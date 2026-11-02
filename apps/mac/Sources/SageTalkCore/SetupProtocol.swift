import Foundation

// The Setup section of the sidecar protocol (Phase 6; packages/sidecar/src/protocol.ts,
// docs/rpc.md "Setup"): the onboarding sheet's checks and the render browser download.
// Fixtures: tests/rpc/setup/*.json, decoded by SetupProtocolTests.

public enum SetupProtocol {
    public enum Method {
        public static let check = "setup.check"
        public static let installBrowser = "setup.installBrowser"
    }

    public enum Notification {
        public static let progress = "setup.progress"
    }

    public enum Mode: String, Codable, Sendable { case bundled, development }
    public enum AuthState: String, Codable, Sendable { case login, apiKey, external, none, unknown }
    public enum BrowserState: String, Codable, Sendable { case chrome, installed, missing }

    public struct AuthStatus: Codable, Equatable, Sendable {
        public var state: AuthState
        public var account: String?
        public var organization: String?
        public var plan: String?
        public var source: String?
        public var provider: String?
        public var message: String?
        public init(state: AuthState, account: String? = nil, organization: String? = nil, plan: String? = nil,
                    source: String? = nil, provider: String? = nil, message: String? = nil) {
            self.state = state; self.account = account; self.organization = organization; self.plan = plan
            self.source = source; self.provider = provider; self.message = message
        }
    }

    public struct BrowserStatus: Codable, Equatable, Sendable {
        public var state: BrowserState
        public var path: String?
        public var canInstall: Bool
        public init(state: BrowserState, path: String? = nil, canInstall: Bool) {
            self.state = state; self.path = path; self.canInstall = canInstall
        }
    }

    public struct CheckParams: Codable, Equatable, Sendable {
        public var auth: Bool?
        public init(auth: Bool? = nil) { self.auth = auth }
    }

    public struct CheckResult: Codable, Equatable, Sendable {
        public var mode: Mode
        public var version: String
        public var node: String
        public var nodePath: String
        public var problems: [String]
        public var claudeBinary: String?
        public var talkc: String
        public var browser: BrowserStatus
        public var auth: AuthStatus?
        public init(mode: Mode, version: String, node: String, nodePath: String, problems: [String] = [], claudeBinary: String? = nil,
                    talkc: String, browser: BrowserStatus, auth: AuthStatus? = nil) {
            self.mode = mode; self.version = version; self.node = node; self.nodePath = nodePath; self.problems = problems
            self.claudeBinary = claudeBinary; self.talkc = talkc; self.browser = browser; self.auth = auth
        }
    }

    public struct InstallResult: Codable, Equatable, Sendable {
        public var ok: Bool
        public var message: String?
        public var browser: BrowserStatus
        public init(ok: Bool, message: String? = nil, browser: BrowserStatus) { self.ok = ok; self.message = message; self.browser = browser }
    }

    public struct ProgressParams: Codable, Equatable, Sendable {
        public var task: String
        public var fraction: Double
        public var message: String
        public init(task: String = "browser", fraction: Double, message: String) { self.task = task; self.fraction = fraction; self.message = message }
    }
}

extension SidecarClient {
    /// setup.check. With `auth` the sidecar asks the Claude CLI for the account (a few seconds;
    /// never a model call).
    public func setupCheck(auth: Bool) async throws -> SetupProtocol.CheckResult {
        try await call(SetupProtocol.Method.check, SetupProtocol.CheckParams(auth: auth), timeout: .seconds(60))
    }

    /// setup.installBrowser: a download of about 100 MB; progress arrives as setup.progress.
    public func installBrowser() async throws -> SetupProtocol.InstallResult {
        try await call(SetupProtocol.Method.installBrowser, timeout: .seconds(1800))
    }
}
