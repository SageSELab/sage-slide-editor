import Foundation
import Testing
@testable import SageTalkCore

/// tests/rpc/claude/*.json, the same files packages/sidecar/test/claude-protocol.test.ts checks:
/// each payload must round-trip through its ClaudeProtocol struct.
@Suite struct ClaudeProtocolTests {
    typealias C = ClaudeProtocol

    static let directory = RPCFixtures.directory.appendingPathComponent("claude")
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
        case (.request, C.Method.send): try RPCFixtureTests.roundTrip(message.params, as: C.SendParams.self)
        case (.request, C.AppRequest.ask): try RPCFixtureTests.roundTrip(message.params, as: C.AskParams.self)
        case (.request, C.AppRequest.goto): try RPCFixtureTests.roundTrip(message.params, as: C.GotoParams.self)
        case (.request, _): #expect(message.params == nil || message.params == .object([:]), "\(method) takes no params")
        case (.response, C.Method.send): try RPCFixtureTests.roundTrip(message.result, as: C.SendResult.self)
        case (.response, C.Method.interrupt): try RPCFixtureTests.roundTrip(message.result, as: C.InterruptResult.self)
        case (.response, C.Method.reset): try RPCFixtureTests.roundTrip(message.result, as: SidecarProtocol.Empty.self)
        case (.response, C.AppRequest.ask): try RPCFixtureTests.roundTrip(message.result, as: C.AskResult.self)
        case (.response, C.AppRequest.state): try RPCFixtureTests.roundTrip(message.result, as: C.StateResult.self)
        case (.response, C.AppRequest.goto): try RPCFixtureTests.roundTrip(message.result, as: C.GotoResult.self)
        case (.notification, C.Notification.status): try RPCFixtureTests.roundTrip(message.params, as: C.StatusParams.self)
        case (.notification, C.Notification.delta): try RPCFixtureTests.roundTrip(message.params, as: C.DeltaParams.self)
        case (.notification, C.Notification.tool): try RPCFixtureTests.roundTrip(message.params, as: C.ToolParams.self)
        case (.notification, C.Notification.result): try RPCFixtureTests.roundTrip(message.params, as: C.ResultParams.self)
        default: Issue.record("no typed struct for \(kind) \(method)")
        }
    }

    @Test func coversEveryMethodNotificationAndAppRequest() {
        let parsed = Self.names.compactMap(RPCFixtures.parse)
        for m in [C.Method.send, C.Method.interrupt, C.Method.reset, C.AppRequest.ask, C.AppRequest.state, C.AppRequest.goto] {
            #expect(parsed.contains { $0 == (m, .request) }, "\(m) request fixture")
            #expect(parsed.contains { $0 == (m, .response) }, "\(m) response fixture")
        }
        for n in C.Notification.all { #expect(parsed.contains { $0 == (n, .notification) }, "\(n) fixture") }
    }
}
