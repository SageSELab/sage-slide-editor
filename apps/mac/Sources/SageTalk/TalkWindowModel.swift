import AppKit
import Observation
import SageTalkCore

@MainActor @Observable
final class TalkWindowModel {
    static let shared = TalkWindowModel()

    var talk: TalkFolder?
    /// The compiled film the canvas shows (from talk.open for beat-format talks).
    private(set) var filmURL: URL?
    /// The folder web views may read: the sidecar's resolved root, so it is a prefix of filmURL
    /// even when the talk was opened through a symlink (/var -> /private/var). WebKit refuses
    /// subresources outside the granted path, and the load never finishes.
    private(set) var filmRoot: URL?
    private(set) var holds: [Hold] = []
    private(set) var chapters: [ChapterInfo] = []
    private(set) var duration: Double = 0
    var selectedHold: Hold.ID?
    /// The canvas film's time and play state, relayed after every render.
    private(set) var t: Double = 0
    private(set) var playing = false
    var error: String?
    /// One line about the sidecar or the last build.
    private(set) var status: String?
    private(set) var diagnostics: [SidecarProtocol.Diagnostic] = []
    /// Reloads of the canvas after an external edit (self-test).
    private(set) var reloads = 0

    /// Navigator sections the user folded.
    var collapsed: Set<String> = []

    let canvas = FilmView()
    let thumbnails = ThumbnailStore()
    @ObservationIgnored private(set) var supervisor: SidecarSupervisor?
    @ObservationIgnored private var openGeneration = 0

    init() {
        canvas.onReady = { [weak self] info in self?.filmBooted(info) }
        canvas.onState = { [weak self] t, playing in self?.filmMoved(t, playing) }
        canvas.onLoadError = { [weak self] msg in self?.error = msg }
        NotificationCenter.default.addObserver(forName: .sageOpenPath, object: nil, queue: .main) { [weak self] note in
            guard let path = note.object as? String else { return }
            MainActor.assumeIsolated {
                guard let self else { return }
                self.open(URL(fileURLWithPath: path))
                if let out = SelfTest.outDir { SelfTest.run(model: self, out: out) }
            }
        }
    }

    var sections: [NavigatorSection] { NavigatorGrouping.sections(holds: holds, chapters: chapters) }

    var transport: TransportModel { TransportModel(holds: holds, chapters: chapters, duration: duration) }

    // MARK: Opening

    func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Open Talk"
        panel.message = "Choose a talk folder (talk.json, or a legacy index.html + talk.js)."
        if panel.runModal() == .OK, let url = panel.url { open(url) }
    }

    /// Beat-format talks open through the sidecar (talk.open builds them); legacy decks load
    /// directly, read-only, with no sidecar.
    func open(_ url: URL) {
        openGeneration += 1
        let gen = openGeneration
        let folder: TalkFolder
        do { folder = try TalkFolder(root: url) } catch { self.error = error.localizedDescription; return }
        talk = folder
        holds = []; chapters = []; duration = 0; t = 0; playing = false
        selectedHold = nil; error = nil; status = nil; diagnostics = []
        filmURL = nil
        filmRoot = nil
        thumbnails.close()
        switch folder.kind {
        case .legacy:
            Task { try? await supervisor?.client.close() }
            filmURL = folder.filmURL
            filmRoot = folder.root
            status = "Legacy deck, read-only"
            canvas.load(film: folder.filmURL, readAccess: folder.root)
        case .beatFormat:
            Task { await openThroughSidecar(folder, generation: gen) }
        }
    }

    private func openThroughSidecar(_ folder: TalkFolder, generation gen: Int) async {
        do {
            let sup = try supervisorOrStart()
            let r = try await sup.open(folder.root)
            guard gen == openGeneration else { return }
            if let wire = r.holds { holds = wire.map(\.hold) }
            if let b = r.build {
                diagnostics = b.diagnostics
                status = b.ok ? "Built in \(Int(b.ms)) ms" : "Build failed"
                if !b.ok { error = Self.describe(b.diagnostics) }
            }
            filmURL = r.filmURL
            let root = URL(fileURLWithPath: r.root, isDirectory: true)
            filmRoot = root
            canvas.load(film: r.filmURL, readAccess: root)
        } catch {
            guard gen == openGeneration else { return }
            self.error = error.localizedDescription
        }
    }

    private func supervisorOrStart() throws -> SidecarSupervisor {
        if let supervisor { return supervisor }
        switch SidecarLocator.configuration() {
        case .failure(let e): throw e
        case .success(var config):
            config.stderrHandler = { text in FileHandle.standardError.write(Data(text.utf8)) }
            let sup = SidecarSupervisor(configuration: config)
            supervisor = sup
            Task { [weak self] in
                for await e in sup.events { self?.handle(e) }
            }
            return sup
        }
    }

    // MARK: Sidecar events

    private func handle(_ e: SupervisorEvent) {
        switch e {
        case .notification(SidecarProtocol.Notification.built, let params):
            guard let built: SidecarProtocol.BuiltParams = try? params?.decode(), built.trigger != .open else { return }
            diagnostics = built.diagnostics
            if built.ok {
                error = nil
                status = "Rebuilt in \(Int(built.ms)) ms"
                if let wire = built.holds { holds = wire.map(\.hold) }
                reloadCanvas()
            } else {
                // Keep showing the last good film.
                status = "Build failed"
                error = Self.describe(built.diagnostics)
            }
        case .notification(SidecarProtocol.Notification.changed, let params):
            if let c: SidecarProtocol.ChangedParams = try? params?.decode(), c.source == .external {
                status = "Changed: " + c.paths.prefix(3).joined(separator: ", ")
            }
        case .notification: break
        case .crashed(_, let willRestart):
            status = willRestart ? "The sidecar stopped; restarting it…" : "The sidecar stopped."
        case .restarted:
            status = "The sidecar was restarted"
            reloadCanvas()
        case .failed(let msg):
            error = msg + " Reopen the talk to try again."
        }
    }

    /// Reloads the film after a rebuild and returns to the same time.
    func reloadCanvas() {
        guard let filmURL, let filmRoot else { return }
        reloads += 1
        canvas.load(film: filmURL, readAccess: filmRoot, at: t)
    }

    private static func describe(_ d: [SidecarProtocol.Diagnostic]) -> String {
        let errors = d.filter { $0.severity == .error }
        guard let first = errors.first ?? d.first else { return "The build failed." }
        let more = errors.count > 1 ? " (+\(errors.count - 1) more)" : ""
        return "Build failed: \(first.message)\(first.file.map { " [\($0)]" } ?? "")\(more)"
    }

    // MARK: Film state

    private func filmBooted(_ info: FilmInfo) {
        // The engine's hold list carries notes; keep the sidecar's chapter ids where it has none.
        let wire = Dictionary(holds.map { (ThumbnailCache.timeKey($0.at), $0) }, uniquingKeysWith: { a, _ in a })
        holds = info.holds.map { h in
            var h = h
            if h.chapter == nil { h.chapter = wire[ThumbnailCache.timeKey(h.at)]?.chapter }
            return h
        }
        chapters = info.chapters
        duration = info.duration
        t = canvas.t
        selectedHold = HoldTimeline(holds: holds, duration: duration).current(at: t)?.id
        if let filmURL, let filmRoot { thumbnails.setFilm(filmURL, talkRoot: filmRoot, holds: holds) }
    }

    private func filmMoved(_ t: Double, _ playing: Bool) {
        self.t = t
        self.playing = playing
        let id = HoldTimeline(holds: holds, duration: duration).current(at: t)?.id
        if id != selectedHold { selectedHold = id }
    }

    // MARK: Commands

    func select(_ id: Hold.ID?) {
        selectedHold = id
        if let id, let h = holds.first(where: { $0.id == id }) { canvas.seek(h.at) }
    }

    func scrub(to t: Double) { canvas.scrub(t) }
    func next() { canvas.next() }
    func prev() { canvas.prev() }
    func through() { canvas.through() }

    func revealInFinder() {
        guard let talk else { return }
        NSWorkspace.shared.activateFileViewerSelecting([talk.root])
    }
}
