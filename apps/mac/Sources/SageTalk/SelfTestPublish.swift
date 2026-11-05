import AppKit
import PDFKit
import SageTalkCore
import SwiftUI

/// SAGE_SELFTEST, publish and export (Phase 5) on a temp copy of the talk: publishes it, exports
/// a 3-page PDF and PNGs around a hold, writes a QR code into its assets, stages the public file into two temp repositories laid
/// out like the websites (never the real ones: the step swaps in its own settings), commits in
/// one of them as the Commit button does, and writes
///   publish-sheet.png            the Publish sheet after staging (dark), and -light.png
///   publish-sheet-committed.png  after the commit
///   export-sheet.png             the export sheet when the PDF finished
///   publish.txt                  what each call returned
/// The sheets are drawn off screen from their SwiftUI views.
extension SelfTest {
    static func publishAndExport(model: TalkWindowModel, source: URL, out: URL) async {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-selftest-publish-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        let copy = base.appendingPathComponent("talk")
        guard (try? fm.createDirectory(at: base, withIntermediateDirectories: true)) != nil,
              (try? fm.copyItem(at: source, to: copy)) != nil else { check(false, "publish: copy the talk"); return }
        try? fm.removeItem(at: copy.appendingPathComponent(".sage"))
        try? fm.removeItem(at: copy.appendingPathComponent("build"))
        var log: [String] = []
        defer { try? (log.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("publish.txt"), atomically: true, encoding: .utf8) }

        model.open(copy)
        let opened = await waitFor(seconds: 60) { model.canvas.info != nil && model.holds.count >= 3 && model.talk?.root == copy.standardizedFileURL && model.canPublish }
        check(opened, "publish: temp copy opened")
        guard opened else { return }
        let pub = model.publishing

        // Settings of its own: two temp repositories, never the user's.
        let suite = "sage-selftest-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else { check(false, "publish: private settings"); return }
        let saved = pub.settings
        defer { pub.settings = saved; defaults.removePersistentDomain(forName: suite) }
        guard let personal = siteRepo(base.appendingPathComponent("personal-site"), generated: false),
              let lab = siteRepo(base.appendingPathComponent("lab-site"), generated: true) else { check(false, "publish: temp site repositories"); return }
        pub.settings = SiteSettings(defaults: defaults)
        pub.settings.setRepo(personal.path, for: .personal)
        pub.settings.setRepo(lab.path, for: .lab)

        // 1. Publish.
        check(pub.slug == "talk", "publish: the slug defaults to the folder name (\(pub.slug))")
        pub.slug = "selftest-talk"
        model.showPublish()
        check(model.showingPublish, "publish: File ▸ Publish… opens the sheet")
        model.showingPublish = false // the sheets are drawn off screen below, never presented
        await pub.publish()
        guard let r = pub.result else { check(false, "publish: published (\(pub.phase))"); return }
        let file = URL(fileURLWithPath: r.path)
        check(r.path.hasSuffix("/build/public/selftest-talk.html") && fm.fileExists(atPath: r.path) && r.holds > 0 && r.holds < model.holds.count,
              "publish: wrote \(file.lastPathComponent), \(PublishModel.megabytes(r.bytes)), \(r.holds) of \(model.holds.count) holds")
        check(r.warnings.isEmpty, "publish: no private-text warnings (\(r.warnings.map(\.message)))")
        log.append("publish: \(r.path) \(r.bytes) bytes, \(r.holds) holds, \(r.duration) s, \(r.warnings.count) warnings")

        // 2. Export a PDF of holds 1-3, watching the progress arrive.
        var seen = 0
        let pdfTask = Task { await pub.runExport(.pdf, holds: .some([1, 2, 3])) }
        while pub.export == nil || pub.exporting { seen = max(seen, pub.export?.done ?? 0); try? await Task.sleep(for: .milliseconds(10)) }
        await pdfTask.value
        if let e = pub.export, let pdfPath = e.result?.files.first, let doc = PDFDocument(url: URL(fileURLWithPath: pdfPath)), let page = doc.page(at: 0) {
            let box = page.bounds(for: .mediaBox)
            check(doc.pageCount == 3 && box.width == 1920 && box.height == 1080, "export: PDF has \(doc.pageCount) pages of \(Int(box.width))x\(Int(box.height)) points")
            check(seen >= 1, "export: progress arrived while rendering (saw frame \(seen) of 3)")
            log.append("pdf: \(pdfPath) \(e.label)")
        } else { check(false, "export: PDF written (\(pub.export?.label ?? "-"))") }
        renderView(ExportSheet(model: model), size: NSSize(width: 460, height: 190), to: out.appendingPathComponent("export-sheet.png"))

        // 3. PNGs around hold 2.
        await pub.runExport(.png, holds: .some([2]), around: 0.5)
        let pngs = pub.export?.result?.files ?? []
        let sizes = pngs.compactMap { NSImageRep(contentsOf: URL(fileURLWithPath: $0)) }.map { "\($0.pixelsWide)x\($0.pixelsHigh)" }
        check(pngs.map { URL(fileURLWithPath: $0).lastPathComponent } == ["hold-02-before.png", "hold-02.png", "hold-02-after.png"] && sizes == Array(repeating: "1920x1080", count: 3),
              "export: PNGs \(pngs.map { URL(fileURLWithPath: $0).lastPathComponent }) at \(sizes)")

        // 3b. Saved where the user chose (what the Save panels hand over): a PDF file, a new
        // folder of PNGs, and a copy of the public page; build/ keeps its own copies.
        let chosen = base.appendingPathComponent("Chosen Folder", isDirectory: true)
        try? fm.createDirectory(at: chosen, withIntermediateDirectories: true)
        await pub.runExport(.pdf, holds: .some([1]), saveTo: chosen.appendingPathComponent("My Talk.pdf"))
        let savedPDF = chosen.appendingPathComponent("My Talk.pdf")
        check(pub.export?.saved == savedPDF && PDFDocument(url: savedPDF)?.pageCount == 1 && fm.fileExists(atPath: pub.export?.result?.files.first ?? ""),
              "save: the PDF went to the chosen file (\(pub.export?.saved?.lastPathComponent ?? "\(pub.export?.phase ?? .idle)"))")
        await pub.runExport(.png, holds: .some([2]), saveTo: chosen.appendingPathComponent("My Talk PNGs"))
        let pngDir = (try? fm.contentsOfDirectory(atPath: chosen.appendingPathComponent("My Talk PNGs").path).sorted()) ?? []
        check(pngDir == ["hold-02.png", "manifest.json"], "save: the PNGs went into a new folder (\(pngDir))")
        await pub.publish(saveTo: chosen.appendingPathComponent("selftest-talk.html"))
        let savedHTML = (try? Data(contentsOf: chosen.appendingPathComponent("selftest-talk.html"))) ?? Data()
        check(pub.savedCopy != nil && !savedHTML.isEmpty && savedHTML == (try? Data(contentsOf: URL(fileURLWithPath: pub.result?.path ?? ""))),
              "save: the web page went to the chosen file, identical to build/public (\(savedHTML.count) bytes)")

        // QR codes into the copy's assets/.
        pub.qrSlides = "https://example.org/talks/selftest-talk.html"
        await pub.makeQRCodes()
        let qr = (try? String(contentsOf: copy.appendingPathComponent("assets/qr-slides.svg"), encoding: .utf8)) ?? ""
        check(pub.qrFiles == ["assets/qr-slides.svg"] && qr.hasPrefix("<svg") && qr.contains("<path"), "qr: wrote assets/qr-slides.svg (\(pub.qrPhase))")

        // 4. Stage on both temp sites; nothing is committed.
        pub.paperEntry = "pub-002"
        await pub.stageOnSite(.personal)
        await pub.stageOnSite(.lab)
        let ps = pub.stage(for: .personal), ls = pub.stage(for: .lab)
        check(ps.result?.files.map(\.status) == [.added, .modified, .modified] && (ps.result?.diff.contains("+    - label: \"slides\"") ?? false),
              "stage: personal site gets the file, the talk and the paper's slides link (\(ps.result?.files.map { "\($0.path)=\($0.status.rawValue)" } ?? [ps.phase == .done ? "-" : "\(ps.phase)"]))")
        check(ls.result?.files.map(\.status) == [.added, .unchanged, .unchanged] && ls.result?.notes.count == 2,
              "stage: lab site gets the file only; its generated YAML is left alone")
        check(commits(personal) == 1 && commits(lab) == 1, "stage: nothing committed in either repository")
        log.append("stage personal:\n\(ps.result?.diff ?? "-")")
        log.append("stage lab: \(ls.result?.notes ?? [])")
        renderView(PublishSheet(model: model), size: NSSize(width: 660, height: 760), to: out.appendingPathComponent("publish-sheet.png"))
        renderView(PublishSheet(model: model), size: NSSize(width: 660, height: 760), to: out.appendingPathComponent("publish-sheet-light.png"), appearance: .aqua)

        // 5. The Commit button, in the personal repository only.
        check(pub.canCommit(.personal), "commit: the button is enabled after staging")
        await pub.commit(.personal)
        let c = pub.stage(for: .personal).commit
        check(c != nil && commits(personal) == 2 && commits(lab) == 1 && status(personal).isEmpty,
              "commit: one commit in the personal repository (\(c?.summary.split(separator: "\n").first ?? "none")), none in the lab one")
        log.append("commit: \(c?.summary ?? "-")")
        renderView(PublishSheet(model: model), size: NSSize(width: 660, height: 760), to: out.appendingPathComponent("publish-sheet-committed.png"))
    }

    // MARK: Temp site repositories

    private static let talksYAML = """
    # Talks — newest first (self-test copy)

    - id: older-talk
      title: "Older Talk: A Study"
      # the day is not shown
      date: '2025-06-23'
      links:
        - label: slides
          url: /talks/older-talk.html

    """
    private static let pubsYAML = """
    # Publications (self-test copy)
    - id: "pub-002"
      title: "A Paper About Repair"
      links:
        - label: "pdf"
          url: "/documents/repair.pdf"
        - label: "github"
          url: "https://example.org/repair"

    """

    /// A temp git repository shaped like a site, with one commit.
    private static func siteRepo(_ dir: URL, generated: Bool) -> URL? {
        let fm = FileManager.default
        let header = generated ? "# AUTO-GENERATED by scripts/sync-data.mjs — DO NOT EDIT.\n" : ""
        do {
            try fm.createDirectory(at: dir.appendingPathComponent("public/talks"), withIntermediateDirectories: true)
            try fm.createDirectory(at: dir.appendingPathComponent("src/content"), withIntermediateDirectories: true)
            try (header + talksYAML).write(to: dir.appendingPathComponent("src/content/talks.yaml"), atomically: true, encoding: .utf8)
            try (header + pubsYAML).write(to: dir.appendingPathComponent("src/content/publications.yaml"), atomically: true, encoding: .utf8)
        } catch { return nil }
        for args in [["init", "-q", "-b", "main"], ["config", "user.name", "SAGE self-test"], ["config", "user.email", "selftest@example.org"],
                     ["config", "commit.gpgsign", "false"], ["add", "-A"], ["commit", "-q", "-m", "initial"]] {
            guard vcs(dir, args) != nil else { return nil }
        }
        return dir
    }

    private static func commits(_ repo: URL) -> Int { Int(vcs(repo, ["rev-list", "--count", "HEAD"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") ?? -1 }
    private static func status(_ repo: URL) -> String { vcs(repo, ["status", "--porcelain"]) ?? "?" }

    @discardableResult
    private static func vcs(_ repo: URL, _ args: [String]) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", repo.path] + args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return p.terminationStatus == 0 ? String(decoding: data, as: UTF8.self) : nil
    }

    /// Draws a SwiftUI view into a PNG from an off-screen window (never on screen).
    static func renderView(_ view: some View, size: NSSize, to url: URL, appearance: NSAppearance.Name = .darkAqua) {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height).background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: appearance)
        host.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -10_000, y: -10_000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        host.layoutSubtreeIfNeeded()
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        window.contentView = nil
    }
}
