import AppKit
import SageTalkCore

// Editing (Phase 3, PLAN 5.3-5.4): edit mode on the canvas, the edits the canvas overlay and
// the inspector ask for, beat operations, undo/redo, and external changes. Every edit goes to
// the sidecar at once (talk.edit); the sidecar rebuilds and the canvas reloads at the same
// time with the same selection (filmBooted -> restoreEditing).
extension TalkWindowModel {
    var canEdit: Bool { talk?.kind == .beatFormat && filmURL != nil }

    // MARK: Edit mode

    func toggleEditMode() { setEditMode(!editMode) }

    func setEditMode(_ on: Bool) {
        guard on != editMode, !on || canEdit else { return }
        editMode = on
        if on {
            canvas.pause()
            Task { await restoreEditing() }
        } else {
            canvas.disableEditing()
            selection = nil
        }
    }

    /// (Re-)enables the overlay after a load and restores the selection without reporting it.
    func restoreEditing() async {
        guard editMode else { return }
        let id = selection?.id
        let obj = await canvas.enableEditing(select: id)
        guard editMode else { return }
        if id != nil { selection = obj } // nil when the object no longer exists
    }

    /// Selects an object on the canvas by id (inspector, self-test).
    func selectObject(_ id: String?) async {
        guard editMode else { return }
        selection = await canvas.canvasSelect(id, silent: true)
    }

    func forwardKey(_ name: String, otherwise: @escaping @MainActor (TalkWindowModel) -> Void) {
        guard editMode else { return otherwise(self) }
        Task {
            if !(await canvas.canvasKey(name)) { otherwise(self) }
        }
    }

    // MARK: Canvas messages

    func handleCanvas(_ msg: CanvasMessage) {
        switch msg {
        case .select(let obj): selection = obj
        case .refused(let id, _):
            status = "#\(id) has block content; edit its text in the source or ask Claude."
        default:
            if let op = msg.editOp { apply(op) }
        }
    }

    // MARK: Applying edits

    /// Sends an edit; the canvas reloads when the sidecar's rebuild arrives.
    func apply(_ op: EditOp) {
        Task { await applyNow(op) }
    }

    @discardableResult
    func applyNow(_ op: EditOp) async -> SidecarProtocol.EditResult? {
        let r = await edits.perform(op)
        if r == nil, let e = edits.lastError { error = e; reloadCanvas() } // drop the overlay's optimistic change
        return r
    }

    func undo() {
        if Self.textFieldHasFocus { NSApp.sendAction(Selector(("undo:")), to: nil, from: nil); return }
        Task { await undoNow() }
    }

    func redo() {
        if Self.textFieldHasFocus { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil); return }
        Task { await redoNow() }
    }

    @discardableResult
    func undoNow() async -> SidecarProtocol.EditResult? {
        let r = await edits.undo()
        if r == nil, let e = edits.lastError { error = e }
        return r
    }

    @discardableResult
    func redoNow() async -> SidecarProtocol.EditResult? {
        let r = await edits.redo()
        if r == nil, let e = edits.lastError { error = e }
        return r
    }

    /// A text field in the inspector is being edited: ⌘Z belongs to it.
    static var textFieldHasFocus: Bool {
        NSApp.keyWindow?.firstResponder is NSTextView
    }

    func editApplied(_ r: SidecarProtocol.EditResult) {
        error = r.ok ? nil : "Build failed after the edit: \(r.diagnostics.first(where: { $0.severity == .error })?.message ?? "see diagnostics")"
        if let wire = r.holds { holds = wire.map(\.hold) }
        if let s = r.stretch, !s.skipped.isEmpty {
            status = "Stretched \(s.stretched) calls; \(s.skipped.count) left alone (computed times or helpers)"
        }
        reloadSpine()
    }

    func reloadSpine() {
        guard let root = filmRoot else { return }
        let fresh = SpineSnapshot.load(root)
        if let fresh, let before = spineBeforeExternal {
            changedBeats.formUnion(SpineSnapshot.changedBeats(from: before, to: fresh))
            spineBeforeExternal = nil
        }
        spine = fresh ?? spine
        reloadMaterials()
    }

    /// Re-lists talk.json's materials (on open and whenever talk.json changes).
    func reloadMaterials() {
        guard let root = filmRoot else { materials = []; return }
        let fresh = Materials.load(talkRoot: root)
        if fresh != materials { materials = fresh }
    }

    /// Someone else changed the talk: the undo history no longer applies, and the beats the
    /// change touched get a badge.
    func externalChange(_ paths: [String]) {
        edits.externalChange()
        if let spine {
            changedBeats.formUnion(spine.beats(touching: paths))
            if paths.contains("talk.json") { spineBeforeExternal = spine }
        }
    }

    // MARK: The current beat and object

    /// The hold the canvas is at (its beat is what the Beat tab edits).
    var currentHold: Hold? { holds.first(where: { $0.id == selectedHold }) }

    var currentBeat: (ref: String, chapter: SpineSnapshot.Chapter, index: Int, beat: SpineSnapshot.Beat)? {
        guard let ref = currentHold?.beat, let (c, i, b) = spine?.locate(ref) else { return nil }
        return (ref, c, i, b)
    }

    /// The beat's hold relative to its start: explicit from talk.json, else as laid out.
    var currentRelativeHold: (value: Double, auto: Bool)? {
        guard let h = currentHold else { return nil }
        if let explicit = currentBeat?.beat.hold { return (explicit, false) }
        return InspectorFormat.relativeHolds(holds)[h.index].map { ($0, true) }
    }

    func setStyle(_ id: String, _ style: StyleArgs) { apply(.setStyle(id: id, style: style)) }

    // MARK: Beat operations (navigator menu)

    func beatOp(_ make: (String, SpineSnapshot) -> EditOp?, _ hold: Hold) {
        guard let ref = hold.beat, let spine, let op = make(ref, spine) else { return }
        apply(op)
    }
}
