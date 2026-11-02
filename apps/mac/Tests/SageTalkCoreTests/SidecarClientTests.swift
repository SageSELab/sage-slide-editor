import Foundation
import Testing
@testable import SageTalkCore

// MARK: - Fake transport

/// An in-memory sidecar. Tests script replies with `onRequest`, or push lines with `emit`.
final class FakeTransport: SidecarTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncStream<TransportEvent>.Continuation?
    private var _sent: [RPCMessage] = []
    private var _inputClosed = false
    /// Called for every message the client sends; return replies to emit (in order).
    var onRequest: @Sendable (RPCMessage) -> [RPCMessage] = { _ in [] }

    var sent: [RPCMessage] { lock.withLock { _sent } }
    var inputClosed: Bool { lock.withLock { _inputClosed } }

    func start() throws -> AsyncStream<TransportEvent> {
        let (stream, cont) = AsyncStream<TransportEvent>.makeStream()
        lock.withLock { continuation = cont }
        return stream
    }

    func send(_ data: Data) throws {
        guard lock.withLock({ continuation != nil && !_inputClosed }) else { throw SidecarError.notRunning }
        #expect(data.last == 0x0A)
        let msg = try JSONDecoder().decode(RPCMessage.self, from: data.dropLast())
        lock.withLock { _sent.append(msg) }
        for reply in onRequest(msg) { emit(reply) }
    }

    func emit(_ msg: RPCMessage) { emitRaw(String(decoding: try! NDJSONFramer.encode(msg), as: UTF8.self)) }
    func emitRaw(_ text: String) { _ = lock.withLock { continuation }?.yield(.data(Data(text.utf8))) }

    func exit(_ term: SidecarTermination) {
        let c = lock.withLock { () -> AsyncStream<TransportEvent>.Continuation? in defer { continuation = nil }; return continuation }
        c?.yield(.closed(term))
        c?.finish()
    }

    func closeInput() {
        lock.withLock { _inputClosed = true }
        exit(SidecarTermination(reason: .exit, status: 0))
    }

    func terminate(force: Bool) { exit(SidecarTermination(reason: .uncaughtSignal, status: force ? SIGKILL : SIGTERM)) }
}

/// Hands out a fresh FakeTransport per launch and remembers them.
final class FakeFactory: @unchecked Sendable {
    private let lock = NSLock()
    private var made: [FakeTransport] = []
    let configure: @Sendable (FakeTransport) -> Void
    init(_ configure: @escaping @Sendable (FakeTransport) -> Void = { _ in }) { self.configure = configure }
    var transports: [FakeTransport] { lock.withLock { made } }
    var last: FakeTransport { transports.last! }
    func make() -> any SidecarTransport {
        let t = FakeTransport()
        configure(t)
        lock.withLock { made.append(t) }
        return t
    }
}

/// Replies like the real sidecar for the methods the tests use.
@Sendable func scriptedSidecar(_ m: RPCMessage) -> [RPCMessage] {
    guard let id = m.id, let method = m.method else { return [] }
    let ok = { (r: JSONValue) in [RPCMessage(id: id, result: r)] }
    switch method {
    case "app.ping": return ok(["pong": true, "protocol": 1, "version": "0.0.0", "pid": 42])
    case "app.shutdown", "talk.close": return ok([:])
    case "talk.open":
        return ok(["kind": "beatFormat", "root": "/t", "filmURL": "file:///t/build/index.html",
                   "holds": [["index": 1, "at": 5, "label": "Title", "backup": false, "beat": "line.title", "chapter": "line", "auto": false]]])
    case "talk.layout": return [RPCMessage(id: id, error: RPCError(code: -32001, message: "no talk is open"))]
    default: return [RPCMessage(id: id, error: RPCError(code: -32601, message: "no such method: \(method)"))]
    }
}

extension JSONValue: ExpressibleByDictionaryLiteral, ExpressibleByArrayLiteral, ExpressibleByStringLiteral,
    ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral, ExpressibleByFloatLiteral {
    public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(uniqueKeysWithValues: elements)) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}

/// Collects client events in the background.
actor EventLog {
    private(set) var events: [SidecarEvent] = []
    func append(_ e: SidecarEvent) { events.append(e) }
    func first(where pred: @Sendable (SidecarEvent) -> Bool, timeout: Duration = .seconds(5)) async -> SidecarEvent? {
        let clock = ContinuousClock(), end = clock.now + timeout
        while clock.now < end {
            if let e = events.first(where: pred) { return e }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return nil
    }
    static func watching(_ client: SidecarClient) -> EventLog {
        let log = EventLog()
        Task { for await e in client.events { await log.append(e) } }
        return log
    }
}

// MARK: - Tests

@Suite struct SidecarClientTests {
    @Test func matchesResponsesById() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make)
        try await client.start()
        let t = f.last
        async let a = client.request("x.a")
        async let b = client.request("x.b")
        // Wait for both requests, then answer in reverse order.
        while t.sent.count < 2 { try await Task.sleep(for: .milliseconds(5)) }
        let ids = Dictionary(uniqueKeysWithValues: t.sent.map { ($0.method!, $0.id!) })
        t.emit(RPCMessage(id: ids["x.b"]!, result: "B"))
        t.emit(RPCMessage(id: ids["x.a"]!, result: "A"))
        let (ra, rb) = try await (a, b)
        #expect(ra == "A" && rb == "B")
        #expect(t.sent.allSatisfy { $0.jsonrpc == "2.0" })
    }

    @Test func typedCallsDecodeResults() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let client = SidecarClient(transport: f.make)
        try await client.start()
        let ping = try await client.ping()
        #expect(ping.pong && ping.protocol == SidecarProtocol.version)
        let open = try await client.open(URL(fileURLWithPath: "/t"))
        #expect(open.kind == .beatFormat)
        #expect(open.filmURL.path == "/t/build/index.html")
        #expect(open.holds?.map(\.hold) == [Hold(index: 1, at: 5, label: "Title")])
        let sentOpen = try #require(f.last.sent.last)
        #expect(sentOpen.params == ["path": "/t", "watch": true])
    }

    @Test func remoteErrorsThrow() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let client = SidecarClient(transport: f.make)
        try await client.start()
        await #expect(throws: SidecarError.remote(RPCError(code: -32001, message: "no talk is open"))) {
            _ = try await client.layout()
        }
    }

    @Test func requestsTimeOut() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make, requestTimeout: .milliseconds(50))
        try await client.start()
        await #expect(throws: SidecarError.timeout(method: "slow.thing")) { _ = try await client.request("slow.thing") }
        // A late reply for the timed-out id is ignored, and the client keeps working.
        f.last.emit(RPCMessage(id: f.last.sent[0].id!, result: [:]))
        f.last.onRequest = scriptedSidecar
        #expect(try await client.ping().pid == 42)
    }

    @Test func notRunningBeforeStart() async {
        let client = SidecarClient(transport: FakeFactory().make)
        await #expect(throws: SidecarError.notRunning) { _ = try await client.request("app.ping") }
    }

    @Test func surfacesNotificationsInOrder() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make)
        let log = EventLog.watching(client)
        try await client.start()
        // Two notifications split across chunks, the second mid-line.
        let changed = #"{"jsonrpc":"2.0","method":"talk.changed","params":{"paths":["scenes/line.html"],"source":"external"}}"#
        let built = #"{"jsonrpc":"2.0","method":"talk.built","params":{"diagnostics":[],"ms":40,"ok":true,"trigger":"change"}}"#
        f.last.emitRaw(changed + "\n" + built.prefix(30))
        f.last.emitRaw(built.dropFirst(30) + "\n")
        let e = await log.first { if case .notification("talk.built", _) = $0 { true } else { false } }
        #expect(e != nil)
        let notes = await log.events.compactMap { e -> (String, JSONValue?)? in
            if case let .notification(m, p) = e { (m, p) } else { nil }
        }
        #expect(notes.map(\.0) == ["talk.changed", "talk.built"])
        let p = try #require(notes[0].1).decode(as: SidecarProtocol.ChangedParams.self)
        #expect(p == .init(paths: ["scenes/line.html"], source: .external))
        #expect(await log.events.first == .started(generation: 1))
    }

    @Test func terminationFailsPendingAndIsReported() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make)
        let log = EventLog.watching(client)
        try await client.start()
        let crash = SidecarTermination(reason: .uncaughtSignal, status: SIGKILL)
        let r = Task { try await client.request("talk.build") }
        while f.last.sent.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        f.last.exit(crash)
        await #expect(throws: SidecarError.terminated(crash)) { _ = try await r.value }
        #expect(await log.first { $0 == .terminated(crash) } != nil)
        #expect(await client.isRunning == false)
        await #expect(throws: SidecarError.notRunning) { _ = try await client.request("app.ping") }
    }

    @Test func stopIsAnExpectedTermination() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let client = SidecarClient(transport: f.make)
        let log = EventLog.watching(client)
        try await client.start()
        await client.stop()
        #expect(f.last.sent.map(\.method) == ["app.shutdown"])
        #expect(f.last.inputClosed)
        let e = await log.first { if case .terminated = $0 { true } else { false } }
        guard case .terminated(let term) = e else { Issue.record("no termination"); return }
        #expect(term.expected)
    }

    @Test func restartLaunchesAFreshProcessAndReopens() async throws {
        let f = FakeFactory { $0.onRequest = scriptedSidecar }
        let client = SidecarClient(transport: f.make)
        let log = EventLog.watching(client)
        try await client.start()
        _ = try await client.open(URL(fileURLWithPath: "/t"))
        f.last.exit(SidecarTermination(reason: .uncaughtSignal, status: SIGKILL)) // crash
        _ = await log.first { if case .terminated = $0 { true } else { false } }
        let reopened = try await client.restart()
        #expect(reopened?.root == "/t")
        #expect(f.transports.count == 2)
        #expect(f.last.sent.map(\.method) == ["talk.open"])
        #expect(await client.launches == 2)
        #expect(await log.first { $0 == .started(generation: 2) } != nil)
        // The old process's late output is ignored.
        f.transports[0].emitRaw(#"{"jsonrpc":"2.0","method":"talk.changed","params":{"paths":["x"],"source":"external"}}"# + "\n")
        try await Task.sleep(for: .milliseconds(50))
        #expect(await !log.events.contains { if case .notification = $0 { true } else { false } })
    }

    @Test func answersRequestsFromTheSidecar() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make)
        try await client.start()
        f.last.emit(.request(id: 900, method: "app.ask", params: ["tool": "Write"]))
        while f.last.sent.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        #expect(f.last.sent[0] == RPCMessage(id: 900, error: RPCError(code: -32601, message: "the app does not handle app.ask")))

        await client.setRequestHandler { method, params in
            #expect(method == "app.ask")
            return ["allow": params == ["tool": "Write"] ? true : false]
        }
        f.last.emit(.request(id: 901, method: "app.ask", params: ["tool": "Write"]))
        while f.last.sent.count < 2 { try await Task.sleep(for: .milliseconds(5)) }
        #expect(f.last.sent[1] == RPCMessage(id: 901, result: ["allow": true]))
    }

    @Test func cancellationFailsTheRequest() async throws {
        let f = FakeFactory()
        let client = SidecarClient(transport: f.make)
        try await client.start()
        let task = Task { try await client.request("talk.build") }
        while f.last.sent.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
        task.cancel()
        await #expect(throws: CancellationError.self) { _ = try await task.value }
    }
}

// MARK: - Integration with the real sidecar

enum RealSidecar {
    static let repoRoot = RPCFixtures.directory.deletingLastPathComponent().deletingLastPathComponent()
    static let node = SidecarConfiguration.findNode()
    static var available: Bool {
        node != nil && FileManager.default.fileExists(atPath: repoRoot.appendingPathComponent("packages/sidecar/node_modules/tsx").path)
    }

    /// Beats in a talk.json (the fixture is still being ported, so the count is read, not hard-coded).
    static func beatCount(_ talk: URL) throws -> Int {
        struct Spine: Decodable { struct Chapter: Decodable { var beats: [JSONValue]? }; var chapters: [Chapter] }
        let spine = try JSONDecoder().decode(Spine.self, from: Data(contentsOf: talk.appendingPathComponent("talk.json")))
        return spine.chapters.reduce(0) { $0 + ($1.beats?.count ?? 0) }
    }

    /// A temp copy of fixtures/issta26 (never write into fixtures/).
    static func tempTalk() throws -> URL {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("sage-swift-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let dst = base.appendingPathComponent("issta26")
        try FileManager.default.copyItem(at: repoRoot.appendingPathComponent("fixtures/issta26"), to: dst)
        return dst
    }
}

@Suite(.serialized, .enabled(if: RealSidecar.available, "node or packages/sidecar/node_modules/tsx not found"))
struct SidecarIntegrationTests {
    @Test func opensAndLaysOutTheISSTAFixture() async throws {
        let talk = try RealSidecar.tempTalk()
        defer { try? FileManager.default.removeItem(at: talk.deletingLastPathComponent()) }
        let beatCount = try RealSidecar.beatCount(talk)
        let stderr = StderrSink()
        var config = SidecarConfiguration.development(repoRoot: RealSidecar.repoRoot, node: RealSidecar.node!)
        config.stderrHandler = { stderr.append($0) }
        config.requestTimeout = .seconds(30)
        let client = SidecarClient(configuration: config)
        let log = EventLog.watching(client)
        try await client.start()

        let ping = try await client.ping()
        #expect(ping.pong && ping.protocol == SidecarProtocol.version)

        let open = try await client.open(talk)
        #expect(open.kind == .beatFormat)
        #expect(open.build?.ok == true)
        #expect(open.holds?.count == beatCount)
        #expect(open.filmURL.lastPathComponent == "index.html")
        #expect(FileManager.default.fileExists(atPath: open.filmURL.path))

        let layout = try await client.layout()
        #expect(layout.holds.prefix(4).map(\.at) == [5, 13.5, 20.5, 27.5])
        #expect(layout.holds == open.holds)
        #expect(await log.first { if case .notification("talk.built", _) = $0 { true } else { false } } != nil)

        await #expect(throws: SidecarError.remote(RPCError(code: SidecarProtocol.ErrorCode.methodNotFound, message: "no such method: talk.nope"))) {
            _ = try await client.request("talk.nope")
        }

        // Crash and restart: the client sees the termination and re-opens the talk.
        await client.kill()
        let crashed = await log.first { if case .terminated = $0 { true } else { false } }
        guard case .terminated(let term) = crashed else { Issue.record("no termination after kill"); return }
        #expect(term == SidecarTermination(reason: .uncaughtSignal, status: SIGKILL, expected: false))
        let reopened = try await client.restart()
        #expect(reopened?.holds == open.holds)

        await client.stop()
        let stopped = await client.waitForTermination(timeout: .seconds(5))
        #expect(stopped == SidecarTermination(reason: .exit, status: 0, expected: true))
        #expect(stderr.text.contains("shutting down: app.shutdown"))
    }
}

final class StderrSink: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = ""
    func append(_ s: String) { lock.withLock { buffer += s } }
    var text: String { lock.withLock { buffer } }
}
