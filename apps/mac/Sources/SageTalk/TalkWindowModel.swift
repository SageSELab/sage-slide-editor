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
    var holds: [Hold] = []
    private(set) var chapters: [ChapterInfo] = []
    private(set) var duration: Double = 0
    var selectedHold: Hold.ID?
    /// The canvas film's time and play state, relayed after every render.
    private(set) var t: Double = 0
    private(set) var playing = false
    var error: String?
    /// One line about the sidecar or the last build.
    var status: String?
    private(set) var diagnostics: [SidecarProtocol.Diagnostic] = []
    /// Reloads of the canvas after an external edit (self-test).
    private(set) var reloads = 0

    /// Navigator sections the user folded.
    var collapsed: Set<String> = []

    // Editing (Phase 3; TalkWindowModel+Editing.swift). No mode: the canvas is editable
    // whenever the film is paused and the talk is beat-format.
    var rightPane: RightPane = .inspector
    /// The object selected on the canvas, as it last reported it.
    var selection: CanvasObject?
    /// The id of the element whose text has the caret (in-place text editing), if any.
    var textEditing: String?
    /// The formatting at the text selection while editing text (the format bar's state).
    var textState: CanvasTextState?
    /// The format bar's Font button: set by whoever provides a font picker (pickFont(for:)).
    @ObservationIgnored var onPickFont: ((CanvasObject) -> Void)?
    @ObservationIgnored var pendingColor: Task<Void, Never>?
    /// The human's undo stack and the edit pipeline to the sidecar.
    let edits = EditSession()
    /// talk.json as last read (beat labels, notes, holds, flags for the inspector and menus).
    var spine: SpineSnapshot?
    /// Beats changed outside the app (badged in the navigator until looked at).
    var changedBeats: Set<String> = []
    /// The spine before an external talk.json change, to find which beats it touched.
    @ObservationIgnored var spineBeforeExternal: SpineSnapshot?

    /// The Claude pane (TalkWindowModel+Claude.swift).
    // The self-test keeps the default model so its renders do not depend on the user's choice.
    let chat = ClaudeChat(defaults: SelfTest.outDir == nil ? .standard : nil)
    /// talk.json's materials, listed for the Materials sidebar (PLAN 7).
    var materials: [Materials.Entry] = []
    /// The navigator column's tab.
    var navigatorTab: NavigatorTab = .beats

    /// Publish and export (TalkWindowModel+Publish.swift).
    let publishing = PublishModel()
    var showingPublish = false
    var showingExport = false

    /// The first-run sheet (TalkWindowModel+Onboarding.swift).
    var onboarding: OnboardingModel?
    var showOnboarding = false

    let canvas = FilmView()
    let thumbnails: ThumbnailStore
    let presentation: PresentationController
    @ObservationIgnored private(set) var supervisor: SidecarSupervisor?
    @ObservationIgnored private(set) var openGeneration = 0
    /// Plain talk folders whose .talk conversion bar was dismissed (TalkWindowModel+Package.swift).
    var dismissedPackageOffers = TalkWindowModel.loadDismissedOffers()

    init() {
        let thumbs = ThumbnailStore()
        thumbnails = thumbs
        presentation = PresentationController(thumbnails: thumbs)
        presentation.onEnd = { [weak self] t in self?.presentingEnded(at: t) }
        canvas.onReady = { [weak self] info in self?.filmBooted(info) }
        canvas.onState = { [weak self] t, playing in self?.filmMoved(t, playing) }
        canvas.onLoadError = { [weak self] msg in self?.error = msg }
        canvas.onCanvas = { [weak self] msg in self?.handleCanvas(msg) }
        edits.onApplied = { [weak self] r in self?.editApplied(r) }
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
        // .talk packages show as files (the only files offered); plain folders, beat-format or
        // legacy, stay choosable as folders.
        panel.canChooseDirectories = true
        panel.canChooseFiles = true
        panel.allowedContentTypes = [Self.talkType]
        panel.prompt = "Open Talk"
        panel.message = "Choose a .talk document or a talk folder (talk.json, or a legacy index.html + talk.js)."
        if panel.runModal() == .OK, let url = panel.url { openDocument(url) }
    }

    /// File ▸ New Talk…: a save panel names the new `.talk` package (its name without the extension
    /// becomes the title), the starter talk is copied into it (SageTalkCore/NewTalk.swift), and the
    /// new talk opens.
    func presentNewTalkPanel() {
        guard let starter = NewTalk.starter() else { error = NewTalk.CreateError.noStarter.localizedDescription; return }
        let panel = NSSavePanel()
        panel.title = "New Talk"
        panel.prompt = "Create"
        panel.nameFieldLabel = "Talk name:"
        panel.nameFieldStringValue = "Untitled Talk"
        panel.allowedContentTypes = [Self.talkType]
        panel.message = "Choose where to create the talk. Its name becomes the talk's title."
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let picked = panel.url else { return }
        let url = TalkPackage.packageURL(picked)
        do {
            try NewTalk.create(at: url, starter: starter)
            open(url)
        } catch {
            self.error = error.localizedDescription
        }
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
        selection = nil; textEditing = nil; textState = nil
        spine = nil; changedBeats = []; spineBeforeExternal = nil; materials = []
        edits.reset()
        edits.service = nil
        resetPublishing(folder)
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
            edits.service = sup.client
            publishing.service = sup.client
            spine = SpineSnapshot.load(root)
            chat.attachmentBase = root
            reloadMaterials()
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
            connectClaude(sup)
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
                reloadSpine()
                reloadCanvas()
            } else {
                // Keep showing the last good film.
                status = "Build failed"
                error = Self.describe(built.diagnostics)
            }
        case .notification(SidecarProtocol.Notification.changed, let params):
            // Claude's writes are not the human's: like a terminal edit they clear the undo stack and badge the beat.
            if let c: SidecarProtocol.ChangedParams = try? params?.decode(), c.source != .app {
                status = (c.source == .claude ? "Claude changed: " : "Changed: ") + c.paths.prefix(3).joined(separator: ", ")
                externalChange(c.paths)
            }
        case .notification(let method, let params):
            _ = handleClaudeNotification(method, params) || handlePublishNotification(method, params)
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
        if let filmURL, let filmRoot {
            let cacheDir = talk.map { ThumbnailCache.directory(for: $0, caches: ThumbnailCache.userCaches) }
                ?? filmRoot.appendingPathComponent(".sage/thumbs", isDirectory: true)
            thumbnails.setFilm(filmURL, talkRoot: filmRoot, cacheDirectory: cacheDir, holds: holds)
        }
        Task { await restoreEditing() } // the overlay, on an editable talk
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
        if let id, let h = holds.first(where: { $0.id == id }) {
            canvas.seek(h.at)
            if let b = h.beat { changedBeats.remove(b) }
        }
    }

    func scrub(to t: Double) { canvas.scrub(t) }
    // The transport's buttons always drive the film (playing commits any text being edited).
    func next() { canvas.next() }
    func prev() { canvas.prev() }
    func through() { canvas.through() }
    // The Play menu's keys (→, ←, Return) go to the canvas overlay first: with an object
    // selected they nudge it or edit its text, and with the caret in text they move it or
    // commit; otherwise they drive the film.
    func nextKey() { forwardKey("ArrowRight") { $0.next() } }
    func prevKey() { forwardKey("ArrowLeft") { $0.prev() } }
    func throughKey() { forwardKey("Enter") { $0.through() } }

    /// Play > Present / Rehearse, from the canvas's current time.
    func present(_ mode: PresenterState.Mode, offscreen: Bool = false) {
        guard let filmURL, let filmRoot, !holds.isEmpty else { return }
        canvas.pause()
        suspendEditingForPresenting()
        presentation.start(mode, film: filmURL, readAccess: filmRoot, holds: holds, duration: duration,
                           at: t, title: talk?.name ?? "Talk", offscreen: offscreen)
    }

    func revealInFinder() {
        guard let talk else { return }
        NSWorkspace.shared.activateFileViewerSelecting([talk.root])
    }
}
