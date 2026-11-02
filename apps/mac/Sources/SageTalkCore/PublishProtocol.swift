import Foundation

// The publish and export section of the sidecar protocol (Phase 5; packages/sidecar/src/protocol.ts,
// docs/rpc.md "Publish and export"). Kept apart from SidecarProtocol so other protocol additions
// merge cleanly. Fixtures: tests/rpc/publish/*.json, decoded by PublishProtocolTests.

public enum PublishProtocol {
    public enum Method {
        public static let publish = "talk.publish"
        public static let export = "talk.export"
        public static let stage = "site.stage"
        public static let commit = "site.commit"
        public static let qr = "talk.qr"
        public static let all = [publish, export, stage, commit, qr]
    }

    public enum Notification {
        public static let exportProgress = "talk.exportProgress"
    }

    public enum ErrorCode {
        public static let publishFailed = -32020
        public static let notPublished = -32021
        public static let siteFailed = -32022
        public static let all = [publishFailed, notPublished, siteFailed]
    }

    public struct PublishParams: Codable, Equatable, Sendable {
        public var slug: String?
        public init(slug: String? = nil) { self.slug = slug }
    }

    public struct PublishResult: Codable, Equatable, Sendable {
        public var path: String
        public var bytes: Int
        public var holds: Int
        public var duration: Double
        public var warnings: [SidecarProtocol.Diagnostic]
        public init(path: String, bytes: Int, holds: Int, duration: Double, warnings: [SidecarProtocol.Diagnostic] = []) {
            self.path = path; self.bytes = bytes; self.holds = holds; self.duration = duration; self.warnings = warnings
        }
    }

    public enum ExportKind: String, Codable, Sendable, CaseIterable { case png, pdf }

    /// `'all'` or 1-based hold numbers.
    public enum HoldSelection: Codable, Equatable, Sendable {
        case all
        case some([Int])
        public init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self), s == "all" { self = .all; return }
            self = .some(try c.decode([Int].self))
        }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case .all: try c.encode("all")
            case .some(let n): try c.encode(n)
            }
        }
    }

    public struct ExportParams: Codable, Equatable, Sendable {
        public var kind: ExportKind
        public var holds: HoldSelection?
        public var around: Double?
        public init(kind: ExportKind, holds: HoldSelection? = nil, around: Double? = nil) { self.kind = kind; self.holds = holds; self.around = around }
    }

    public struct ExportResult: Codable, Equatable, Sendable {
        public var kind: ExportKind
        public var dir: String
        public var files: [String]
        public var frames: Int
        public var width: Int
        public var height: Int
        public var ms: Double
        public var errors: [String]
        public init(kind: ExportKind, dir: String, files: [String], frames: Int, width: Int = 1920, height: Int = 1080, ms: Double = 0, errors: [String] = []) {
            self.kind = kind; self.dir = dir; self.files = files; self.frames = frames; self.width = width; self.height = height; self.ms = ms; self.errors = errors
        }
    }

    public struct ExportProgress: Codable, Equatable, Sendable {
        public var kind: ExportKind
        public var done: Int
        public var total: Int
        public init(kind: ExportKind, done: Int, total: Int) { self.kind = kind; self.done = done; self.total = total }
    }

    public enum Site: String, Codable, Sendable, CaseIterable, Identifiable {
        case personal, lab
        public var id: String { rawValue }
        public var title: String { self == .personal ? "Personal site" : "Lab site" }
    }

    public struct StageParams: Codable, Equatable, Sendable {
        public var site: Site
        public var repo: String
        public var slug: String
        public var paperEntry: String?
        public init(site: Site, repo: String, slug: String, paperEntry: String? = nil) { self.site = site; self.repo = repo; self.slug = slug; self.paperEntry = paperEntry }
    }

    public enum FileStatus: String, Codable, Sendable { case added, modified, unchanged }

    public struct SiteFile: Codable, Equatable, Sendable, Identifiable {
        public var path: String
        public var status: FileStatus
        public var id: String { path }
        public init(path: String, status: FileStatus) { self.path = path; self.status = status }
    }

    public struct StageResult: Codable, Equatable, Sendable {
        public var site: Site
        public var repo: String
        public var url: String
        public var files: [SiteFile]
        public var diff: String
        public var notes: [String]
        public init(site: Site, repo: String, url: String, files: [SiteFile], diff: String, notes: [String] = []) {
            self.site = site; self.repo = repo; self.url = url; self.files = files; self.diff = diff; self.notes = notes
        }
        /// The files a commit would include.
        public var changed: [String] { files.filter { $0.status != .unchanged }.map(\.path) }
    }

    public struct CommitParams: Codable, Equatable, Sendable {
        public var repo: String
        public var paths: [String]
        public var message: String
        public init(repo: String, paths: [String], message: String) { self.repo = repo; self.paths = paths; self.message = message }
    }

    public struct CommitResult: Codable, Equatable, Sendable {
        public var commit: String
        public var summary: String
        public init(commit: String, summary: String) { self.commit = commit; self.summary = summary }
    }

    /// URLs to encode; each one given becomes assets/qr-<name>.svg.
    public struct QRParams: Codable, Equatable, Sendable {
        public var paper: String?
        public var slides: String?
        public var package: String?
        public init(paper: String? = nil, slides: String? = nil, package: String? = nil) { self.paper = paper; self.slides = slides; self.package = package }
    }

    public struct QRResult: Codable, Equatable, Sendable {
        public var files: [String]
        public init(files: [String]) { self.files = files }
    }
}

/// What publishes, exports and stages: the sidecar client, or a fake in tests.
public protocol PublishService: Sendable {
    func publish(_ p: PublishProtocol.PublishParams) async throws -> PublishProtocol.PublishResult
    func export(_ p: PublishProtocol.ExportParams) async throws -> PublishProtocol.ExportResult
    func stage(_ p: PublishProtocol.StageParams) async throws -> PublishProtocol.StageResult
    func commit(_ p: PublishProtocol.CommitParams) async throws -> PublishProtocol.CommitResult
    func qrCodes(_ p: PublishProtocol.QRParams) async throws -> PublishProtocol.QRResult
}

extension SidecarClient: PublishService {
    public func publish(_ p: PublishProtocol.PublishParams) async throws -> PublishProtocol.PublishResult {
        try await call(PublishProtocol.Method.publish, p, timeout: .seconds(120))
    }
    /// Rendering every hold of a long talk takes a while; progress arrives as talk.exportProgress.
    public func export(_ p: PublishProtocol.ExportParams) async throws -> PublishProtocol.ExportResult {
        try await call(PublishProtocol.Method.export, p, timeout: .seconds(900))
    }
    public func stage(_ p: PublishProtocol.StageParams) async throws -> PublishProtocol.StageResult {
        try await call(PublishProtocol.Method.stage, p, timeout: .seconds(60))
    }
    public func commit(_ p: PublishProtocol.CommitParams) async throws -> PublishProtocol.CommitResult {
        try await call(PublishProtocol.Method.commit, p, timeout: .seconds(60))
    }
    public func qrCodes(_ p: PublishProtocol.QRParams) async throws -> PublishProtocol.QRResult {
        try await call(PublishProtocol.Method.qr, p)
    }
}
