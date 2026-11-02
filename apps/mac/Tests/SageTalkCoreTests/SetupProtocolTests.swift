import Foundation
import Testing
@testable import SageTalkCore

/// tests/rpc/setup/*.json, the same files packages/sidecar/test/setup.test.ts checks: each
/// payload must round-trip through its SetupProtocol struct.
@Suite struct SetupProtocolTests {
    typealias S = SetupProtocol

    static let directory = RPCFixtures.directory.appendingPathComponent("setup")
    static let names: [String] = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
        .filter { $0.hasSuffix(".json") }.sorted()

    @Test func fixturesArePresent() {
        #expect(Self.names.count >= 8)
    }

    @Test(arguments: names)
    func payloadRoundTrips(_ name: String) throws {
        let data = try Data(contentsOf: Self.directory.appendingPathComponent(name))
        let message = try JSONDecoder().decode(RPCMessage.self, from: data)
        let original = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect(try JSONDecoder().decode(JSONValue.self, from: NDJSONFramer.encode(message)) == original)
        let (method, kind) = try #require(RPCFixtures.parse(name))
        switch (kind, method) {
        case (.request, S.Method.check):
            if message.params != nil { try RPCFixtureTests.roundTrip(message.params, as: S.CheckParams.self) }
        case (.request, S.Method.installBrowser): #expect(message.params == nil, "\(method) takes no params")
        case (.response, S.Method.check): try RPCFixtureTests.roundTrip(message.result, as: S.CheckResult.self)
        case (.response, S.Method.installBrowser): try RPCFixtureTests.roundTrip(message.result, as: S.InstallResult.self)
        case (.notification, S.Notification.progress): try RPCFixtureTests.roundTrip(message.params, as: S.ProgressParams.self)
        default: Issue.record("no typed struct for \(kind) \(method)")
        }
    }

    @Test func coversEveryMethodAndNotification() {
        let parsed = Self.names.compactMap(RPCFixtures.parse)
        for m in [S.Method.check, S.Method.installBrowser] {
            #expect(parsed.contains { $0 == (m, .request) }, "\(m) request fixture")
            #expect(parsed.contains { $0 == (m, .response) }, "\(m) response fixture")
        }
        #expect(parsed.contains { $0 == (S.Notification.progress, .notification) })
    }
}
