import Foundation
import Testing
@testable import SageTalkCore

@Suite struct NDJSONFramerTests {
    @Test func splitsCompleteLines() {
        var f = NDJSONFramer()
        let lines = f.feed(Data("{\"a\":1}\n{\"b\":2}\n".utf8))
        #expect(lines.map { String(decoding: $0, as: UTF8.self) } == ["{\"a\":1}", "{\"b\":2}"])
    }

    @Test func buffersPartialLinesAcrossChunks() {
        var f = NDJSONFramer()
        #expect(f.feed(Data("{\"a\":".utf8)).isEmpty)
        let lines = f.feed(Data("1}\r\n".utf8))
        #expect(lines.map { String(decoding: $0, as: UTF8.self) } == ["{\"a\":1}"])
    }

    @Test func keepsUTF8SplitAcrossChunksIntact() {
        var f = NDJSONFramer()
        let bytes = Array("{\"s\":\"é·\"}\n".utf8)
        let cut = 7 // inside the two-byte é
        #expect(f.feed(Data(bytes[..<cut])).isEmpty)
        let lines = f.feed(Data(bytes[cut...]))
        #expect(String(decoding: lines[0], as: UTF8.self) == "{\"s\":\"é·\"}")
    }

    @Test func skipsBlankLines() {
        var f = NDJSONFramer()
        #expect(f.feed(Data("\n\n".utf8)).isEmpty)
    }
}

@Suite struct RPCMessageTests {
    @Test func requestRoundTrips() throws {
        let m = RPCMessage.request(id: 7, method: "talk.open", params: .object(["path": .string("/x")]))
        let line = try NDJSONFramer.encode(m)
        #expect(line.last == 0x0A)
        let back = try JSONDecoder().decode(RPCMessage.self, from: line.dropLast())
        #expect(back == m)
        #expect(!back.isResponse)
    }

    @Test func decodesErrorResponse() throws {
        let json = #"{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"no such method"}}"#
        let m = try JSONDecoder().decode(RPCMessage.self, from: Data(json.utf8))
        #expect(m.isResponse)
        #expect(m.error == RPCError(code: -32601, message: "no such method"))
    }

    @Test func jsonValueDistinguishesBoolFromNumber() throws {
        let v = try JSONDecoder().decode(JSONValue.self, from: Data(#"[true, 1, "s", null, {"k": [false]}]"#.utf8))
        #expect(v == .array([.bool(true), .number(1), .string("s"), .null, .object(["k": .array([.bool(false)])])]))
    }
}

@Suite struct TalkFolderTests {
    @Test func parsesCPList() {
        let holds = Hold.parseCPList("1 5.0 Title\n2 13.5 Fifteen years\njunk\n3 20.5 Where it was measured")
        #expect(holds.map(\.at) == [5.0, 13.5, 20.5])
        #expect(holds[1].label == "Fifteen years")
    }

    @Test func detectsLegacyDeck() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        try Data().write(to: dir.appendingPathComponent("index.html"))
        try Data().write(to: dir.appendingPathComponent("talk.js"))
        let t = try TalkFolder(root: dir)
        #expect(t.kind == .legacy)
        #expect(t.filmURL(at: 12.5).query == "t=12.5&capture")
    }

    @Test func rejectsNonTalk() {
        let dir = FileManager.default.temporaryDirectory
        #expect(throws: TalkFolderError.self) { try TalkFolder(root: dir.appendingPathComponent("nope-\(UUID())")) }
    }
}
