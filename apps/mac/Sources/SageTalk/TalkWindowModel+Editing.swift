import AppKit
import SageTalkCore

// Editing (Phase 3, PLAN 5.3-5.4): the canvas overlay, the edits it and the inspector ask
// for, the format bar, beat operations, undo/redo, and external changes. There is no edit
// mode: on a beat-format talk the canvas is editable whenever the film is paused (the overlay
// steps aside by itself while it plays) and never while presenting. Every edit goes to the
// sidecar at once (talk.edit); the sidecar rebuilds. An edit the canvas made itself (it is
// already on screen) does not reload the canvas; any other edit reloads it with the same
// selection (filmBooted -> restoreEditing).
extension TalkWindowModel {
    var canEdit: Bool { talk?.kind == .beatFormat && filmURL != nil }

    /// The canvas takes clicks and keys for editing now (paused, not presenting).
    var canvasEditable: Bool { canEdit && !playing && !presentation.isPresenting }

    // MARK: The overlay

    /// (Re-)enables the overlay after a load and restores the selection without reporting it.
    func restoreEditing() async {
        guard canEdit, !presentation.isPresenting else { return }
        let id = selection?.id
        textEditing = nil; textState = nil // a reload ends text editing
        let obj = await canvas.enableEditing(select: id)
        guard canEdit, !presentation.isPresenting else { return }
        if id != nil { selection = obj } // nil when the object no longer exists
    }

    /// Presenting never shows the overlay: save any text being edited, then take it away.
    func suspendEditingForPresenting() {
        guard canEdit else { return }
        Task {
            await saveCanvasText()
            canvas.disableEditing()
            selection = nil; textEditing = nil; textState = nil
        }
    }

    /// The presentation ended at `t`: the canvas goes there and is editable again.
    func presentingEnded(at t: Double) {
        canvas.seek(t)
        Task { await restoreEditing() }
    }

    /// Selects an object on the canvas by id (inspector, self-test).
    func selectObject(_ id: String?) async {
        guard canEdit else { return }
        selection = await canvas.canvasSelect(id, silent: true)
    }

    func forwardKey(_ name: String, otherwise: @escaping @MainActor (TalkWindowModel) -> Void) {
        guard canvasEditable else { return otherwise(self) }
        Task {
            if !(await canvas.canvasKey(name)) { otherwise(self) }
        }
    }

    // MARK: Canvas messages

    func handleCanvas(_ msg: CanvasMessage) {
        switch msg {
        case .select(let obj):
            selection = obj
            if obj?.id != textEditing { textEditing = nil; textState = nil }
        case .rect(let id, let rect):
            if selection?.id == id { selection?.rect = rect }
        case .editing(let id):
            // ⌘Z inside the text undoes this session's typing only: the page's editing history
            // (kept now that the canvas's own edits do not reload it) starts fresh each time.
            canvas.webView.undoManager?.removeAllActions()
            textEditing = id
            if id == nil { textState = nil }
        case .format(let state):
            if state.id == textEditing { textState = state }
        case .refused(let id, _):
            status = "\(CanvasObject.describe(id)) holds other blocks: click it again to select the text inside, or double-click the text."
        default:
            if let op = msg.editOp { Task { await applyNow(op, fromCanvas: true) } }
        }
    }

    // MARK: Applying edits

    /// Sends an edit; the canvas reloads when the sidecar's rebuild arrives.
    func apply(_ op: EditOp) {
        Task { await applyNow(op) }
    }

    /// `fromCanvas`: the canvas made this change itself and already shows it, so its rebuild
    /// does not reload the canvas.
    @discardableResult
    func applyNow(_ op: EditOp, fromCanvas: Bool = false) async -> SidecarProtocol.EditResult? {
        await saveCanvasText()
        return await perform(op, fromCanvas: fromCanvas)
    }

    private func perform(_ op: EditOp, fromCanvas: Bool) async -> SidecarProtocol.EditResult? {
        if fromCanvas { canvasEditsInFlight += 1 }
        let r = await edits.perform(op)
        if fromCanvas { canvasEditsInFlight -= 1 }
        if r == nil, let e = edits.lastError { error = e; reloadCanvas() } // drop the overlay's optimistic change
        if let r { await adoptAssigned(op, r) }
        // No reload brings the selection's new box: read it back (the inspector shows it).
        if fromCanvas, r != nil, let id = selection?.id, let fresh = await canvas.canvasSelect(id, silent: true), fresh.id == selection?.id {
            selection = fresh
        }
        return r
    }

    /// The edit gave an element without an id one (`assigned`): the canvas element takes it
    /// and the selection follows, so later edits name it by its id.
    private func adoptAssigned(_ op: EditOp, _ r: SidecarProtocol.EditResult) async {
        guard let new = r.assigned, let old = op.elementId, old != new else { return }
        await canvas.canvasAdopt(old, new)
        if selection?.id == old { selection?.id = new }
        if textEditing == old { textEditing = new }
    }

    /// Text being edited in place is saved before any other edit (whose rebuild reloads the
    /// canvas and would lose it).
    func saveCanvasText() async {
        guard textEditing != nil else { return }
        let msg = await canvas.takeCanvasText()
        textEditing = nil; textState = nil
        if let op = msg?.editOp { _ = await perform(op, fromCanvas: true) }
    }

    func undo() {
        if Self.textFieldHasFocus { NSApp.sendAction(Selector(("undo:")), to: nil, from: nil); return }
        // The caret is in canvas text: ⌘Z belongs to the text until it is committed.
        if textEditing != nil { if let um = canvas.webView.undoManager, um.canUndo { um.undo() }; return }
        Task { await undoNow() }
    }

    func redo() {
        if Self.textFieldHasFocus { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil); return }
        if textEditing != nil { if let um = canvas.webView.undoManager, um.canRedo { um.redo() }; return }
        Task { await redoNow() }
    }

    // MARK: The format bar

    /// The object the format bar and the inspector's text controls act on.
    var formatTarget: CanvasObject? {
        guard let o = selection, o.editable, canEdit, !presentation.isPresenting else { return nil }
        return o
    }

    /// The format bar's toggles: the selected range's state while editing one, else the element's.
    var formatState: (bold: Bool, italic: Bool, underline: Bool, color: String) {
        if let s = textState, s.range, s.id == formatTarget?.id { return (s.bold, s.italic, s.underline, s.color) }
        let t = formatTarget?.text ?? CanvasTextInfo()
        return (t.bold, t.italic, t.underline, t.color)
    }

    /// Applies a format command: to the selected text range in place while editing one (saved
    /// with the text), otherwise to the whole object (setStyle, through the canvas's `style`
    /// message, which saves any text being edited first).
    func format(_ f: CanvasFormat) {
        guard formatTarget != nil else { return }
        Task { await canvas.canvasFormat(f) }
    }

    /// A colour from the colour well: the panel reports every change while dragging, so only
    /// the last one in a quarter second is applied.
    func formatColor(_ hex: String) {
        pendingColor?.cancel()
        pendingColor = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.format(.color(hex))
        }
    }

    /// The Font button's hook: whoever provides a font picker sets `onPickFont` and applies the
    /// choice with `applyFont(_:)`.
    var canPickFont: Bool { onPickFont != nil }

    func pickFont(for object: CanvasObject) {
        onPickFont?(object)
    }

    /// Sets the selected object's font family (a CSS font-family value, e.g. `"Inter Tight", sans-serif`).
    func applyFont(_ family: String) { format(.fontFamily(family)) }

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
