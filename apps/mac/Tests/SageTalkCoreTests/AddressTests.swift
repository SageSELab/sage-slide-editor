import Foundation
import Testing
@testable import SageTalkCore

/// Element addresses (canvas drill-down into elements without an id): how the inspector names
/// them, which element an op edits, and talk.edit's `assigned` on the wire.
struct AddressTests {
    @Test func describesIdsAndAddresses() {
        #expect(CanvasObject.describe("c1-eye") == "#c1-eye")
        #expect(CanvasObject.describe("g1>div.t") == "div.t in #g1")
        #expect(CanvasObject.describe("c4>p.sub:1") == "p.sub in #c4")
        #expect(CanvasObject.describe("g1>div.mini>div.ico") == "div.ico in #g1")
    }

    @Test func elementOpsNameTheirElement() {
        #expect(EditOp.setText(id: "g1>div.t", html: "x").elementId == "g1>div.t")
        #expect(EditOp.setStyle(id: "a", style: .px(left: 1, top: 2)).elementId == "a")
        #expect(EditOp.setHold(ref: "line.title", hold: 2).elementId == nil)
    }

    @Test func decodesAssigned() throws {
        let json = #"{"inverse":{"patches":[],"digests":{}},"changed":["scenes/c4.html"],"ok":true,"diagnostics":[],"assigned":"g1-t"}"#
        let r = try JSONDecoder().decode(SidecarProtocol.EditResult.self, from: Data(json.utf8))
        #expect(r.assigned == "g1-t")
        let plain = try JSONDecoder().decode(SidecarProtocol.EditResult.self, from: Data(#"{"inverse":{"patches":[],"digests":{}},"changed":[],"ok":true,"diagnostics":[]}"#.utf8))
        #expect(plain.assigned == nil)
    }
}
