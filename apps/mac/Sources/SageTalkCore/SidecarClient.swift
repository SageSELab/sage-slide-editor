import Foundation

// The app side of the sidecar connection (PLAN 2, 6.1; protocol in docs/rpc.md and
// packages/sidecar/src/protocol.ts). `SidecarClient` owns one sidecar process at a time, frames
// requests as NDJSON, matches responses by id, surfaces notifications and termination as an
// AsyncStream, and can restart the process and re-open the talk after a crash.

// MARK: - Typed protocol payloads (mirror packages/sidecar/src/protocol.ts)

public enum SidecarProtocol {
    public static let version = 1

    public enum Method {
        public static let ping = "app.ping"
        public static let shutdown = "app.shutdown"
        public static let open = "talk.open"
        public static let close = "talk.close"
        public static let build = "talk.build"
        public static let layout = "talk.layout"
        public static let watch = "talk.watch"
    }

    public enum Notification {
        public static let changed = "talk.changed"
        public static let built = "talk.built"
    }

    public enum ErrorCode {
        public static let parseError = -32700
        public static let invalidRequest = -32600
        public static let methodNotFound = -32601
        public static let invalidParams = -32602
        public static let internalError = -32603
        public static let notATalk = -32000
        public static let noTalkOpen = -32001
        public static let unsupportedForKind = -32002
        public static let shuttingDown = -32003
        public static let timeout = -32004
    }

    public enum TalkKind: String, Codable, Sendable { case beatFormat, legacy }
    public enum Severity: String, Codable, Sendable { case error, warning, info }
    public enum ChangeSource: String, Codable, Sendable { case app, external }
    public enum BuildTrigger: String, Codable, Sendable { case open, request, change }

    public struct Empty: Codable, Equatable, Sendable { public init() {} }

    public struct Diagnostic: Codable, Equatable, Sendable {
        public var severity: Severity
        public var code: String
        public var message: String
        public var file: String?
        public var beat: String?
    }

    /// The wire hold; a superset of `Hold` (which the navigator uses).
    public struct WireHold: Codable, Equatable, Sendable {
        public var index: Int
        public var at: Double
        public var label: String
        public var backup: Bool
        public var beat: String
        public var chapter: String
        public var auto: Bool
        public var hold: Hold { Hold(index: index, at: at, label: label, backup: backup) }
    }

    public struct OpenParams: Codable, Equatable, Sendable {
        public var path: String
        public var watch: Bool?
        public init(path: String, watch: Bool? = nil) { self.path = path; self.watch = watch }
    }

    public struct WatchParams: Codable, Equatable, Sendable {
        public var enabled: Bool
        public init(enabled: Bool) { self.enabled = enabled }
    }

    public struct BuildResult: Codable, Equatable, Sendable {
        public var ok: Bool
        public var diagnostics: [Diagnostic]
        public var ms: Double
    }

    public struct OpenResult: Codable, Equatable, Sendable {
        public var kind: TalkKind
        public var root: String
        public var filmURL: URL
        public var holds: [WireHold]?
        public var build: BuildResult?
    }

    public struct LayoutResult: Codable, Equatable, Sendable {
        public var holds: [WireHold]
        public var duration: Double
        public var diagnostics: [Diagnostic]
    }

    public struct PingResult: Codable, Equatable, Sendable {
        public var pong: Bool
        public var `protocol`: Int
        public var version: String
        public var pid: Int
    }

    public struct WatchResult: Codable, Equatable, Sendable {
        public var watching: Bool
    }

    public struct ChangedParams: Codable, Equatable, Sendable {
        public var paths: [String]
        public var source: ChangeSource
    }

    public struct BuiltParams: Codable, Equatable, Sendable {
        public var ok: Bool
        public var diagnostics: [Diagnostic]
        public var ms: Double
        public var trigger: BuildTrigger
        public var holds: [WireHold]?
    }
}

extension JSONValue {
    /// Decodes this value as `T` (via a JSON round trip).
    public func decode<T: Decodable>(as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }

    /// Encodes any Encodable into a JSONValue.
    public static func encoding<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}

// MARK: - Configuration and errors

public struct SidecarConfiguration: Sendable {
    public var executable: URL
    public var arguments: [String]
    public var currentDirectory: URL?
    /// nil inherits the app's environment.
    public var environment: [String: String]?
    public var requestTimeout: Duration
    /// Receives the sidecar's stderr (log text). nil passes it through to the app's stderr.
    public var stderrHandler: (@Sendable (String) -> Void)?

    public init(executable: URL, arguments: [String] = [], currentDirectory: URL? = nil,
                environment: [String: String]? = nil, requestTimeout: Duration = .seconds(30),
                stderrHandler: (@Sendable (String) -> Void)? = nil) {
        self.executable = executable
        self.arguments = arguments
        self.currentDirectory = currentDirectory
        self.environment = environment
        self.requestTimeout = requestTimeout
        self.stderrHandler = stderrHandler
    }

    /// Development launch: `node --import tsx src/main.ts` in `<repo>/packages/sidecar`
    /// (tsx resolves from that package's node_modules). The bundled app will point at a vendored
    /// Node and a compiled entry point instead (Phase 6).
    public static func development(repoRoot: URL, node: URL) -> SidecarConfiguration {
        SidecarConfiguration(executable: node, arguments: ["--import", "tsx", "src/main.ts"],
                             currentDirectory: repoRoot.appendingPathComponent("packages/sidecar"))
    }

    /// Finds a `node` executable on PATH or in the usual install locations.
    public static func findNode(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL? {
        let fm = FileManager.default
        let dirs = (environment["PATH"] ?? "").split(separator: ":").map(String.init)
            + ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        for dir in dirs where !dir.isEmpty {
            let p = URL(fileURLWithPath: dir).appendingPathComponent("node")
            if fm.isExecutableFile(atPath: p.path) { return p }
        }
        return nil
    }
}

public struct SidecarTermination: Equatable, Sendable {
    public enum Reason: Equatable, Sendable { case exit, uncaughtSignal }
    public var reason: Reason
    /// Exit code, or the signal number when `reason == .uncaughtSignal`.
    public var status: Int32
    /// True when the client asked for it (stop, restart).
    public var expected: Bool

    public init(reason: Reason, status: Int32, expected: Bool = false) {
        self.reason = reason; self.status = status; self.expected = expected
    }
}

public enum SidecarError: Error, Equatable, LocalizedError {
    case notRunning
    case launchFailed(String)
    case terminated(SidecarTermination)
    case timeout(method: String)
    case remote(RPCError)
    case badResult(method: String, detail: String)

    public var errorDescription: String? {
        switch self {
        case .notRunning: "The sidecar is not running."
        case .launchFailed(let s): "The sidecar could not be started: \(s)"
        case .terminated(let t): "The sidecar stopped (\(t.reason == .exit ? "exit" : "signal") \(t.status))."
        case .timeout(let m): "The sidecar did not answer \(m) in time."
        case .remote(let e): e.message
        case .badResult(let m, let d): "Unexpected result for \(m): \(d)"
        }
    }
}

public enum SidecarEvent: Equatable, Sendable {
    /// A process (re)started; `generation` counts launches from 1.
    case started(generation: Int)
    case notification(method: String, params: JSONValue?)
    case terminated(SidecarTermination)
}

// MARK: - Transport

public enum TransportEvent: Sendable {
    case data(Data)
    /// Delivered once, after all `data` events (stdout EOF and process exit both seen).
    case closed(SidecarTermination)
}

/// A byte pipe to one sidecar instance. A new transport is created for every (re)start.
public protocol SidecarTransport: Sendable {
    func start() throws -> AsyncStream<TransportEvent>
    func send(_ data: Data) throws
    /// Closes the sidecar's stdin; the sidecar exits on its own.
    func closeInput()
    /// SIGTERM, or SIGKILL when `force`.
    func terminate(force: Bool)
}

/// Runs the sidecar as a child process with stdio pipes.
public final class ProcessTransport: SidecarTransport, @unchecked Sendable {
    private let config: SidecarConfiguration
    private let lock = NSLock()
    private var process: Process?
    private var input: FileHandle?

    public init(_ config: SidecarConfiguration) { self.config = config }

    public var processIdentifier: Int32? { lock.withLock { process?.processIdentifier } }

    public func start() throws -> AsyncStream<TransportEvent> {
        signal(SIGPIPE, SIG_IGN) // a write to a dead sidecar must throw EPIPE, not kill the app
        let p = Process()
        p.executableURL = config.executable
        p.arguments = config.arguments
        if let cwd = config.currentDirectory { p.currentDirectoryURL = cwd }
        if let env = config.environment { p.environment = env }
        let inPipe = Pipe(), outPipe = Pipe()
        p.standardInput = inPipe
        p.standardOutput = outPipe
        if let handler = config.stderrHandler {
            let errPipe = Pipe()
            p.standardError = errPipe
            errPipe.fileHandleForReading.readabilityHandler = { h in
                let d = h.availableData
                if d.isEmpty { h.readabilityHandler = nil } else { handler(String(decoding: d, as: UTF8.self)) }
            }
        } else {
            p.standardError = FileHandle.standardError
        }

        let (stream, cont) = AsyncStream<TransportEvent>.makeStream()
        let close = CloseLatch(cont)
        outPipe.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; close.eof() } else { cont.yield(.data(d)) }
        }
        p.terminationHandler = { proc in
            close.exited(SidecarTermination(reason: proc.terminationReason == .exit ? .exit : .uncaughtSignal,
                                            status: proc.terminationStatus))
        }
        do { try p.run() } catch {
            outPipe.fileHandleForReading.readabilityHandler = nil
            throw SidecarError.launchFailed("\(config.executable.path): \(error.localizedDescription)")
        }
        try? outPipe.fileHandleForWriting.close()  // our copy of the child's ends
        try? inPipe.fileHandleForReading.close()
        lock.withLock { process = p; input = inPipe.fileHandleForWriting }
        return stream
    }

    public func send(_ data: Data) throws {
        guard let h = lock.withLock({ input }) else { throw SidecarError.notRunning }
        try h.write(contentsOf: data)
    }

    public func closeInput() {
        let h = lock.withLock { () -> FileHandle? in defer { input = nil }; return input }
        try? h?.close()
    }

    public func terminate(force: Bool) {
        guard let p = lock.withLock({ process }), p.isRunning else { return }
        if force { kill(p.processIdentifier, SIGKILL) } else { p.terminate() }
    }
}

/// Yields `.closed` once both stdout EOF and process exit have been observed.
private final class CloseLatch: @unchecked Sendable {
    private let lock = NSLock()
    private var sawEOF = false
    private var termination: SidecarTermination?
    private var done = false
    private let cont: AsyncStream<TransportEvent>.Continuation
    init(_ cont: AsyncStream<TransportEvent>.Continuation) { self.cont = cont }

    func eof() { lock.withLock { sawEOF = true }; fire() }
    func exited(_ t: SidecarTermination) { lock.withLock { termination = t }; fire() }
    private func fire() {
        let t: SidecarTermination? = lock.withLock {
            guard !done, sawEOF, let t = termination else { return nil }
            done = true
            return t
        }
        guard let t else { return }
        cont.yield(.closed(t))
        cont.finish()
    }
}

// MARK: - Client

public actor SidecarClient {
    public typealias TransportFactory = @Sendable () -> any SidecarTransport
    /// Handles requests the sidecar sends to the app (Phase 4: approval sheet, frames).
    public typealias RequestHandler = @Sendable (_ method: String, _ params: JSONValue?) async throws -> JSONValue

    /// Notifications, starts and terminations for the lifetime of the client (across restarts).
    public nonisolated let events: AsyncStream<SidecarEvent>
    private let eventSink: AsyncStream<SidecarEvent>.Continuation

    private let makeTransport: TransportFactory
    private let requestTimeout: Duration
    private var requestHandler: RequestHandler?

    private var transport: (any SidecarTransport)?
    private var generation = 0
    private var stopping = false
    private var framer = NDJSONFramer()
    private var nextId = 1
    private var pending: [Int: (method: String, continuation: CheckedContinuation<JSONValue, Error>, timer: Task<Void, Never>)] = [:]
    private var terminationWaiters: [UUID: CheckedContinuation<SidecarTermination?, Never>] = [:]
    private var lastTermination: SidecarTermination?
    private var lastOpen: SidecarProtocol.OpenParams?

    public init(transport makeTransport: @escaping TransportFactory, requestTimeout: Duration = .seconds(30)) {
        self.makeTransport = makeTransport
        self.requestTimeout = requestTimeout
        (events, eventSink) = AsyncStream<SidecarEvent>.makeStream()
    }

    public init(configuration: SidecarConfiguration) {
        self.init(transport: { ProcessTransport(configuration) }, requestTimeout: configuration.requestTimeout)
    }

    deinit { eventSink.finish() }

    public var isRunning: Bool { transport != nil }
    public var launches: Int { generation }

    public func setRequestHandler(_ handler: RequestHandler?) { requestHandler = handler }

    /// Launches the sidecar. No-op when it is already running.
    public func start() throws {
        guard transport == nil else { return }
        let t = makeTransport()
        let stream = try t.start()
        generation += 1
        let gen = generation
        transport = t
        stopping = false
        framer = NDJSONFramer()
        lastTermination = nil
        eventSink.yield(.started(generation: gen))
        Task { [weak self] in
            for await ev in stream { await self?.receive(ev, generation: gen) }
        }
    }

    /// Asks the sidecar to exit (app.shutdown, then stdin close, then SIGTERM, then SIGKILL).
    public func stop(grace: Duration = .seconds(3)) async {
        guard let t = transport else { return }
        stopping = true
        _ = try? await request(SidecarProtocol.Method.shutdown, timeout: grace)
        t.closeInput()
        if await waitForTermination(timeout: grace) == nil {
            t.terminate(force: false)
            if await waitForTermination(timeout: grace) == nil { t.terminate(force: true) }
        }
        _ = await waitForTermination(timeout: grace)
    }

    /// Stops the current sidecar (if any), launches a new one, and re-opens the last opened talk.
    @discardableResult
    public func restart() async throws -> SidecarProtocol.OpenResult? {
        await stop()
        try start()
        guard let last = lastOpen else { return nil }
        return try await call(SidecarProtocol.Method.open, last)
    }

    /// Kills the process without ceremony (tests, hung sidecar).
    public func kill() { transport?.terminate(force: true) }

    /// Waits until the current process is gone. Returns nil on timeout.
    public func waitForTermination(timeout: Duration) async -> SidecarTermination? {
        if transport == nil { return lastTermination }
        let key = UUID()
        let timer = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            if !Task.isCancelled { await self?.releaseWaiter(key) }
        }
        defer { timer.cancel() }
        return await withCheckedContinuation { terminationWaiters[key] = $0 }
    }

    // MARK: Requests

    /// Sends a request and waits for its result. Remote errors throw `SidecarError.remote`.
    public func request(_ method: String, params: JSONValue? = nil, timeout: Duration? = nil) async throws -> JSONValue {
        guard let t = transport else { throw SidecarError.notRunning }
        let id = nextId
        nextId += 1
        let line = try NDJSONFramer.encode(.request(id: id, method: method, params: params))
        let limit = timeout ?? requestTimeout
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<JSONValue, Error>) in
                let timer = Task { [weak self] in
                    try? await Task.sleep(for: limit)
                    if !Task.isCancelled { await self?.fail(id, SidecarError.timeout(method: method)) }
                }
                pending[id] = (method, cont, timer)
                do { try t.send(line) } catch { fail(id, SidecarError.notRunning) }
            }
        } onCancel: {
            Task { [weak self] in await self?.fail(id, CancellationError()) }
        }
    }

    /// Typed request: encodes `params`, decodes the result as `R`.
    public func call<P: Encodable & Sendable, R: Decodable & Sendable>(_ method: String, _ params: P, as: R.Type = R.self, timeout: Duration? = nil) async throws -> R {
        let raw = try await request(method, params: JSONValue.encoding(params), timeout: timeout)
        do { return try raw.decode(as: R.self) } catch { throw SidecarError.badResult(method: method, detail: "\(error)") }
    }

    public func call<R: Decodable & Sendable>(_ method: String, as: R.Type = R.self, timeout: Duration? = nil) async throws -> R {
        let raw = try await request(method, timeout: timeout)
        do { return try raw.decode(as: R.self) } catch { throw SidecarError.badResult(method: method, detail: "\(error)") }
    }

    /// Sends a notification (no reply).
    public func notify(_ method: String, params: JSONValue? = nil) throws {
        guard let t = transport else { throw SidecarError.notRunning }
        try t.send(NDJSONFramer.encode(.notification(method, params: params)))
    }

    // MARK: Typed methods

    public func ping() async throws -> SidecarProtocol.PingResult {
        try await call(SidecarProtocol.Method.ping)
    }

    public func open(_ path: URL, watch: Bool = true) async throws -> SidecarProtocol.OpenResult {
        let params = SidecarProtocol.OpenParams(path: path.path, watch: watch)
        let result: SidecarProtocol.OpenResult = try await call(SidecarProtocol.Method.open, params)
        lastOpen = params
        return result
    }

    public func close() async throws {
        let _: SidecarProtocol.Empty = try await call(SidecarProtocol.Method.close)
        lastOpen = nil
    }

    public func build() async throws -> SidecarProtocol.BuildResult {
        try await call(SidecarProtocol.Method.build, timeout: .seconds(120))
    }

    public func layout() async throws -> SidecarProtocol.LayoutResult {
        try await call(SidecarProtocol.Method.layout)
    }

    @discardableResult
    public func setWatching(_ enabled: Bool) async throws -> Bool {
        let r: SidecarProtocol.WatchResult = try await call(SidecarProtocol.Method.watch, SidecarProtocol.WatchParams(enabled: enabled))
        return r.watching
    }

    // MARK: Incoming

    private func receive(_ event: TransportEvent, generation gen: Int) {
        guard gen == generation else { return } // a previous process's tail after a restart
        switch event {
        case .data(let chunk):
            for line in framer.feed(chunk) { handleLine(line) }
        case .closed(var term):
            term.expected = stopping
            transport = nil
            lastTermination = term
            for (id, _) in pending { fail(id, SidecarError.terminated(term)) }
            releaseWaiters(term)
            eventSink.yield(.terminated(term))
        }
    }

    private func handleLine(_ line: Data) {
        guard let msg = try? JSONDecoder().decode(RPCMessage.self, from: line) else {
            FileHandle.standardError.write(Data("[SidecarClient] undecodable line: \(String(decoding: line.prefix(200), as: UTF8.self))\n".utf8))
            return
        }
        if let method = msg.method {
            if let id = msg.id { handleIncomingRequest(id: id, method: method, params: msg.params) }
            else { eventSink.yield(.notification(method: method, params: msg.params)) }
            return
        }
        guard let id = msg.id, let entry = pending.removeValue(forKey: id) else {
            if let e = msg.error { FileHandle.standardError.write(Data("[SidecarClient] sidecar error without request: \(e.code) \(e.message)\n".utf8)) }
            return
        }
        entry.timer.cancel()
        if let e = msg.error { entry.continuation.resume(throwing: SidecarError.remote(e)) }
        else { entry.continuation.resume(returning: msg.result ?? .object([:])) }
    }

    private func handleIncomingRequest(id: Int, method: String, params: JSONValue?) {
        let handler = requestHandler
        Task { [weak self] in
            var reply = RPCMessage(id: id)
            if let handler {
                do { reply.result = try await handler(method, params) }
                catch let e as RPCError { reply.error = e }
                catch { reply.error = RPCError(code: SidecarProtocol.ErrorCode.internalError, message: "\(error)") }
            } else {
                reply.error = RPCError(code: SidecarProtocol.ErrorCode.methodNotFound, message: "the app does not handle \(method)")
            }
            await self?.sendReply(reply)
        }
    }

    private func sendReply(_ msg: RPCMessage) {
        guard let t = transport, let data = try? NDJSONFramer.encode(msg) else { return }
        try? t.send(data)
    }

    private func fail(_ id: Int, _ error: Error) {
        guard let entry = pending.removeValue(forKey: id) else { return }
        entry.timer.cancel()
        entry.continuation.resume(throwing: error)
    }

    private func releaseWaiters(_ term: SidecarTermination?) {
        let waiters = terminationWaiters
        terminationWaiters.removeAll()
        for (_, w) in waiters { w.resume(returning: term) }
    }

    private func releaseWaiter(_ key: UUID) {
        terminationWaiters.removeValue(forKey: key)?.resume(returning: nil)
    }
}
