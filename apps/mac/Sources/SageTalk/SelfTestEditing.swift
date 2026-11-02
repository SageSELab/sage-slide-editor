import AppKit
import SageTalkCore

/// The self-test's edit round trip (Phase 3) on a temp copy of the talk: select an object on the
/// canvas by a synthesized click, drag it 40 px, edit a headline in place, set a hold from the
/// inspector's code path, then undo all three, and check that every source file is
/// byte-identical to the start and the canvas shows the original again. Writes
/// edit-moved.png, edit-text.png, edit-hold.png, edit-undone.png, edit-window.png and
/// edit.txt. Pointer and key events are synthesized inside the web view; nothing takes focus.
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

        // Edit mode, at hold 2 (the chapter-1 eyebrow #c1-eye is visible there).
        let h2 = model.holds[1]
        model.select(h2.id)
        _ = await waitFor(seconds: 5) { abs(model.t - h2.at) < 1e-6 }
        model.setEditMode(true)
        let on = await waitForAsync(seconds: 10) { model.editMode ? await overlayOn(model) : false }
        check(on, "edit: edit mode put the overlay on the canvas")
        guard on else { return }

        // 1. Select #c1-eye by clicking it, then drag it 40 px right (Cmd held: no snapping).
        let ready0 = model.canvas.readyCount
        _ = try? await model.canvas.call(pointerJS, ["id": "c1-eye", "dx": 0, "dy": 0, "meta": false])
        let selected = await waitFor(seconds: 5) { model.selection?.id == "c1-eye" }
        check(selected, "edit: a click on #c1-eye selected it (selection \(model.selection?.id ?? "none"), left \(model.selection.map { InspectorFormat.number($0.left) } ?? "-"))")
        let left0 = model.selection?.left ?? .nan
        _ = try? await model.canvas.call(pointerJS, ["id": "c1-eye", "dx": 40, "dy": 0, "meta": true])
        let moved = await waitForEdit(model, applied: 1, ready: ready0)
        let scene = copy.appendingPathComponent("scenes/line.html")
        let sceneText = (try? String(contentsOf: scene, encoding: .utf8)) ?? ""
        check(moved && sceneText.contains("id=\"c1-eye\" data-a style=\"position:absolute;left:\(InspectorFormat.number(left0 + 40))px;top:110px\""),
              "edit: dragging #c1-eye 40 px wrote left:\(InspectorFormat.number(left0 + 40))px into scenes/line.html")
        check(abs(model.canvas.t - h2.at) < 1e-6 && model.selection?.id == "c1-eye" && model.selection?.left == left0 + 40,
              "edit: after the move the canvas reloaded at t=\(h2.at) (t=\(model.canvas.t)) with #c1-eye still selected at left \(model.selection.map { InspectorFormat.number($0.left) } ?? "-")")
        log.append("move: left \(left0) -> \(model.selection?.left ?? .nan), undo \(model.edits.undoTitle)")
        await shot(model, out, "edit-moved.png")

        // 2. At hold 1, double-click the headline #t-g and retype it in place.
        let h1 = model.holds[0]
        model.select(h1.id)
        _ = await waitFor(seconds: 5) { abs(model.t - h1.at) < 1e-6 }
        let ready1 = model.canvas.readyCount
        let newText = "How Far Along are We?"
        let began = (try? await model.canvas.call(textJS, ["id": "t-g", "text": newText]) as? Bool) ?? false
        let texted = await waitForEdit(model, applied: 2, ready: ready1)
        let sceneText2 = (try? String(contentsOf: scene, encoding: .utf8)) ?? ""
        check(began && texted && sceneText2.contains(">\(newText)</h1>"), "edit: in-place text on #t-g wrote '\(newText)' into the scene")
        let shows = (try? await model.canvas.call("return document.getElementById('t-g').textContent", [:]) as? String) ?? ""
        check(shows == newText && abs(model.canvas.t - h1.at) < 1e-6 && model.selection?.id == "t-g",
              "edit: the canvas shows the new headline at t=\(h1.at), #t-g selected (shows '\(shows)')")
        log.append("text: '\(shows)'")
        await shot(model, out, "edit-text.png")

        // 3. Set the title beat's hold from the inspector's code path.
        guard let beat = model.currentBeat, let rel = model.currentRelativeHold else { check(false, "edit: current beat for the hold"); return }
        let ready2 = model.canvas.readyCount
        let newHold = InspectorFormat.nudged(rel.value, by: 0.5)
        model.apply(.setHold(ref: beat.ref, hold: newHold))
        let held = await waitForEdit(model, applied: 3, ready: ready2)
        check(held && abs((model.holds.first?.at ?? 0) - newHold) < 1e-6 && model.spine?.locate(beat.ref)?.beat.hold == newHold,
              "edit: setHold \(beat.ref) \(rel.value) -> \(newHold) moved hold 1 to \(model.holds.first?.at ?? 0)")
        check(model.edits.undoStack.map(\.title) == ["Move", "Edit Text", "Set Hold"], "edit: undo stack \(model.edits.undoStack.map(\.title))")
        log.append("hold: \(rel.value) -> \(newHold); stack \(model.edits.undoStack.map(\.title))")
        await shot(model, out, "edit-hold.png")
        if let win = model.canvas.webView.window {
            await writeWindow(win, films: [model.canvas], to: out.appendingPathComponent("edit-window.png"))
        }

        // 4. Undo all three.
        for i in 0..<3 {
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
        check(differing.isEmpty, "edit: after three undos every source file is byte-identical to the start (\(differing.isEmpty ? "\(end.count) files" : "differ: \(differing.joined(separator: ", "))"))")
        check(!model.edits.canUndo && model.edits.redoStack.count == 3, "edit: undo stack empty, redo stack \(model.edits.redoStack.map(\.title))")

        // The canvas shows the original: the headline at hold 1, #c1-eye back at its old left.
        let title = (try? await model.canvas.call("return document.getElementById('t-g').textContent", [:]) as? String) ?? ""
        let eyeLeft = (try? await model.canvas.call("return getComputedStyle(document.getElementById('c1-eye')).left", [:]) as? String) ?? ""
        check(title == "How Far are We?" && eyeLeft == "\(InspectorFormat.number(left0))px" && abs((model.holds.first?.at ?? 0) - h1.at) < 1e-6,
              "edit: the canvas shows the original (headline '\(title)', #c1-eye left \(eyeLeft), hold 1 at \(model.holds.first?.at ?? 0))")
        await shot(model, out, "edit-undone.png")
        model.setEditMode(false)
        let off = await waitForAsync(seconds: 5) { !(await overlayOn(model)) }
        check(off, "edit: leaving edit mode removes the overlay")
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
    const x = r.left + Math.min(20, r.width / 2), y = r.top + r.height / 2;
    const target = document.elementFromPoint(x, y) || el;
    const ev = (type, cx, cy) => new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true, cancelable: true, metaKey: meta, pointerId: 1, isPrimary: true });
    target.dispatchEvent(ev('pointerdown', x, y));
    for (let i = 1; i <= 4 && (dx || dy); i++) target.dispatchEvent(ev('pointermove', x + dx * k * i / 4, y + dy * k * i / 4));
    target.dispatchEvent(ev('pointerup', x + dx * k, y + dy * k));
    return true;
    """

    /// Double-clicks #id, replaces its text as typing would, and commits with Enter.
    private static let textJS = """
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(40, r.width / 2), y = r.top + r.height / 2;
    (document.elementFromPoint(x, y) || el).dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true, cancelable: true, detail: 2 }));
    if (el.getAttribute('contenteditable') !== 'plaintext-only') return false;
    const s = getSelection(); const range = document.createRange(); range.selectNodeContents(el); s.removeAllRanges(); s.addRange(range);
    if (!document.execCommand('insertText', false, text)) el.textContent = text;
    return SageCanvas.key('Enter', {});
    """
}
