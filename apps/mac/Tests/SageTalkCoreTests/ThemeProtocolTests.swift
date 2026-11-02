import Foundation
import Testing
@testable import SageTalkCore

/// tests/rpc/themes/*.json, the same files packages/sidecar/test/themes-protocol.test.ts checks:
/// each payload must round-trip through its ThemeProtocol struct. The built-in themes' theme.json
/// files must decode too.
@Suite struct ThemeProtocolTests {
    typealias P = ThemeProtocol

    static let directory = RPCFixtures.directory.appendingPathComponent("themes")
    static let names: [String] = ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
        .filter { $0.hasSuffix(".json") }.sorted()

    @Test func fixturesArePresent() {
        #expect(Self.names.count >= 16)
    }

    @Test(arguments: names)
    func payloadRoundTrips(_ name: String) throws {
        let data = try Data(contentsOf: Self.directory.appendingPathComponent(name))
        let message = try JSONDecoder().decode(RPCMessage.self, from: data)
        let original = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect(try JSONDecoder().decode(JSONValue.self, from: NDJSONFramer.encode(message)) == original)
        let (method, kind) = try #require(RPCFixtures.parse(name))
        switch (kind, method) {
        case (.request, P.Method.validate): try RPCFixtureTests.roundTrip(message.params, as: P.ValidateParams.self)
        case (.request, P.Method.save): try RPCFixtureTests.roundTrip(message.params, as: P.SaveParams.self)
        case (.request, P.Method.apply): try RPCFixtureTests.roundTrip(message.params, as: P.ApplyParams.self)
        case (.request, P.Method.extract):
            if message.params != nil { try RPCFixtureTests.roundTrip(message.params, as: P.ExtractParams.self) }
        case (.request, P.Method.searchFonts): try RPCFixtureTests.roundTrip(message.params, as: P.FontsSearchParams.self)
        case (.request, P.Method.addFont): try RPCFixtureTests.roundTrip(message.params, as: P.FontsAddParams.self)
        case (.request, P.Method.listFonts): #expect(message.params == nil)
        case (.response, P.Method.validate): try RPCFixtureTests.roundTrip(message.result, as: P.ValidateResult.self)
        case (.response, P.Method.save): try RPCFixtureTests.roundTrip(message.result, as: P.SaveResult.self)
        case (.response, P.Method.apply): try RPCFixtureTests.roundTrip(message.result, as: P.ApplyResult.self)
        case (.response, P.Method.extract): try RPCFixtureTests.roundTrip(message.result, as: P.ExtractResult.self)
        case (.response, P.Method.searchFonts): try RPCFixtureTests.roundTrip(message.result, as: P.FontsSearchResult.self)
        case (.response, P.Method.addFont): try RPCFixtureTests.roundTrip(message.result, as: P.FontsAddResult.self)
        case (.response, P.Method.listFonts): try RPCFixtureTests.roundTrip(message.result, as: P.FontsListResult.self)
        case (.error, _):
            let e = try #require(message.error, "\(name) is not an error")
            #expect(P.ErrorCode.all.contains(e.code), "\(name): code \(e.code)")
        default: Issue.record("no typed struct for \(kind) \(method)")
        }
    }

    @Test func coversEveryMethodAndErrorCode() throws {
        let parsed = Self.names.compactMap(RPCFixtures.parse)
        for m in P.Method.all {
            #expect(parsed.contains { $0 == (m, .request) }, "\(m) request fixture")
            #expect(parsed.contains { $0 == (m, .response) }, "\(m) response fixture")
        }
        var codes = Set<Int>()
        for name in Self.names where name.hasPrefix("error.") {
            if let e = try JSONDecoder().decode(RPCMessage.self, from: Data(contentsOf: Self.directory.appendingPathComponent(name))).error { codes.insert(e.code) }
        }
        #expect(codes == Set(P.ErrorCode.all))
    }

    static let builtins = RPCFixtures.directory.deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("skill/academic-talk-film/assets/themes")

    @Test func builtInThemesDecodeAndRoundTrip() throws {
        let names = try FileManager.default.contentsOfDirectory(atPath: Self.builtins.path).filter { $0.hasSuffix(".talktheme") }.sorted()
        #expect(names == ["contrast.talktheme", "paper.talktheme", "sage.talktheme", "slate.talktheme"])
        for n in names {
            let data = try Data(contentsOf: Self.builtins.appendingPathComponent(n).appendingPathComponent("theme.json"))
            let theme = try JSONDecoder().decode(P.Theme.self, from: data)
            #expect(theme.format == P.format)
            #expect("\(theme.id).talktheme" == n)
            let back = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(theme))
            #expect(back == (try JSONDecoder().decode(JSONValue.self, from: data)), "\(n) round-trips")
        }
    }
}
