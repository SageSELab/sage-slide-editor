import AppKit
import SageTalkCore
import WebKit

/// SAGE_SELFTEST=<dir> runs the app without taking focus, opens SAGE_OPEN, and writes:
///   holds.txt          the hold list ("n time chapter | label | notes?"), then the navigator sections
///   thumbs.txt         thumbnail counts and timing (rendered, adopted, loaded from disk)
///   canvas-<n>.png     the canvas web view's own snapshot at hold n
///   window.png         the talk window: its view hierarchy, with each web view's own snapshot
///                      drawn into its frame (cacheDisplay cannot draw web content)
///   presenter.png      the presenter window (off screen), with its mirror's own snapshot
///   audience.png       the audience film's own snapshot; presenter.txt, what the presenter showed
///   roundtrip.txt      beat-format talks: an external edit to a temp copy's scene text, then
///                      checks that the canvas reloaded at the same time and showed the edit,
///                      and how many thumbnails were re-rendered vs adopted
///   edit-*.png, edit.txt  beat-format talks: the edit round trip on another temp copy (select,
///                      drag 40 px, retype a headline, set a hold, undo all three; files must be
///                      byte-identical afterwards); see SelfTestEditing.swift
///   claude-pane.png    beat-format talks: the Claude pane after replaying a recorded session, with
///                      inline code, the effort control and an attachment chip
///                      (SelfTestClaude.swift; also window-claude.png, claude.txt)
///   materials.png      beat-format talks: the Materials tab over a temp paper and package
///                      (also window-materials.png)
///   publish-sheet.png  beat-format talks: publish, export and stage a temp copy into temp site
///                      repositories, drawn from the Publish sheet (SelfTestPublish.swift; also
///                      publish-sheet-committed.png, export-sheet.png, publish.txt)
///   onboarding.*       the first-run checks and sheet (SelfTestOnboarding.swift)
///   themes-*.png, theme-editor.png, themes.txt  beat-format talks: apply the Paper theme to a temp
///                      copy, save its look to a temp library, undo (SelfTestThemes.swift)
///   result.txt         PASS or FAIL lines for every check
/// then quits. Used by scripts/selftest.sh. It only ever draws the app's own windows and web
/// views: no screen capture of any kind.
@MainActor
enum SelfTest {
    static var outDir: URL? {
        ProcessInfo.processInfo.environment["SAGE_SELFTEST"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    private static var results: [String] = []

    static func check(_ ok: Bool, _ what: String) {
        results.append((ok ? "PASS " : "FAIL ") + what)
        print("selftest: \(ok ? "PASS" : "FAIL") \(what)")
    }

    static func run(model: TalkWindowModel, out: URL) {
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        Task { @MainActor in
            await runSteps(model: model, out: out)
            try? (results.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
            print("selftest: done, \(results.filter { $0.hasPrefix("FAIL") }.count) failures")
            quit()
        }
    }

    private static func runSteps(model: TalkWindowModel, out: URL) async {
        let booted = await waitFor(seconds: 60) { model.canvas.info != nil && !model.holds.isEmpty }
        check(booted, "talk opened and the engine booted (error: \(model.error ?? "none"))")
        guard booted, let talk = model.talk else { return }
        check(talk.kind == .legacy || model.supervisor != nil, "beat-format talks open through the sidecar")
        writeHolds(model, to: out.appendingPathComponent("holds.txt"))
        check(model.holds.allSatisfy { $0.notes?.isEmpty == false } || talk.kind == .legacy, "every hold has notes")

        // Thumbnails for every hold.
        let clock = ContinuousClock(), t0 = clock.now
        model.thumbnails.requestAll()
        let thumbsDone = await waitFor(seconds: 120) { model.thumbnails.pendingCount == 0 && !model.thumbnails.busy }
        let th = model.thumbnails
        let line = "holds \(model.holds.count) rendered \(th.rendered) adopted \(th.adopted) fromDisk \(th.loadedFromDisk) in \(clock.now - t0)"
        try? (line + "\n").write(to: out.appendingPathComponent("thumbs.txt"), atomically: true, encoding: .utf8)
        check(thumbsDone, "all thumbnails generated (\(line))")

        for n in [1, 4, 8] where n <= model.holds.count {
            model.select(n)
            try? await Task.sleep(for: .milliseconds(300))
            if let img = try? await model.canvas.snapshot(width: 960) { write(img, to: out.appendingPathComponent("canvas-\(n).png")) }
        }
        model.select(min(5, model.holds.count))
        try? await Task.sleep(for: .milliseconds(500))
        if let win = model.canvas.webView.window {
            await writeWindow(win, films: [model.canvas], to: out.appendingPathComponent("window.png"))
        }

        await presenter(model: model, out: out)
        await onboarding(out: out)
        if talk.kind == .beatFormat {
            await claudePane(model: model, out: out)
            await materialsTab(model: model, out: out)
            let source = talk.root
            await roundTrip(model: model, out: out)
            await editRoundTrip(model: model, source: source, out: out)
            await publishAndExport(model: model, source: source, out: out)
            await themes(model: model, source: source, out: out)
        }
    }

    // MARK: Presenting

    /// Presents with both windows parked off screen (no focus, nothing covers the user's
    /// screens). Off screen the audience film cannot play (rAF stops), so this drives it with
    /// seeks and the left arrow, which are synchronous, and checks the relay to the presenter.
    private static func presenter(model: TalkWindowModel, out: URL) async {
        guard model.holds.count >= 4 else { return }
        let p = model.presentation
        model.select(1)
        model.present(.present, offscreen: true)
        let ready = await waitFor(seconds: 20) { p.audience?.info != nil && p.mirror?.info != nil }
        check(ready && p.isPresenting, "present: audience and presenter films booted")
        guard ready, let audience = p.audience, let mirror = p.mirror, let pw = p.presenterWindow else { p.end(); return }

        let h3 = model.holds[2], h2 = model.holds[1]
        audience.seek(h3.at)
        let relayed = await waitFor(seconds: 5) { abs(p.state.t - h3.at) < 1e-6 && abs(mirror.t - h3.at) < 1e-6 }
        check(relayed, "present: audience seek relayed to the presenter state and mirror (t=\(p.state.t), mirror \(mirror.t))")
        check(p.state.notes == (h3.notes ?? ""), "present: notes are hold \(h3.index)'s")
        check(p.state.nextLabel == model.holds[3].label, "present: next is '\(p.state.nextLabel)'")

        check(p.press(.left), "present: left arrow handled")
        let back = await waitFor(seconds: 5) { abs(p.state.t - h2.at) < 1e-6 }
        check(back, "present: left arrow went back to hold \(h2.index) (t=\(p.state.t))")
        check(p.state.clockStart == nil, "present: the clock waits for the first advance")
        audience.seek(h3.at)
        _ = await waitFor(seconds: 5) { abs(mirror.t - h3.at) < 1e-6 }
        try? await Task.sleep(for: .milliseconds(400))

        // Display choices: listed, Automatic places both, a chosen display is used, and choosing
        // while presenting keeps both windows off screen here (nothing moves onto real displays).
        check(!p.displays.isEmpty && p.placement != nil, "present: displays listed (\(p.displays.map(\.name)))")
        if let last = p.displays.last {
            let before = (pw.frame, p.audienceWindow?.frame)
            p.audienceChoice = .init(last)
            check(p.placement?.audience == p.displays.count - 1, "present: the chosen audience display is used")
            check(pw.frame == before.0 && p.audienceWindow?.frame == before.1, "present: a display change in the self-test moves no window onto a real display")
            p.audienceChoice = nil
        }

        await writeWindow(pw, films: [mirror], to: out.appendingPathComponent("presenter.png"))
        if let img = try? await audience.snapshot(width: 960) { write(img, to: out.appendingPathComponent("audience.png")) }
        let lines = ["t \(p.state.t)", "position \(p.state.positionLabel)", "current \(p.state.currentHold?.label ?? "-")",
                     "next \(p.state.nextLabel)", "notes \(p.state.notes)"]
        try? (lines.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("presenter.txt"), atomically: true, encoding: .utf8)

        check(p.press(.escape), "present: Esc handled")
        check(!p.isPresenting && p.presenterWindow == nil && p.audienceWindow == nil, "present: Esc closed both windows")
        _ = await waitFor(seconds: 3) { abs(model.t - h3.at) < 1e-6 }
        check(abs(model.t - h3.at) < 1e-6, "present: the canvas follows to where presenting ended")
    }

    // MARK: External edit round trip

    private static func roundTrip(model: TalkWindowModel, out: URL) async {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-selftest-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        let copy = base.appendingPathComponent("talk")
        guard let src = model.talk?.root, (try? fm.createDirectory(at: base, withIntermediateDirectories: true)) != nil,
              (try? fm.copyItem(at: src, to: copy)) != nil else { check(false, "copy the talk for the round trip"); return }
        try? fm.removeItem(at: copy.appendingPathComponent(".sage"))
        try? fm.removeItem(at: copy.appendingPathComponent("build"))

        var log: [String] = []
        model.open(copy)
        let opened = await waitFor(seconds: 60) { model.canvas.info != nil && !model.holds.isEmpty && model.talk?.root == copy.standardizedFileURL }
        check(opened, "round trip: temp copy opened")
        guard opened, model.holds.count >= 2 else { return }
        model.thumbnails.requestAll()
        _ = await waitFor(seconds: 120) { model.thumbnails.pendingCount == 0 && !model.thumbnails.busy }
        let before = (rendered: model.thumbnails.rendered, adopted: model.thumbnails.adopted)

        let target = model.holds[1].at
        model.scrub(to: target)
        _ = await waitFor(seconds: 5) { abs(model.t - target) < 1e-6 }
        let reloadsBefore = model.reloads, readyBefore = model.canvas.readyCount
        log.append("seeked to \(target), t=\(model.t)")

        // The edit: the chapter-1 eyebrow, visible from hold 2 on.
        let scene = copy.appendingPathComponent("scenes/line.html")
        let marker = "Selftest edit \(Int.random(in: 1000...9999))"
        guard let text = try? String(contentsOf: scene, encoding: .utf8),
              text.contains("Fifteen years of automated program repair") else { check(false, "round trip: scene text found"); return }
        try? text.replacingOccurrences(of: "Fifteen years of automated program repair", with: marker)
            .write(to: scene, atomically: true, encoding: .utf8)
        let clock = ContinuousClock(), t0 = clock.now

        let reloaded = await waitFor(seconds: 30) { model.reloads > reloadsBefore && model.canvas.readyCount > readyBefore }
        log.append("reload after \(clock.now - t0), status: \(model.status ?? "-")")
        check(reloaded, "round trip: canvas reloaded after the external edit")
        try? await Task.sleep(for: .milliseconds(300))
        let shows = (try? await model.canvas.call("return document.querySelector('.stage').textContent.includes(m)", ["m": marker]) as? Bool) ?? false
        log.append("t after reload \(model.canvas.t), shows edit \(shows)")
        let built = (try? String(contentsOf: copy.appendingPathComponent("build/index.html"), encoding: .utf8))?.contains(marker) ?? false
        log.append("build/index.html has the edit: \(built)")
        check(abs(model.canvas.t - target) < 1e-6, "round trip: canvas came back at t=\(target) (got \(model.canvas.t))")
        check(shows, "round trip: canvas shows the edited text")
        if let img = try? await model.canvas.snapshot(width: 960) { write(img, to: out.appendingPathComponent("canvas-after-edit.png")) }

        model.thumbnails.requestAll()
        let thumbs = await waitFor(seconds: 120) { model.thumbnails.pendingCount == 0 && !model.thumbnails.busy }
        let rendered = model.thumbnails.rendered - before.rendered, adopted = model.thumbnails.adopted - before.adopted
        log.append("after the rebuild: \(rendered) thumbnails re-rendered, \(adopted) adopted unchanged")
        check(thumbs && rendered > 0 && rendered < model.holds.count / 2 && rendered + adopted == model.holds.count,
              "round trip: only changed thumbnails re-rendered (\(rendered) of \(model.holds.count))")
        try? (log.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("roundtrip.txt"), atomically: true, encoding: .utf8)
    }

    // MARK: Helpers

    static func waitFor(seconds: Double, _ cond: () -> Bool) async -> Bool {
        let clock = ContinuousClock(), end = clock.now + .milliseconds(Int(seconds * 1000))
        while clock.now < end {
            if cond() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return cond()
    }

    private static func writeHolds(_ model: TalkWindowModel, to url: URL) {
        var lines = model.holds.map {
            "\($0.index) \(String(format: "%.1f", $0.at)) \($0.chapter ?? "-") | \($0.label)\($0.backup ? " [backup]" : "") | notes \($0.notes?.count ?? 0) chars"
        }
        lines.append("")
        lines.append("sections:")
        lines += model.sections.map { "\($0.title)\($0.dark ? " (dark)" : "")\($0.isBackup ? " (backups)" : ""): \($0.holds.map { String($0.index) }.joined(separator: " "))" }
        try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
    }

    /// Draws a window's views, then each film's own snapshot into its frame. Only this app's
    /// views are drawn; nothing is read back from the screen.
    static func writeWindow(_ window: NSWindow, films: [FilmView], to url: URL) async {
        guard let view = window.contentView else { return }
        var shots: [(NSRect, NSImage)] = []
        for f in films where f.webView.window === window {
            let frame = f.webView.convert(f.webView.bounds, to: view)
            if let img = try? await f.snapshot(width: frame.width) { shots.append((frame, img)) }
            // The canvas's format bar floats over the web view: draw it over the snapshot too.
            if let host = f.webView.superview as? CanvasContainerView, !host.bar.isHidden,
               let rep = host.bar.bitmapImageRepForCachingDisplay(in: host.bar.bounds) {
                host.bar.cacheDisplay(in: host.bar.bounds, to: rep)
                let img = NSImage(size: host.bar.bounds.size)
                img.addRepresentation(rep)
                shots.append((host.bar.convert(host.bar.bounds, to: view), img))
            }
        }
        let size = view.bounds.size
        let scale = window.backingScaleFactor
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds),
              let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        out.size = size
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
        rep.draw(in: NSRect(origin: .zero, size: size))
        for (frame, img) in shots {
            // View coordinates may be flipped; NSImage.draw wants bottom-left origin here.
            let r = view.isFlipped ? NSRect(x: frame.minX, y: size.height - frame.maxY, width: frame.width, height: frame.height) : frame
            img.draw(in: r)
        }
        NSGraphicsContext.restoreGraphicsState()
        try? out.representation(using: .png, properties: [:])?.write(to: url)
    }

    /// Quits from a run-loop callout rather than from this main-actor task, so terminate's
    /// nested run loop can still run main-actor work (the sidecar shutdown).
    static func quit() {
        RunLoop.main.perform { MainActor.assumeIsolated { NSApp.terminate(nil) } }
    }

    static func write(_ image: NSImage, to url: URL) {
        guard let png = image.pngData else { return }
        try? png.write(to: url)
    }
}
