import Foundation
import Testing
@testable import SageTalkCore

/// A fake sidecar: each edit/revert returns an inverse tagged with a counter, and records calls.
actor FakeEditService: EditService {
    typealias P = SidecarProtocol
    private(set) var calls: [String] = []
    private var n = 0
    /// Inverse tags talk.revert should refuse with EditConflict.
    var conflicting: Set<String> = []
    var failNextEdit: RPCError?

    func setConflicting(_ s: Set<String>) { conflicting = s }
    func setFailNextEdit(_ e: RPCError?) { failNextEdit = e }

    private func inverse(_ tag: String) -> P.Inverse {
        P.Inverse(patches: [P.WirePatch(file: "talk.json", range: [0, 1], newText: tag)], digests: ["talk.json": String(repeating: "a", count: 64)])
    }

    func edit(_ op: EditOp) async throws -> P.EditResult {
        calls.append("edit \(op.name)")
        if let e = failNextEdit { failNextEdit = nil; throw SidecarError.remote(e) }
        if case .setStyle(_, let s, _) = op, s == StyleArgs() { return P.EditResult(inverse: P.Inverse(), changed: []) }
        n += 1
        return P.EditResult(inverse: inverse("e\(n)"), changed: ["talk.json"])
    }

    func revert(_ inv: P.Inverse) async throws -> P.EditResult {
        let tag = inv.patches.first?.newText ?? ""
        calls.append("revert \(tag)")
        if conflicting.contains(tag) {
            throw SidecarError.remote(RPCError(code: P.ErrorCode.editConflict, message: "talk.json changed", data: .object(["files": .array([.string("talk.json")])])))
        }
        n += 1
        return P.EditResult(inverse: inverse("r\(n)"), changed: ["talk.json"])
    }
}

@MainActor @Suite struct EditSessionTests {
    func tag(_ e: UndoEntry?) -> String? { e?.inverse.patches.first?.newText }

    @Test func applyUndoRedo() async {
        let fake = FakeEditService()
        let s = EditSession(service: fake)
        var applied: [SidecarProtocol.EditResult] = []
        s.onApplied = { applied.append($0) }

        await s.perform(.setHold(ref: "line.title", hold: 5.5))
        await s.perform(.setStyle(id: "c1-eye", style: .px(left: 160, top: 110)))
        #expect(s.undoStack.map(\.title) == ["Set Hold", "Move"])
        #expect(s.undoTitle == "Undo Move" && !s.canRedo)

        await s.undo()
        #expect(s.undoStack.map(\.title) == ["Set Hold"])
        #expect(s.redoStack.map(\.title) == ["Move"])
        #expect(s.redoTitle == "Redo Move")
        await s.redo()
        #expect(s.undoStack.map(\.title) == ["Set Hold", "Move"] && s.redoStack.isEmpty)
        // the redo entry carried the revert's inverse; undoing again sends the redo's inverse
        await s.undo()
        await s.undo()
        #expect(!s.canUndo && s.redoStack.count == 2)
        #expect(await fake.calls == ["edit setHold", "edit setStyle", "revert e2", "revert r3", "revert r4", "revert e1"])
        #expect(applied.count == 6 && s.applied == 6)
    }

    @Test func aNewEditClearsRedo() async {
        let s = EditSession(service: FakeEditService())
        await s.perform(.setNotes(ref: "a.b", notes: "x"))
        await s.undo()
        #expect(s.canRedo)
        await s.perform(.setNotes(ref: "a.b", notes: "y"))
        #expect(!s.canRedo && s.undoStack.count == 1)
    }

    @Test func noOpEditsLeaveNoUndoEntry() async {
        let s = EditSession(service: FakeEditService())
        let r = await s.perform(.setStyle(id: "x", style: StyleArgs()))
        #expect(r?.changed == [] && !s.canUndo)
    }

    @Test func externalChangeClearsTheStacks() async {
        let s = EditSession(service: FakeEditService())
        await s.perform(.setHold(ref: "a.b", hold: 1))
        await s.perform(.setHold(ref: "a.b", hold: 2))
        await s.undo()
        #expect(s.canUndo && s.canRedo)
        s.externalChange()
        #expect(!s.canUndo && !s.canRedo)
        #expect(await s.undo() == nil)
    }

    @Test func conflictOnUndoClearsHistoryAndSaysWhy() async {
        let fake = FakeEditService()
        let s = EditSession(service: fake)
        await s.perform(.setText(id: "h", html: "x"))
        await s.perform(.setText(id: "h", html: "y"))
        await fake.setConflicting(["e2"])
        #expect(await s.undo() == nil)
        #expect(!s.canUndo && !s.canRedo)
        #expect(s.lastError?.contains("changed outside the app") == true)
        // the next successful edit clears the message
        await s.perform(.setText(id: "h", html: "z"))
        #expect(s.lastError == nil && s.undoStack.count == 1)
    }

    @Test func editFailuresKeepTheStackAndReportTheCoreMessage() async {
        let fake = FakeEditService()
        let s = EditSession(service: fake)
        await s.perform(.setHold(ref: "a.b", hold: 1))
        await fake.setFailNextEdit(RPCError(code: SidecarProtocol.ErrorCode.editFailed, message: "no element #x in any scene file"))
        #expect(await s.perform(.setText(id: "x", html: "y")) == nil)
        #expect(s.lastError == "Cannot edit: no element #x in any scene file")
        #expect(s.undoStack.count == 1)
    }

    @Test func editsRunInOrder() async {
        let fake = FakeEditService()
        let s = EditSession(service: fake)
        async let a: SidecarProtocol.EditResult? = s.perform(.setHold(ref: "a.b", hold: 1))
        async let b: SidecarProtocol.EditResult? = s.perform(.setNotes(ref: "a.b", notes: "n"))
        _ = await (a, b)
        await s.undo()
        let calls = await fake.calls
        #expect(calls.count == 3 && calls.last?.hasPrefix("revert") == true)
        #expect(s.undoStack.count == 1 && !s.busy)
    }

    @Test func withoutAServiceNothingHappens() async {
        let s = EditSession()
        #expect(await s.perform(.deleteBeat(ref: "a.b")) == nil)
        #expect(s.lastError != nil)
    }
}

@Suite struct InspectorTests {
    @Test func numbers() {
        #expect(InspectorFormat.number(120) == "120")
        #expect(InspectorFormat.number(120.5) == "120.5")
        #expect(InspectorFormat.number(0.25) == "0.25")
        #expect(InspectorFormat.number(13.499999) == "13.5")
        #expect(InspectorFormat.number(-3) == "-3")
        #expect(InspectorFormat.number(.nan) == "")
        #expect(InspectorFormat.seconds(5.5) == "5.5 s")
        for (text, v) in [("120", 120.0), (" 120.5 ", 120.5), ("120px", 120), ("1.5 s", 1.5), ("1,5", 1.5), ("1.25×", 1.25)] {
            #expect(InspectorFormat.parse(text) == v, "\(text)")
        }
        #expect(InspectorFormat.parse("abc") == nil && InspectorFormat.parse("") == nil)
    }

    @Test func notes() {
        #expect(InspectorFormat.wordCount("") == 0)
        #expect(InspectorFormat.wordCount("Thank you. I am Kevin — from UCF.") == 7)
        #expect(InspectorFormat.wordCount("  one\ntwo\tthree  ") == 3)
        #expect(InspectorFormat.notesSummary("") == "0 words")
        #expect(InspectorFormat.notesSummary("hello") == "1 word · about 0 s")
        #expect(InspectorFormat.notesSummary(Array(repeating: "w", count: 150).joined(separator: " ")) == "150 words · about 1 min")
        #expect(InspectorFormat.notesSummary(Array(repeating: "w", count: 50).joined(separator: " ")) == "50 words · about 20 s")
    }

    @Test func holds() {
        #expect(InspectorFormat.nudged(5, by: 0.1) == 5.1)
        #expect(InspectorFormat.nudged(0.05, by: -0.1) == 0)
        #expect(InspectorFormat.nudged(2.345, by: 0.5) == 2.85)
        let holds = [Hold(index: 1, at: 5, label: "A"), Hold(index: 2, at: 13.5, label: "B"), Hold(index: 3, at: 20.5, label: "C")]
        #expect(InspectorFormat.relativeHolds(holds) == [1: 5, 2: 8.5, 3: 7])
    }

    static let spine = """
    {"format":"sage-talk/1","title":"T","chapters":[
      {"id":"line","label":"The line","scene":"scenes/line.html","motion":"beats/line.js","beats":[
        {"id":"title","label":"Title","notes":"Hi.","hold":5},{"id":"beat","label":"B"},{"id":"beat-2","label":"C","backup":true}]},
      {"id":"omt","label":"OMT","dark":true,"private":true,"scene":"scenes/omt.html","beats":[{"id":"x","label":"X"}]}]}
    """

    static func snapshot(_ text: String = spine) throws -> SpineSnapshot {
        try JSONDecoder().decode(SpineSnapshot.self, from: Data(text.utf8))
    }

    @Test func spineSnapshot() throws {
        let s = try Self.snapshot()
        #expect(s.refs == ["line.title", "line.beat", "line.beat-2", "omt.x"])
        let (ch, i, b) = try #require(s.locate("line.beat"))
        #expect(ch.id == "line" && i == 1 && b.label == "B" && b.hold == nil)
        #expect(s.locate("omt.x")?.chapter.private == true && s.chapter("omt")?.dark == true)
        #expect(s.locate("nope.x") == nil && s.locate("line") == nil)
        #expect(s.beats(touching: ["scenes/omt.html"]) == ["omt.x"])
        #expect(s.beats(touching: ["beats/line.js"]) == ["line.title", "line.beat", "line.beat-2"])
        #expect(s.beats(touching: ["beats/omt.js"]) == ["omt.x"]) // the motion file by convention
        #expect(s.beats(touching: ["theme.css"]).isEmpty)
        let edited = try Self.snapshot(Self.spine.replacingOccurrences(of: #""label":"B""#, with: #""label":"B2""#)
            .replacingOccurrences(of: #"{"id":"x","label":"X"}"#, with: #"{"id":"x","label":"X"},{"id":"y","label":"Y"}"#))
        #expect(SpineSnapshot.changedBeats(from: s, to: edited) == ["line.beat", "omt.y"])
        #expect(SpineSnapshot.changedBeats(from: nil, to: edited).isEmpty)
    }

    @Test func beatOps() throws {
        let s = try Self.snapshot()
        #expect(BeatOps.insertAfter("line.title", in: s) == .insertBeat(chapter: "line", index: 1, beat: NewBeat(id: "beat-3", label: "New beat", hold: 2)))
        #expect(BeatOps.duplicate("line.title", in: s) == .duplicateBeat(ref: "line.title", newId: "title-2", label: "Title (copy)"))
        #expect(BeatOps.delete("omt.x", in: s) == .deleteBeat(ref: "omt.x"))
        #expect(BeatOps.move("line.title", by: -1, in: s) == nil)
        #expect(BeatOps.move("line.title", by: 1, in: s) == .moveBeat(ref: "line.title", chapter: "line", index: 1))
        #expect(BeatOps.move("line.beat-2", by: 1, in: s) == nil)
        #expect(BeatOps.move("line.beat-2", by: -1, in: s) == .moveBeat(ref: "line.beat-2", chapter: "line", index: 1))
        #expect(BeatOps.insertAfter("nope.x", in: s) == nil)
    }

    @Test func canvasMessages() {
        let select: [String: Any] = ["kind": "canvas", "type": "select", "id": "a", "tag": "div", "left": 100, "top": 100.5, "width": 200,
                                     "height": 100, "fontSize": 16, "movable": true, "editable": false, "html": NSNull(), "src": NSNull()]
        #expect(CanvasMessage.parse(select) == .select(CanvasObject(id: "a", left: 100, top: 100.5, width: 200, height: 100)))
        #expect(CanvasMessage.parse(["type": "select", "id": NSNull()]) == .select(nil))
        let move = CanvasMessage.parse(["type": "move", "id": "a", "left": 140, "top": 100])
        #expect(move == .move(id: "a", left: 140, top: 100))
        #expect(move?.editOp == .setStyle(id: "a", style: .px(left: 140, top: 100)))
        let resize = CanvasMessage.parse(["type": "resize", "id": "b", "left": 600, "top": 400, "width": 340, "height": 220])
        #expect(resize?.editOp == .setStyle(id: "b", style: .px(left: 600, top: 400, width: 340, height: 220)))
        #expect(resize?.editOp?.title == "Resize")
        #expect(CanvasMessage.parse(["type": "text", "id": "h", "html": "Hi <b>x</b>"])?.editOp == .setText(id: "h", html: "Hi <b>x</b>"))
        #expect(CanvasMessage.parse(["type": "refused", "id": "blk", "reason": "block-children"]) == .refused(id: "blk", reason: "block-children"))
        #expect(CanvasMessage.parse(["type": "move", "id": "a"]) == nil)
        #expect(CanvasMessage.parse(["kind": "ready"]) == nil)
    }

    @Test func canvasFormatMessages() {
        var select: [String: Any] = ["type": "select", "id": "t", "tag": "h1", "left": 0, "top": 0, "width": 900, "height": 120, "fontSize": 104,
                                     "movable": false, "editable": true, "html": "Hi", "src": NSNull()]
        select["rect"] = ["x": 120.5, "y": 80, "w": 450, "h": 60]
        select["text"] = ["bold": true, "italic": false, "underline": false, "color": "#ffffff", "align": "center", "family": "Manrope, sans-serif"]
        guard case .select(let o?) = CanvasMessage.parse(select) else { Issue.record("select"); return }
        #expect(o.rect == CanvasRect(x: 120.5, y: 80, w: 450, h: 60))
        #expect(o.text == CanvasTextInfo(bold: true, color: "#ffffff", align: "center", family: "Manrope, sans-serif"))

        let style = CanvasMessage.parse(["type": "style", "id": "t", "style": ["fontWeight": "400", "textDecoration": NSNull()]])
        #expect(style == .style(id: "t", style: StyleArgs(fontWeight: .set(.css("400")), textDecoration: .remove)))
        #expect(style?.editOp?.title == "Bold")
        #expect(CanvasMessage.parse(["type": "style", "id": "t", "style": ["fontSize": 72]])?.editOp == .setStyle(id: "t", style: .px(fontSize: 72)))
        #expect(CanvasMessage.parse(["type": "style", "id": "t", "style": [String: Any]()]) == nil)

        #expect(CanvasMessage.parse(["type": "editing", "id": "t"]) == .editing(id: "t"))
        #expect(CanvasMessage.parse(["type": "editing", "id": NSNull()]) == .editing(id: nil))
        #expect(CanvasMessage.parse(["type": "editing", "id": "t"])?.editOp == nil)
        let format = CanvasMessage.parse(["kind": "canvas", "type": "format", "id": "t", "bold": true, "italic": false, "underline": true, "color": "#ff2d78", "range": true])
        #expect(format == .format(CanvasTextState(id: "t", bold: true, underline: true, color: "#ff2d78", range: true)))
        #expect(CanvasMessage.parse(["type": "rect", "id": "t", "rect": ["x": 1, "y": 2, "w": 3, "h": 4]]) == .rect(id: "t", rect: CanvasRect(x: 1, y: 2, w: 3, h: 4)))
        #expect(CanvasFormat.fontSize(72).command == "fontSize" && CanvasFormat.bold.value == nil)
    }
}
