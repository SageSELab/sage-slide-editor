import Foundation
import Testing
@testable import SageTalkCore

/// The Publish sheet's model against a fake service: publish, export progress, staging per site
/// from the configured repos only, and a commit only on request.
@MainActor @Suite struct PublishModelTests {
    typealias P = PublishProtocol

    actor FakeService: PublishService {
        var calls: [String] = []
        var stageParams: [P.StageParams] = []
        var commitParams: [P.CommitParams] = []
        var failPublish: String?
        var gate: CheckedContinuation<Void, Never>?
        var holdExport = false

        func setFailPublish(_ m: String?) { failPublish = m }
        func setHoldExport(_ v: Bool) { holdExport = v }
        func release() { gate?.resume(); gate = nil }

        func publish(_ p: P.PublishParams) async throws -> P.PublishResult {
            calls.append("publish \(p.slug ?? "-")")
            if let failPublish { throw SidecarError.remote(RPCError(code: P.ErrorCode.publishFailed, message: failPublish)) }
            return P.PublishResult(path: "/t/build/public/\(p.slug ?? "talk").html", bytes: 1_418_823, holds: 44, duration: 244.8, warnings: [
                .init(severity: .warning, code: "publish-private-text", message: "private chapter label \"One more thing\" appears in a file the public build ships", file: "scenes/end.html:14", beat: nil),
            ])
        }
        func export(_ p: P.ExportParams) async throws -> P.ExportResult {
            calls.append("export \(p.kind.rawValue)")
            if holdExport { await withCheckedContinuation { gate = $0 } }
            return P.ExportResult(kind: p.kind, dir: "/t/build/export", files: ["/t/build/export/t.pdf"], frames: 3, ms: 2400)
        }
        func stage(_ p: P.StageParams) async throws -> P.StageResult {
            calls.append("stage \(p.site.rawValue)")
            stageParams.append(p)
            return P.StageResult(site: p.site, repo: p.repo, url: "/talks/\(p.slug).html", files: [
                .init(path: "public/talks/\(p.slug).html", status: .added),
                .init(path: "src/content/talks.yaml", status: p.site == .lab ? .unchanged : .modified),
            ], diff: "public/talks/\(p.slug).html: new file, 1.42 MB\n", notes: p.site == .lab ? ["src/content/talks.yaml is generated"] : [])
        }
        func qrCodes(_ p: P.QRParams) async throws -> P.QRResult {
            calls.append("qr")
            return P.QRResult(files: [p.paper.map { _ in "assets/qr-paper.svg" }, p.slides.map { _ in "assets/qr-slides.svg" }].compactMap { $0 })
        }
        func commit(_ p: P.CommitParams) async throws -> P.CommitResult {
            calls.append("commit \(p.repo)")
            commitParams.append(p)
            return P.CommitResult(commit: String(repeating: "a", count: 40), summary: "aaaaaaa Add the talk")
        }
    }

    func settings(personal: String? = "/tmp/personal-site", lab: String? = nil) -> SiteSettings {
        let s = SiteSettings(defaults: UserDefaults(suiteName: "sage-tests-\(UUID().uuidString)")!)
        s.setRepo(personal, for: .personal)
        s.setRepo(lab, for: .lab)
        return s
    }

    @Test func settingsStoreTrimmedPathsAndHaveNoDefault() {
        let s = SiteSettings(defaults: UserDefaults(suiteName: "sage-tests-\(UUID().uuidString)")!)
        #expect(s.repo(.personal) == nil && s.repo(.lab) == nil)
        s.setRepo("  /Users/x/site \n", for: .lab)
        #expect(s.repo(.lab) == "/Users/x/site")
        s.setRepo("", for: .lab)
        #expect(s.repo(.lab) == nil)
    }

    @Test func slugDefaultsToTheFolderAndIsValidated() {
        let m = PublishModel()
        m.reset(talkFolder: URL(fileURLWithPath: "/talks/ISSTA 2026 Talk"), title: "T")
        #expect(m.slug == "issta-2026-talk")
        #expect(m.slugProblem == nil)
        #expect(m.outputPath == "build/public/issta-2026-talk.html")
        m.reset(talkFolder: URL(fileURLWithPath: "/talks/ISSTA 2026 Talk.talk"), title: "T")
        #expect(m.slug == "issta-2026-talk") // a .talk package's extension is not part of the slug
        m.slug = "../evil"
        #expect(m.slugProblem != nil)
        m.slug = ""
        #expect(m.slugProblem == "Enter a name for the file.")
        #expect(PublishModel.slugify("Café: Déjà vu!") == "cafe-deja-vu")
    }

    @Test func publishesAndShowsWarnings() async {
        let fake = FakeService()
        let m = PublishModel(service: fake, settings: settings())
        m.reset(talkFolder: URL(fileURLWithPath: "/t/issta26"))
        #expect(m.canPublish)
        await m.publish()
        #expect(m.phase == .done)
        #expect(m.result?.warnings.map(\.code) == ["publish-private-text"])
        #expect(m.publishedURL?.path == "/t/build/public/issta26.html")
        #expect(await fake.calls == ["publish issta26"])

        await fake.setFailPublish("publish failed: missing asset")
        await m.publish()
        #expect(m.phase == .failed("publish failed: missing asset"))
        #expect(m.result == nil)
        #expect(!m.canStage(.personal))
    }

    @Test func exportReportsProgressThenTheResult() async {
        let fake = FakeService()
        await fake.setHoldExport(true)
        let m = PublishModel(service: fake)
        let task = Task { await m.runExport(.pdf) }
        while await fake.calls.isEmpty { await Task.yield() }
        #expect(m.exporting && m.export?.label == "Building…")
        m.apply(.init(kind: .pdf, done: 2, total: 3))
        #expect(m.export?.fraction == 2.0 / 3.0)
        #expect(m.export?.label == "Rendering frame 2 of 3…")
        m.apply(.init(kind: .png, done: 3, total: 3)) // another kind: ignored
        #expect(m.export?.done == 2)
        await m.runExport(.png) // one at a time
        await fake.release()
        await task.value
        #expect(m.export?.phase == .done && m.export?.result?.files == ["/t/build/export/t.pdf"])
        #expect(m.export?.label == "3 pages in 2 s")
        #expect(await fake.calls == ["export pdf"])
    }

    @Test func exportFilesCopyToTheChosenFileOrFolder() throws {
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appendingPathComponent("sage-exportfiles-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: dir) }
        let build = dir.appendingPathComponent("talk/build/export", isDirectory: true)
        try fm.createDirectory(at: build, withIntermediateDirectories: true)
        let pdf = build.appendingPathComponent("talk.pdf"), a = build.appendingPathComponent("hold-01.png"), b = build.appendingPathComponent("hold-02.png")
        try Data("pdf".utf8).write(to: pdf); try Data("a".utf8).write(to: a); try Data("b".utf8).write(to: b)

        // A file: written there, and an existing file is replaced.
        let dest = dir.appendingPathComponent("Desktop/My Talk.pdf")
        try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("old".utf8).write(to: dest)
        #expect(try ExportFiles.copy([pdf], to: dest, folder: false) == dest)
        #expect(try String(contentsOf: dest, encoding: .utf8) == "pdf")
        #expect(fm.fileExists(atPath: pdf.path)) // the build copy stays

        // A folder: created, with every file in it.
        let folder = dir.appendingPathComponent("Desktop/My Talk PNGs")
        try ExportFiles.copy([a, b], to: folder, folder: true)
        #expect(try fm.contentsOfDirectory(atPath: folder.path).sorted() == ["hold-01.png", "hold-02.png"])
        // Again: same-named files replaced, no temp files left.
        try ExportFiles.copy([a, b], to: folder, folder: true)
        #expect(try fm.contentsOfDirectory(atPath: folder.path).sorted() == ["hold-01.png", "hold-02.png"])
        #expect(try fm.contentsOfDirectory(atPath: dest.deletingLastPathComponent().path).allSatisfy { !$0.contains("sage-tmp") })
    }

    @Test func aFailedSaveKeepsTheBuiltPage() async {
        let fake = FakeService() // its paths do not exist: the copy fails
        let m = PublishModel(service: fake, settings: settings())
        m.reset(talkFolder: URL(fileURLWithPath: "/t/issta26"))
        await m.publish(saveTo: URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/issta26.html"))
        guard case .failed(let msg) = m.phase else { Issue.record("expected a failure, got \(m.phase)"); return }
        #expect(msg.hasPrefix("Built, but could not save to"))
        #expect(m.result != nil && m.savedCopy == nil) // the build in build/public is still there
        await m.runExport(.pdf, saveTo: URL(fileURLWithPath: "/nonexistent-\(UUID().uuidString)/t.pdf"))
        if case .failed = m.export?.phase {} else { Issue.record("export: expected a failure") }
    }

    @Test func stagesOnlyConfiguredSitesAndCommitsOnlyOnRequest() async {
        let fake = FakeService()
        let m = PublishModel(service: fake, settings: settings(personal: "/tmp/personal-site", lab: nil))
        m.reset(talkFolder: URL(fileURLWithPath: "/t/issta26"), title: "UI Repair")
        #expect(!m.canStage(.personal)) // publish first
        await m.publish()
        #expect(m.canStage(.personal))
        #expect(!m.canStage(.lab)) // no repo configured: never guessed

        m.paperEntry = "  pub-079 "
        await m.stageOnSite(.personal)
        await m.stageOnSite(.lab)
        #expect(await fake.stageParams == [P.StageParams(site: .personal, repo: "/tmp/personal-site", slug: "issta26", paperEntry: "pub-079")])
        let s = m.stage(for: .personal)
        #expect(s.phase == .done && s.result?.changed == ["public/talks/issta26.html", "src/content/talks.yaml"])
        #expect(s.message == "Add talk slides (issta26): UI Repair")
        #expect(await !fake.calls.contains { $0.hasPrefix("commit") }) // staging never commits

        #expect(m.canCommit(.personal))
        await m.commit(.personal)
        let c = await fake.commitParams
        #expect(c == [P.CommitParams(repo: "/tmp/personal-site", paths: ["public/talks/issta26.html", "src/content/talks.yaml"], message: s.message)])
        #expect(m.stage(for: .personal).commit?.summary == "aaaaaaa Add the talk")
        #expect(!m.canCommit(.personal)) // once
        #expect(PublishModel.pushHint(repo: "/Users/k/My Site") == "Committed, not pushed. Check it, then push it yourself: cd '/Users/k/My Site' && git push")

        // Publishing again makes the staged diff stale.
        await m.publish()
        #expect(m.stage(for: .personal).result == nil)
    }

    @Test func qrCodesNeedAtLeastOneValidURL() async {
        let fake = FakeService()
        let m = PublishModel(service: fake)
        #expect(!m.canMakeQRCodes)
        m.qrPaper = "not a url"
        #expect(!m.canMakeQRCodes)
        m.qrPaper = " https://example.org/paper.pdf "
        m.qrSlides = "https://example.org/talks/x.html"
        #expect(m.canMakeQRCodes)
        await m.makeQRCodes()
        #expect(m.qrPhase == .done && m.qrFiles == ["assets/qr-paper.svg", "assets/qr-slides.svg"])
    }

    @Test func nothingToCommitWhenStagingChangedNothing() async {
        struct Unchanged: PublishService {
            func publish(_ p: P.PublishParams) async throws -> P.PublishResult { P.PublishResult(path: "/t/x.html", bytes: 1, holds: 1, duration: 1) }
            func export(_ p: P.ExportParams) async throws -> P.ExportResult { throw CancellationError() }
            func stage(_ p: P.StageParams) async throws -> P.StageResult {
                P.StageResult(site: p.site, repo: p.repo, url: "/talks/x.html", files: [.init(path: "public/talks/x.html", status: .unchanged)], diff: "")
            }
            func commit(_ p: P.CommitParams) async throws -> P.CommitResult { Issue.record("no commit expected"); throw CancellationError() }
            func qrCodes(_ p: P.QRParams) async throws -> P.QRResult { P.QRResult(files: []) }
        }
        let m = PublishModel(service: Unchanged(), settings: settings(lab: "/tmp/lab"))
        m.reset(talkFolder: URL(fileURLWithPath: "/t/x"))
        await m.publish()
        await m.stageOnSite(.lab)
        #expect(m.stage(for: .lab).phase == .done)
        #expect(!m.canCommit(.lab))
        await m.commit(.lab)
    }
}
