import AppKit
import SageTalkCore

/// The self-test's edit round trip (Phase 3) on a temp copy of the talk, with no edit mode:
/// the paused canvas is editable as soon as the talk opens. Select an object by a synthesized
/// click and drag it 40 px; click a headline twice to put the caret in it, retype it and leave
/// with Esc; check ⌘Z inside the text is the text's own; bold a range from the format bar; set
/// a hold from the inspector's code path; check that playing hides the overlay and pausing
/// brings it back; then undo all four edits, and check that every source file is
/// byte-identical to the start and the canvas shows the original again. Writes edit-moved.png,
/// edit-text.png, edit-bold.png, edit-hold.png, edit-undone.png, edit-window.png (the format
/// bar over the selected text) and edit.txt. Pointer and key events are synthesized inside the
/// web view; nothing takes focus.
extension SelfTest {
    static func editRoundTrip(model: TalkWindowModel, source: URL, out: URL) async {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-selftest-edit-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        let copy = base.appendingPathComponent("talk")
        guard (try? fm.createDirectory(at: base, withIntermediateDirectories: true)) != nil,
              (try? fm.copyItem(at: source, to: copy)) != nil else { check(false, "edit: copy the talk"); return }
        try? fm.removeItem(at: copy.appendingPathComponent(".sage"))
        try? fm.removeItem(at: copy.appendingPathComponent("build"))
        let start = sources(copy)
        var log: [String] = ["files \(start.count)"]
        defer { try? (log.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("edit.txt"), atomically: true, encoding: .utf8) }

        model.open(copy)
        let opened = await waitFor(seconds: 60) { model.canvas.info != nil && model.holds.count >= 2 && model.talk?.root == copy.standardizedFileURL && model.spine != nil }
        check(opened, "edit: temp copy opened")
        guard opened else { return }

        // No mode to turn on: at hold 2 (the chapter-1 eyebrow #c1-eye is visible there) the
        // paused canvas already has the overlay.
        let h2 = model.holds[1]
        model.select(h2.id)
        _ = await waitFor(seconds: 5) { abs(model.t - h2.at) < 1e-6 }
        let on = await waitForAsync(seconds: 10) { await overlayOn(model) }
        check(on, "edit: the paused canvas is editable with no mode to turn on (overlay present)")
        guard on else { return }

        // 1. Select #c1-eye by clicking it, then drag it 40 px right (Cmd held: no snapping).
        let ready0 = model.canvas.readyCount
        await press(model, "c1-eye")
        let selected = await waitFor(seconds: 5) { model.selection?.id == "c1-eye" }
        check(selected, "edit: a click on #c1-eye selected it (selection \(model.selection?.id ?? "none"), left \(model.selection.map { InspectorFormat.number($0.left) } ?? "-"))")
        let left0 = model.selection?.left ?? .nan
        await press(model, "c1-eye", dx: 40, meta: true)
        let moved = await waitForEdit(model, applied: 1, ready: ready0)
        let scene = copy.appendingPathComponent("scenes/line.html")
        let sceneText = (try? String(contentsOf: scene, encoding: .utf8)) ?? ""
        check(moved && sceneText.contains("id=\"c1-eye\" data-a style=\"position:absolute;left:\(InspectorFormat.number(left0 + 40))px;top:110px\""),
              "edit: dragging #c1-eye 40 px wrote left:\(InspectorFormat.number(left0 + 40))px into scenes/line.html")
        check(abs(model.canvas.t - h2.at) < 1e-6 && model.selection?.id == "c1-eye" && model.selection?.left == left0 + 40,
              "edit: after the move the canvas reloaded at t=\(h2.at) (t=\(model.canvas.t)) with #c1-eye still selected at left \(model.selection.map { InspectorFormat.number($0.left) } ?? "-")")
        log.append("move: left \(left0) -> \(model.selection?.left ?? .nan), undo \(model.edits.undoTitle)")
        await shot(model, out, "edit-moved.png")

        // 2. At hold 1, click the headline #t-g (selects it), click it again (the caret goes
        // in, Keynote-style, no mode and no double-click), retype it, and leave with Esc.
        let h1 = model.holds[0]
        model.select(h1.id)
        _ = await waitFor(seconds: 5) { abs(model.t - h1.at) < 1e-6 }
        let ready1 = model.canvas.readyCount
        await press(model, "t-g")
        _ = await waitFor(seconds: 5) { model.selection?.id == "t-g" }
        await press(model, "t-g")
        let caret = await waitFor(seconds: 5) { model.textEditing == "t-g" }
        let editable = (try? await model.canvas.call("return document.getElementById('t-g').getAttribute('contenteditable')") as? String) ?? ""
        check(caret && editable == "true" && model.selection?.id == "t-g",
              "edit: clicking the selected #t-g put the caret in its text with no mode (textEditing \(model.textEditing ?? "none"), contenteditable \(editable))")
        let newText = "How Far along are We?"
        _ = try? await model.canvas.call(replaceJS, ["id": "t-g", "text": newText])
        await key(model, "Escape")
        let left = await waitFor(seconds: 5) { model.textEditing == nil }
        let texted = await waitForEdit(model, applied: 2, ready: ready1)
        let sceneText2 = (try? String(contentsOf: scene, encoding: .utf8)) ?? ""
        check(left && texted && sceneText2.contains(">\(newText)</h1>"), "edit: Esc left text editing and saved '\(newText)' into the scene")
        let shows = (try? await model.canvas.call("return document.getElementById('t-g').textContent", [:]) as? String) ?? ""
        check(shows == newText && abs(model.canvas.t - h1.at) < 1e-6 && model.selection?.id == "t-g" && model.textEditing == nil,
              "edit: the canvas shows the new headline at t=\(h1.at) with #t-g still selected, caret gone (shows '\(shows)')")
        log.append("text: '\(shows)'")
        await shot(model, out, "edit-text.png")

        // 3. ⌘Z with the caret in the text undoes the typing, not the app's last edit.
        await press(model, "t-g")
        _ = await waitFor(seconds: 5) { model.textEditing == "t-g" }
        _ = try? await model.canvas.call("document.execCommand('insertText', false, '!!'); return true;")
        let typed = (try? await model.canvas.call("return document.getElementById('t-g').textContent") as? String) ?? ""
        model.undo()
        try? await Task.sleep(for: .milliseconds(300))
        let afterUndo = (try? await model.canvas.call("return document.getElementById('t-g').textContent") as? String) ?? ""
        check(typed.count == newText.count + 2 && typed.contains("!!") && afterUndo == newText && model.edits.undoStack.count == 2 && model.textEditing == "t-g",
              "edit: ⌘Z in canvas text undid the typing ('\(typed)' -> '\(afterUndo)'), the app's undo stack kept \(model.edits.undoStack.count) edits")
        await key(model, "Escape")
        _ = await waitFor(seconds: 5) { model.textEditing == nil }
        try? await Task.sleep(for: .milliseconds(400))
        check(model.edits.applied == 2, "edit: leaving unchanged text saved nothing (applied \(model.edits.applied))")
        await key(model, "Escape")
        let deselected = await waitFor(seconds: 5) { model.selection == nil }
        check(deselected, "edit: Esc again deselected")

        // 4. Bold "Junayed Mahmud" in the authors line from the format bar.
        let ready2 = model.canvas.readyCount
        await press(model, "t-au")
        _ = await waitFor(seconds: 5) { model.selection?.id == "t-au" }
        await press(model, "t-au")
        _ = await waitFor(seconds: 5) { model.textEditing == "t-au" }
        _ = try? await model.canvas.call(rangeJS, ["id": "t-au", "start": 0, "end": 14])
        _ = await waitFor(seconds: 5) { model.textState?.range == true }
        let barShown = await waitFor(seconds: 5) { model.formatBarAnchor != nil && model.formatTarget?.id == "t-au" }
        check(barShown, "edit: the format bar shows over the selected text (anchor \(model.formatBarAnchor.map { "\($0)" } ?? "none"))")
        model.format(.bold) // the format bar's B
        let boldOn = await waitFor(seconds: 5) { model.textState?.bold == true }
        check(boldOn, "edit: the format bar's B bolded the selected range in place (state \(model.textState.map { "\($0)" } ?? "none"))")
        await shot(model, out, "edit-bold.png")
        if let win = model.canvas.webView.window {
            model.rightPane = .inspector
            try? await Task.sleep(for: .milliseconds(400)) // let SwiftUI lay out the inspector and the bar
            await writeWindow(win, films: [model.canvas], to: out.appendingPathComponent("edit-window.png"))
        }
        await key(model, "Escape")
        let bolded = await waitForEdit(model, applied: 3, ready: ready2)
        let sceneText3 = (try? String(contentsOf: scene, encoding: .utf8)) ?? ""
        check(bolded && sceneText3.contains("\">" + "<b>Junayed Mahmud</b> · <b>Sparsh Pandey</b>"),
              "edit: Bold from the format bar wrote <b>Junayed Mahmud</b> into the scene")
        log.append("bold: \(sceneText3.contains("<b>Junayed Mahmud</b>"))")

        // 5. Set the title beat's hold from the inspector's code path.
        guard let beat = model.currentBeat, let rel = model.currentRelativeHold else { check(false, "edit: current beat for the hold"); return }
        let ready3 = model.canvas.readyCount
        let newHold = InspectorFormat.nudged(rel.value, by: 0.5)
        model.apply(.setHold(ref: beat.ref, hold: newHold))
        let held = await waitForEdit(model, applied: 4, ready: ready3)
        check(held && abs((model.holds.first?.at ?? 0) - newHold) < 1e-6 && model.spine?.locate(beat.ref)?.beat.hold == newHold,
              "edit: setHold \(beat.ref) \(rel.value) -> \(newHold) moved hold 1 to \(model.holds.first?.at ?? 0)")
        check(model.edits.undoStack.map(\.title) == ["Move", "Edit Text", "Edit Text", "Set Hold"], "edit: undo stack \(model.edits.undoStack.map(\.title))")
        log.append("hold: \(rel.value) -> \(newHold); stack \(model.edits.undoStack.map(\.title))")
        await shot(model, out, "edit-hold.png")

        // 6. Play hides the overlay; pausing brings it back, keeping the selection if it shows.
        if model.selection?.id != "t-au" { await press(model, "t-au") }
        _ = await waitFor(seconds: 5) { model.selection?.id == "t-au" }
        model.next() // the transport's Play button
        let hidden = await waitForAsync(seconds: 3) { await overlayState(model) == "suspended" }
        let barGone = await waitFor(seconds: 3) { model.formatBarAnchor == nil }
        check(hidden && barGone, "edit: Play hid the overlay and the format bar (overlay \(await overlayState(model)), playing \(model.playing))")
        model.canvas.pause()
        let back = await waitForAsync(seconds: 3) { await overlayState(model) == "shown" }
        try? await Task.sleep(for: .milliseconds(300))
        let stillShows = (try? await model.canvas.call("return SageCanvas.visible(document.getElementById('t-au'))") as? Bool) ?? false
        check(back && model.selection?.id == (stillShows ? "t-au" : nil),
              "edit: pausing brought the overlay back at t=\(InspectorFormat.number(model.t)) (selection \(model.selection?.id ?? "none"), #t-au \(stillShows ? "shows" : "hidden"))")
        model.select(h1.id)
        _ = await waitFor(seconds: 5) { abs(model.t - model.holds[0].at) < 1e-6 }

        // 7. Undo all four.
        for i in 0..<4 {
            let ready = model.canvas.readyCount
            let r = await model.undoNow()
            let ok = r != nil
            let reloaded = await waitFor(seconds: 30) { model.canvas.readyCount > ready && !model.edits.busy }
            log.append("undo \(i + 1): \(ok ? "ok" : model.edits.lastError ?? "failed"), reloaded \(reloaded)")
            if !ok { break }
        }
        try? await Task.sleep(for: .milliseconds(500))
        let end = sources(copy)
        let differing = Set(start.keys).union(end.keys).filter { start[$0] != end[$0] }.sorted()
        check(differing.isEmpty, "edit: after four undos every source file is byte-identical to the start (\(differing.isEmpty ? "\(end.count) files" : "differ: \(differing.joined(separator: ", "))"))")
        check(!model.edits.canUndo && model.edits.redoStack.count == 4, "edit: undo stack empty, redo stack \(model.edits.redoStack.map(\.title))")

        // The canvas shows the original: the headline at hold 1, #c1-eye back at its old left.
        _ = await waitForAsync(seconds: 5) { await overlayOn(model) }
        let title = (try? await model.canvas.call("return document.getElementById('t-g').textContent", [:]) as? String) ?? ""
        let eyeLeft = (try? await model.canvas.call("return getComputedStyle(document.getElementById('c1-eye')).left", [:]) as? String) ?? ""
        let authors = (try? await model.canvas.call("return document.getElementById('t-au').innerHTML.startsWith('Junayed Mahmud ·')", [:]) as? Bool) ?? false
        check(title == "How Far are We?" && eyeLeft == "\(InspectorFormat.number(left0))px" && authors && abs((model.holds.first?.at ?? 0) - h1.at) < 1e-6,
              "edit: the canvas shows the original (headline '\(title)', #c1-eye left \(eyeLeft), authors unbolded \(authors), hold 1 at \(model.holds.first?.at ?? 0))")
        await shot(model, out, "edit-undone.png")
    }

    /// Waits until the edit pipeline has applied `applied` edits in total and the canvas has
    /// reloaded since `ready` with the overlay back on.
    private static func waitForEdit(_ model: TalkWindowModel, applied: Int, ready: Int) async -> Bool {
        let ok = await waitFor(seconds: 30) { model.edits.applied >= applied && model.canvas.readyCount > ready && !model.edits.busy }
        _ = await waitForAsync(seconds: 5) { await overlayOn(model) }
        try? await Task.sleep(for: .milliseconds(300))
        return ok && model.edits.lastError == nil
    }

    private static func overlayOn(_ model: TalkWindowModel) async -> Bool {
        (try? await model.canvas.call("return !!(window.SageCanvas && SageCanvas.on && document.querySelector('.sage-canvas-overlay'))", [:]) as? Bool) ?? false
    }

    /// "shown", "suspended" (the film plays: the overlay is hidden) or "off".
    private static func overlayState(_ model: TalkWindowModel) async -> String {
        let js = "const o = document.querySelector('.sage-canvas-overlay'); if (!window.SageCanvas || !SageCanvas.on || !o) return 'off'; return SageCanvas.suspended && o.style.display === 'none' ? 'suspended' : !SageCanvas.suspended && o.style.display !== 'none' ? 'shown' : 'mixed';"
        return (try? await model.canvas.call(js) as? String) ?? "off"
    }

    private static func waitForAsync(seconds: Double, _ cond: () async -> Bool) async -> Bool {
        let clock = ContinuousClock(), end = clock.now + .milliseconds(Int(seconds * 1000))
        while clock.now < end {
            if await cond() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return await cond()
    }

    private static func shot(_ model: TalkWindowModel, _ out: URL, _ name: String) async {
        if let img = try? await model.canvas.snapshot(width: 960) { write(img, to: out.appendingPathComponent(name)) }
    }

    /// A press on #id (and, with dx/dy, a drag), synthesized as pointer events in the page.
    private static func press(_ model: TalkWindowModel, _ id: String, dx: Double = 0, dy: Double = 0, meta: Bool = false) async {
        _ = try? await model.canvas.call(pointerJS, ["id": id, "dx": dx, "dy": dy, "meta": meta])
        try? await Task.sleep(for: .milliseconds(150))
    }

    /// A key pressed in the page (the canvas listens on the window).
    private static func key(_ model: TalkWindowModel, _ name: String) async {
        _ = try? await model.canvas.call("(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); return true;", ["name": name])
    }

    /// Source files of a talk (build/ and .sage/ left out), by relative path.
    static func sources(_ root: URL) -> [String: Data] {
        var out: [String: Data] = [:]
        let fm = FileManager.default
        guard let e = fm.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]) else { return out }
        let prefix = root.standardizedFileURL.path + "/"
        for case let url as URL in e {
            let rel = url.standardizedFileURL.path.replacingOccurrences(of: prefix, with: "")
            if rel.hasPrefix("build") || rel.hasPrefix(".sage") { e.skipDescendants(); continue }
            if (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true { out[rel] = try? Data(contentsOf: url) }
        }
        return out
    }

    /// A press (and, with dx/dy, a drag) on #id, synthesized as pointer events in the page.
    private static let pointerJS = """
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const k = document.querySelector('.stage').getBoundingClientRect().width / 1920;
    const x = r.left + Math.min(20, r.width / 2), y = r.top + Math.min(r.height / 2, 16 * k);
    const target = document.elementFromPoint(x, y) || el;
    const ev = (type, cx, cy) => new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true, metaKey: meta, pointerId: 1, isPrimary: true });
    target.dispatchEvent(ev('pointerdown', x, y));
    for (let i = 1; i <= 4 && (dx || dy); i++) target.dispatchEvent(ev('pointermove', x + dx * k * i / 4, y + dy * k * i / 4));
    target.dispatchEvent(ev('pointerup', x + dx * k, y + dy * k));
    return true;
    """

    /// Replaces the text being edited as typing would (select all of it, insert).
    private static let replaceJS = """
    const el = document.getElementById(id);
    const s = getSelection(); const range = document.createRange(); range.selectNodeContents(el); s.removeAllRanges(); s.addRange(range);
    if (!document.execCommand('insertText', false, text)) el.textContent = text;
    return true;
    """

    /// Selects [start, end) of #id's first text node (as a drag across the words would).
    private static let rangeJS = """
    const t = document.getElementById(id).firstChild;
    const r = document.createRange(); r.setStart(t, start); r.setEnd(t, end);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    return true;
    """
}
