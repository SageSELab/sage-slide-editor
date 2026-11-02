import Foundation
import Testing
@testable import SageTalkCore

/// The same tests/rpc/*.json fixtures the sidecar's vitest suite validates (PLAN 12.5): each one
/// must decode into RPCMessage and re-encode to the same JSON, and its payload must round-trip
/// through the typed struct for its method, so a field renamed or added on either side fails.
enum RPCFixtures {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // SageTalkCoreTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // mac
        .deletingLastPathComponent() // apps
        .deletingLastPathComponent() // repo root
        .appendingPathComponent("tests/rpc")

    static let names: [String] = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
        .filter { $0.hasSuffix(".json") }
        .sorted()

    enum Kind: String { case request, response, notification, error }

    /// `talk.open.response.legacy.json` -> ("talk.open", .response); `error.not-a-talk.json` -> ("", .error)
    static func parse(_ name: String) -> (method: String, kind: Kind)? {
        let tokens = name.replacingOccurrences(of: ".json", with: "").split(separator: ".").map(String.init)
        guard let k = tokens.firstIndex(where: { Kind(rawValue: $0) != nil }) else { return nil }
        return (tokens[..<k].joined(separator: "."), Kind(rawValue: tokens[k])!)
    }

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name))
    }
}

@Suite struct RPCFixtureTests {
    typealias P = SidecarProtocol

    @Test func fixturesArePresent() {
        #expect(RPCFixtures.names.count > 20, "expected tests/rpc fixtures at \(RPCFixtures.directory.path)")
    }

    @Test(arguments: RPCFixtures.names)
    func roundTripsThroughRPCMessage(_ name: String) throws {
        let raw = try RPCFixtures.data(name)
        let original = try JSONDecoder().decode(JSONValue.self, from: raw)
        let message = try JSONDecoder().decode(RPCMessage.self, from: raw)
        let line = try NDJSONFramer.encode(message)
        #expect(line.last == 0x0A)
        #expect(!line.dropLast().contains(0x0A), "one message per line")
        let reencoded = try JSONDecoder().decode(JSONValue.self, from: line)
        #expect(reencoded == original)

        let (method, kind) = try #require(RPCFixtures.parse(name))
        switch kind {
        case .request:
            #expect(message.id != nil && message.method == method)
        case .notification:
            #expect(message.id == nil && message.method == method)
        case .response:
            #expect(message.isResponse && message.result != nil && message.error == nil)
        case .error:
            #expect(message.method == nil && message.result == nil && message.error != nil)
        }
    }

    @Test(arguments: RPCFixtures.names)
    func payloadRoundTripsThroughTypedStruct(_ name: String) throws {
        let message = try JSONDecoder().decode(RPCMessage.self, from: RPCFixtures.data(name))
        let (method, kind) = try #require(RPCFixtures.parse(name))
        switch kind {
        case .request:
            try Self.checkParams(method, message.params)
        case .response:
            try Self.checkResult(method, try #require(message.result))
        case .notification:
            switch method {
            case P.Notification.changed: try Self.roundTrip(message.params, as: P.ChangedParams.self)
            case P.Notification.built: try Self.roundTrip(message.params, as: P.BuiltParams.self)
            default: Issue.record("no typed struct for notification \(method)")
            }
        case .error:
            let e = try #require(message.error)
            let known = [P.ErrorCode.parseError, P.ErrorCode.invalidRequest, P.ErrorCode.methodNotFound, P.ErrorCode.invalidParams,
                         P.ErrorCode.internalError, P.ErrorCode.notATalk, P.ErrorCode.noTalkOpen, P.ErrorCode.unsupportedForKind,
                         P.ErrorCode.shuttingDown, P.ErrorCode.timeout]
            #expect(known.contains(e.code), "unknown error code \(e.code)")
        }
    }

    @Test func coversEveryMethodAndNotification() {
        let parsed = RPCFixtures.names.compactMap(RPCFixtures.parse)
        let methods = [P.Method.ping, P.Method.shutdown, P.Method.open, P.Method.close, P.Method.build, P.Method.layout, P.Method.watch]
        for m in methods {
            #expect(parsed.contains { $0 == (m, .request) }, "\(m) request fixture")
            #expect(parsed.contains { $0 == (m, .response) }, "\(m) response fixture")
        }
        for n in [P.Notification.changed, P.Notification.built] {
            #expect(parsed.contains { $0 == (n, .notification) }, "\(n) fixture")
        }
    }

    @Test func parseErrorKeepsNullId() throws {
        let message = try JSONDecoder().decode(RPCMessage.self, from: RPCFixtures.data("error.parse-error.json"))
        #expect(message.id == nil)
        let text = String(decoding: try NDJSONFramer.encode(message), as: UTF8.self)
        #expect(text.contains(#""id":null"#))
    }

    // MARK: helpers

    static func checkParams(_ method: String, _ params: JSONValue?) throws {
        switch method {
        case P.Method.open: try roundTrip(params, as: P.OpenParams.self)
        case P.Method.watch: try roundTrip(params, as: P.WatchParams.self)
        default:
            // Parameterless methods: absent, or an empty object.
            #expect(params == nil || params == .object([:]), "\(method) takes no params")
        }
    }

    static func checkResult(_ method: String, _ result: JSONValue) throws {
        switch method {
        case P.Method.ping: try roundTrip(result, as: P.PingResult.self)
        case P.Method.shutdown, P.Method.close: try roundTrip(result, as: P.Empty.self)
        case P.Method.open: try roundTrip(result, as: P.OpenResult.self)
        case P.Method.build: try roundTrip(result, as: P.BuildResult.self)
        case P.Method.layout: try roundTrip(result, as: P.LayoutResult.self)
        case P.Method.watch: try roundTrip(result, as: P.WatchResult.self)
        default: Issue.record("no typed struct for \(method) result")
        }
    }

    /// Decodes into `T` and re-encodes; equality catches fields Swift does not know about
    /// (Codable ignores them on decode) as well as fields it requires but the fixture lacks.
    static func roundTrip<T: Codable>(_ value: JSONValue?, as type: T.Type) throws {
        let v = try #require(value)
        let typed = try v.decode(as: T.self)
        #expect(try JSONValue.encoding(typed) == v, "\(T.self) does not round-trip")
    }
}
