import Foundation
import Testing
@testable import SageTalkCore

/// tests/rpc/publish/*.json, the same files packages/sidecar/test/publish-protocol.test.ts checks:
/// each payload must round-trip through its PublishProtocol struct.
@Suite struct PublishProtocolTests {
    typealias P = PublishProtocol

    static let directory = RPCFixtures.directory.appendingPathComponent("publish")
    static let names: [String] = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
        .filter { $0.hasSuffix(".json") }.sorted()

    @Test func fixturesArePresent() {
        #expect(Self.names.count >= 20)
    }

    @Test(arguments: names)
    func payloadRoundTrips(_ name: String) throws {
        let data = try Data(contentsOf: Self.directory.appendingPathComponent(name))
        let message = try JSONDecoder().decode(RPCMessage.self, from: data)
        let original = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect(try JSONDecoder().decode(JSONValue.self, from: NDJSONFramer.encode(message)) == original)
        let (method, kind) = try #require(RPCFixtures.parse(name))
        switch (kind, method) {
        case (.request, P.Method.publish):
            if message.params != nil { try RPCFixtureTests.roundTrip(message.params, as: P.PublishParams.self) }
        case (.request, P.Method.export): try RPCFixtureTests.roundTrip(message.params, as: P.ExportParams.self)
        case (.request, P.Method.stage): try RPCFixtureTests.roundTrip(message.params, as: P.StageParams.self)
        case (.request, P.Method.commit): try RPCFixtureTests.roundTrip(message.params, as: P.CommitParams.self)
        case (.request, P.Method.qr): try RPCFixtureTests.roundTrip(message.params, as: P.QRParams.self)
        case (.response, P.Method.qr): try RPCFixtureTests.roundTrip(message.result, as: P.QRResult.self)
        case (.response, P.Method.publish): try RPCFixtureTests.roundTrip(message.result, as: P.PublishResult.self)
        case (.response, P.Method.export): try RPCFixtureTests.roundTrip(message.result, as: P.ExportResult.self)
        case (.response, P.Method.stage): try RPCFixtureTests.roundTrip(message.result, as: P.StageResult.self)
        case (.response, P.Method.commit): try RPCFixtureTests.roundTrip(message.result, as: P.CommitResult.self)
        case (.notification, P.Notification.exportProgress): try RPCFixtureTests.roundTrip(message.params, as: P.ExportProgress.self)
        case (.error, _):
            let e = try #require(message.error, "\(name) is not an error")
            #expect(P.ErrorCode.all.contains(e.code), "\(name): code \(e.code)")
        default: Issue.record("no typed struct for \(kind) \(method)")
        }
    }

    @Test func coversEveryMethodNotificationAndErrorCode() throws {
        let parsed = Self.names.compactMap(RPCFixtures.parse)
        for m in P.Method.all {
            #expect(parsed.contains { $0 == (m, .request) }, "\(m) request fixture")
            #expect(parsed.contains { $0 == (m, .response) }, "\(m) response fixture")
        }
        #expect(parsed.contains { $0 == (P.Notification.exportProgress, .notification) })
        var codes = Set<Int>()
        for name in Self.names where name.hasPrefix("error.") {
            if let e = try JSONDecoder().decode(RPCMessage.self, from: Data(contentsOf: Self.directory.appendingPathComponent(name))).error { codes.insert(e.code) }
        }
        #expect(codes == Set(P.ErrorCode.all))
    }

    @Test func holdSelectionEncodesAsTheWireDoes() throws {
        let all = try JSONValue.encoding(P.ExportParams(kind: .pdf, holds: .all))
        #expect(all == .object(["kind": .string("pdf"), "holds": .string("all")]))
        let some = try JSONValue.encoding(P.ExportParams(kind: .png, holds: .some([1, 3]), around: 0.5))
        #expect(some == .object(["kind": .string("png"), "holds": .array([.number(1), .number(3)]), "around": .number(0.5)]))
        #expect(try some.decode(as: P.ExportParams.self).holds == .some([1, 3]))
    }
}
