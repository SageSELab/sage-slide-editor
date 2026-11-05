import Foundation
import Observation

// The Publish sheet, the export progress, and the "Stage on website" step (PLAN 5.6), as a
// plain view model over a PublishService (the sidecar, or a fake in tests). Staging writes into
// the site repo's working tree only; a commit happens only when the user clicks Commit, and
// nothing ever pushes: the sheet tells the user to push by hand.

/// Where the two site repositories are (Settings, ⌘,). Stored in UserDefaults; there is no
/// default path, so nothing is ever staged into a repository the user did not choose.
public struct SiteSettings: Sendable {
    public static let personalKey = "site.personal.repo"
    public static let labKey = "site.lab.repo"

    /// The defaults suite to read and write (UserDefaults is thread-safe; tests pass a private suite).
    nonisolated(unsafe) public let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public static func key(_ site: PublishProtocol.Site) -> String { site == .personal ? personalKey : labKey }

    /// The repository path for a site, or nil when it is not set.
    public func repo(_ site: PublishProtocol.Site) -> String? {
        guard let s = defaults.string(forKey: Self.key(site))?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }

    public func setRepo(_ path: String?, for site: PublishProtocol.Site) {
        let p = path?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if p.isEmpty { defaults.removeObject(forKey: Self.key(site)) } else { defaults.set(p, forKey: Self.key(site)) }
    }
}

@MainActor @Observable
public final class PublishModel {
    public enum Phase: Equatable, Sendable { case idle, running, done, failed(String) }

    public struct ExportState: Equatable, Sendable {
        public var kind: PublishProtocol.ExportKind
        public var done = 0
        public var total = 0
        public var phase: Phase = .running
        public var result: PublishProtocol.ExportResult?
        /// Where the user chose to save it (the PDF, or the folder of PNGs), once copied there.
        public var saved: URL?
        public var fraction: Double { total > 0 ? Double(done) / Double(total) : 0 }
        public var label: String {
            switch phase {
            case .running: total > 0 ? "Rendering frame \(done) of \(total)…" : "Building…"
            case .done: "\(result?.frames ?? 0) \(kind == .pdf ? "pages" : "frames") in \(Int(((result?.ms ?? 0) / 1000).rounded())) s"
            case .failed(let m): m
            case .idle: ""
            }
        }
    }

    public struct SiteStage: Equatable, Sendable {
        public var phase: Phase = .idle
        public var result: PublishProtocol.StageResult?
        public var commit: PublishProtocol.CommitResult?
        public var message = ""
    }

    // The sheet's fields.
    public var slug = ""
    /// The publication to link the slides from (an id like "pub-079", or the title); optional.
    public var paperEntry = ""

    public private(set) var phase: Phase = .idle
    public private(set) var result: PublishProtocol.PublishResult?
    /// Where the user saved a copy of the public page (File ▸ Export ▸ Web Page, or Save a Copy).
    public private(set) var savedCopy: URL?
    public private(set) var export: ExportState?
    public private(set) var stages: [PublishProtocol.Site: SiteStage] = [:]

    // QR codes for the title and end card (talk.qr).
    public var qrPaper = ""
    public var qrSlides = ""
    public var qrPackage = ""
    public private(set) var qrPhase: Phase = .idle
    public private(set) var qrFiles: [String] = []

    @ObservationIgnored public var service: (any PublishService)?
    @ObservationIgnored public var settings: SiteSettings
    /// The talk's title, for the default commit message.
    @ObservationIgnored public var talkTitle = ""

    public init(service: (any PublishService)? = nil, settings: SiteSettings = SiteSettings()) {
        self.service = service
        self.settings = settings
    }

    /// A new talk was opened: forget the last one's results.
    public func reset(talkFolder: URL?, title: String = "") {
        slug = talkFolder.map { Self.slugify(TalkPackage.name(of: $0)) } ?? ""
        paperEntry = ""
        talkTitle = title
        phase = .idle; result = nil; export = nil; stages = [:]
        qrPaper = ""; qrSlides = ""; qrPackage = ""; qrPhase = .idle; qrFiles = []
    }

    // MARK: Publish

    /// Letters, digits, . _ - (the sidecar's rule); nil when fine.
    public var slugProblem: String? {
        if slug.isEmpty { return "Enter a name for the file." }
        let ok = slug.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil && !slug.contains("..")
        return ok ? nil : "Use letters, digits, dots, dashes and underscores."
    }

    public var canPublish: Bool { service != nil && slugProblem == nil && phase != .running }

    /// Where the file will be written, relative to the talk.
    public var outputPath: String { "build/public/\(slug.isEmpty ? "…" : slug).html" }

    public var publishedURL: URL? { result.map { URL(fileURLWithPath: $0.path) } }

    /// Builds the public page into build/public (where staging on a site reads it) and, with
    /// `saveTo`, copies it to the file the user chose.
    public func publish(saveTo: URL? = nil) async {
        guard canPublish, let service else { return }
        phase = .running
        savedCopy = nil
        let slug = self.slug
        let r: PublishProtocol.PublishResult
        do {
            r = try await service.publish(.init(slug: slug))
        } catch {
            result = nil
            phase = .failed(Self.message(error))
            return
        }
        result = r
        // A new file: earlier staging is stale.
        stages = [:]
        do {
            if let saveTo { savedCopy = try ExportFiles.copy([URL(fileURLWithPath: r.path)], to: saveTo, folder: false) }
            phase = .done
        } catch {
            phase = .failed("Built, but could not save to \(saveTo?.path ?? "?"): \(Self.message(error))")
        }
    }

    /// Copies the last public page to a file the user chose.
    public func saveCopy(to url: URL) {
        guard let r = result else { return }
        do { savedCopy = try ExportFiles.copy([URL(fileURLWithPath: r.path)], to: url, folder: false) } catch { phase = .failed(Self.message(error)) }
    }

    // MARK: Export

    public var exporting: Bool { export?.phase == .running }

    /// Renders into the talk's build/export and, with `saveTo`, copies the result there: the PDF
    /// to that file, the PNGs (and their manifest) into that folder, which is created.
    public func runExport(_ kind: PublishProtocol.ExportKind, holds: PublishProtocol.HoldSelection = .all, around: Double? = nil,
                          saveTo: URL? = nil) async {
        guard let service, !exporting else { return }
        export = ExportState(kind: kind)
        do {
            let r = try await service.export(.init(kind: kind, holds: holds, around: around))
            if let saveTo {
                var files = r.files.map { URL(fileURLWithPath: $0) }
                let manifest = URL(fileURLWithPath: r.dir).appendingPathComponent("manifest.json")
                if kind == .png, FileManager.default.fileExists(atPath: manifest.path), !files.contains(manifest) { files.append(manifest) }
                export?.saved = try ExportFiles.copy(files, to: saveTo, folder: kind == .png)
            }
            export?.result = r
            export?.done = r.frames
            export?.total = r.frames
            export?.phase = .done
        } catch {
            export?.phase = .failed(Self.message(error))
        }
    }

    /// talk.exportProgress.
    public func apply(_ p: PublishProtocol.ExportProgress) {
        guard var e = export, e.phase == .running, e.kind == p.kind else { return }
        e.done = p.done
        e.total = p.total
        export = e
    }

    public func dismissExport() { if !exporting { export = nil } }

    // MARK: Stage and commit

    public func stage(for site: PublishProtocol.Site) -> SiteStage { stages[site] ?? SiteStage() }

    public func canStage(_ site: PublishProtocol.Site) -> Bool {
        result != nil && settings.repo(site) != nil && service != nil && stage(for: site).phase != .running
    }

    public func stageOnSite(_ site: PublishProtocol.Site) async {
        guard canStage(site), let service, let repo = settings.repo(site) else { return }
        var s = stage(for: site)
        s.phase = .running
        s.commit = nil
        stages[site] = s
        let paper = paperEntry.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let r = try await service.stage(.init(site: site, repo: repo, slug: slug, paperEntry: paper.isEmpty ? nil : paper))
            s.result = r
            s.phase = .done
            if s.message.isEmpty { s.message = defaultCommitMessage }
        } catch {
            s.result = nil
            s.phase = .failed(Self.message(error))
        }
        stages[site] = s
    }

    public var defaultCommitMessage: String {
        let what = talkTitle.isEmpty ? slug : talkTitle
        return "Add talk slides (\(slug)): \(what)"
    }

    public func setCommitMessage(_ m: String, for site: PublishProtocol.Site) {
        var s = stage(for: site)
        s.message = m
        stages[site] = s
    }

    /// Something to commit, and the user has not committed it yet.
    public func canCommit(_ site: PublishProtocol.Site) -> Bool {
        let s = stage(for: site)
        return s.phase == .done && s.commit == nil && !(s.result?.changed.isEmpty ?? true)
            && !s.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Runs only from the Commit button. Commits the staged files in that repository; never pushes.
    public func commit(_ site: PublishProtocol.Site) async {
        guard canCommit(site), let service, let staged = stage(for: site).result else { return }
        var s = stage(for: site)
        s.phase = .running
        stages[site] = s
        do {
            s.commit = try await service.commit(.init(repo: staged.repo, paths: staged.changed, message: s.message))
            s.phase = .done
        } catch {
            s.phase = .failed(Self.message(error))
        }
        stages[site] = s
    }

    /// What the sheet tells the user after a commit: pushing is theirs to do.
    public static func pushHint(repo: String) -> String {
        "Committed, not pushed. Check it, then push it yourself: cd \(shellQuote(repo)) && git push"
    }

    // MARK: QR codes

    private static func url(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.range(of: #"^https?://\S+$"#, options: .regularExpression) != nil ? t : nil
    }

    /// At least one field holds a URL, and none holds something that is not one.
    public var canMakeQRCodes: Bool {
        let fields = [qrPaper, qrSlides, qrPackage].map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return service != nil && !fields.isEmpty && fields.allSatisfy { Self.url($0) != nil } && qrPhase != .running
    }

    /// Writes assets/qr-<name>.svg into the talk for each URL given.
    public func makeQRCodes() async {
        guard canMakeQRCodes, let service else { return }
        qrPhase = .running
        do {
            qrFiles = try await service.qrCodes(.init(paper: Self.url(qrPaper), slides: Self.url(qrSlides), package: Self.url(qrPackage))).files
            qrPhase = .done
        } catch {
            qrFiles = []
            qrPhase = .failed(Self.message(error))
        }
    }

    // MARK: Helpers

    public static func slugify(_ s: String) -> String {
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en_US_POSIX")).lowercased()
        var out = ""
        for ch in folded.unicodeScalars {
            if CharacterSet.alphanumerics.contains(ch) && ch.isASCII { out.unicodeScalars.append(ch) }
            else if ch == "." { out.append(".") }
            else if !out.hasSuffix("-") { out.append("-") }
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-."))
        return trimmed.isEmpty ? "talk" : trimmed
    }

    static func shellQuote(_ s: String) -> String {
        s.range(of: #"^[A-Za-z0-9/._-]+$"#, options: .regularExpression) != nil ? s : "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    static func message(_ error: Error) -> String {
        if case SidecarError.remote(let e) = error { return e.message }
        return (error as? LocalizedError)?.errorDescription ?? "\(error)"
    }

    public static func megabytes(_ bytes: Int) -> String { String(format: "%.2f MB", Double(bytes) / 1e6) }

    public static func duration(_ s: Double) -> String {
        let t = Int(s.rounded())
        return String(format: "%d:%02d", t / 60, t % 60)
    }
}

/// Copies what the sidecar wrote under build/ to where the user chose (Save panels).
public enum ExportFiles {
    /// `folder` false: the single file becomes `destination` (replacing it). `folder` true: the
    /// files go into `destination`, created if needed, replacing same-named files. Returns
    /// `destination`.
    @discardableResult
    public static func copy(_ files: [URL], to destination: URL, folder: Bool) throws -> URL {
        let fm = FileManager.default
        if folder {
            try fm.createDirectory(at: destination, withIntermediateDirectories: true)
            for f in files { try replace(f, at: destination.appendingPathComponent(f.lastPathComponent)) }
        } else {
            guard let f = files.first else { throw CocoaError(.fileNoSuchFile) }
            try replace(f, at: destination)
        }
        return destination
    }

    private static func replace(_ src: URL, at dst: URL) throws {
        let fm = FileManager.default
        if src.standardizedFileURL == dst.standardizedFileURL { return }
        let tmp = dst.deletingLastPathComponent().appendingPathComponent(".\(dst.lastPathComponent).sage-tmp-\(UUID().uuidString)")
        try fm.copyItem(at: src, to: tmp)
        if fm.fileExists(atPath: dst.path) {
            _ = try fm.replaceItemAt(dst, withItemAt: tmp)
        } else {
            try fm.moveItem(at: tmp, to: dst)
        }
    }
}
