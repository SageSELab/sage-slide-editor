import AppKit
import SageTalkCore
import SwiftUI

/// Present and Rehearse (PLAN 5.5). The film plays full screen in its own web view; the
/// presenter window (notes, next hold, clocks, the current frame mirrored) goes on another
/// display, or behind the film when both share one (⌘` switches between them). Which display
/// each goes on is the user's choice (Play ▸ Audience Display / Presenter Display, remembered;
/// Automatic puts the film on a projector), can be changed or swapped while presenting, and is
/// re-applied when a display is connected or disconnected (DisplayAssignment).
///
/// State flows through Swift only: the audience film's talk-sync messages ({t, playing}) come
/// in through FilmView's BroadcastChannel shim, update PresenterState, and are relayed to the
/// mirror with `T.render(t)`. Keys in either window go through the same local event monitor.
@MainActor @Observable
final class PresentationController {
    private(set) var state = PresenterState(holds: [], duration: 0)
    /// Ticks for the clocks.
    private(set) var now = Date()
    var isPresenting: Bool { state.isRunning }

    /// Called with the film time when presenting ends, so the editor can follow.
    @ObservationIgnored var onEnd: (Double) -> Void = { _ in }
    @ObservationIgnored let thumbnails: ThumbnailStore

    @ObservationIgnored private(set) var audience: FilmView?
    @ObservationIgnored private(set) var mirror: FilmView?
    @ObservationIgnored private(set) var audienceWindow: NSWindow?
    @ObservationIgnored private(set) var presenterWindow: NSWindow?
    @ObservationIgnored private var monitor: Any?
    @ObservationIgnored private var clock: Task<Void, Never>?
    @ObservationIgnored private var savedOptions: NSApplication.PresentationOptions?
    @ObservationIgnored private var closeObserver: NSObjectProtocol?
    @ObservationIgnored private var screenObserver: NSObjectProtocol?
    @ObservationIgnored private var offscreen = false

    /// Connected displays, refreshed when they change (the menus list them).
    private(set) var displays: [DisplayAssignment.Display] = []
    @ObservationIgnored private var screens: [NSScreen] = []
    /// The chosen displays (nil: Automatic). Remembered when the controller has a defaults store.
    var audienceChoice: DisplayAssignment.Choice? { didSet { remember(audienceChoice, Self.audienceKey); relayout() } }
    var presenterChoice: DisplayAssignment.Choice? { didSet { remember(presenterChoice, Self.presenterKey); relayout() } }
    static let audienceKey = "present.audienceDisplay", presenterKey = "present.presenterDisplay"
    @ObservationIgnored private let defaults: UserDefaults?

    init(thumbnails: ThumbnailStore, defaults: UserDefaults? = nil) {
        self.thumbnails = thumbnails
        self.defaults = defaults
        audienceChoice = Self.recall(Self.audienceKey, defaults)
        presenterChoice = Self.recall(Self.presenterKey, defaults)
        refreshDisplays()
        screenObserver = NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.refreshDisplays()
                self?.relayout()
            }
        }
    }

    /// Where the windows go now (indices into `displays`).
    var placement: DisplayAssignment.Placement? {
        DisplayAssignment.place(displays, audience: audienceChoice, presenter: presenterChoice)
    }

    /// Swaps the two displays (explicit choices from then on).
    func swapDisplays() {
        guard let p = placement, !p.shared else { return }
        let s = DisplayAssignment.swapped(displays, p)
        audienceChoice = s.audience
        presenterChoice = s.presenter
    }

    func refreshDisplays() {
        screens = NSScreen.screens
        let main = screens.first // the display with the menu bar
        displays = screens.map { sc in
            let n = (sc.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
            return DisplayAssignment.Display(id: n, name: sc.localizedName, isMain: sc == main)
        }
    }

    private func remember(_ c: DisplayAssignment.Choice?, _ key: String) {
        guard let defaults else { return }
        if let c, let data = try? JSONEncoder().encode(c) { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }

    private static func recall(_ key: String, _ defaults: UserDefaults?) -> DisplayAssignment.Choice? {
        guard let data = defaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(DisplayAssignment.Choice.self, from: data)
    }

    /// Opens both windows and starts. `offscreen` (self-test) parks both windows off screen and
    /// never activates the app or takes focus.
    func start(_ mode: PresenterState.Mode, film: URL, readAccess: URL, holds: [Hold], duration: Double,
               at: Double, title: String, offscreen: Bool = false) {
        if isPresenting { end() }
        state = PresenterState(holds: holds, duration: duration)
        self.offscreen = offscreen
        refreshDisplays()
        let frames = self.frames()
        let audienceFrame = frames.audience, presenterFrame = frames.presenter

        // The audience: a borderless window covering its display.
        let a = FilmView(frame: NSRect(origin: .zero, size: audienceFrame.size))
        let aw = KeyableWindow(contentRect: audienceFrame, styleMask: [.borderless], backing: .buffered, defer: false)
        aw.isReleasedWhenClosed = false
        aw.backgroundColor = .black
        aw.contentView = a.webView
        aw.title = "\(title) — Audience"
        a.onState = { [weak self] t, playing in self?.relay(t, playing) }
        a.load(film: film, readAccess: readAccess, at: at, capture: true)

        // The presenter: notes, next hold, clocks, and a mirror of the current frame.
        let m = FilmView(frame: NSRect(x: 0, y: 0, width: 960, height: 540))
        m.load(film: film, readAccess: readAccess, at: at, capture: true)
        let pw = NSWindow(contentRect: presenterFrame, styleMask: [.titled, .closable, .resizable, .miniaturizable],
                          backing: .buffered, defer: false)
        pw.isReleasedWhenClosed = false
        pw.title = "\(title) — Presenter"
        pw.contentView = NSHostingView(rootView: PresenterView(controller: self, mirror: m))
        pw.setFrame(presenterFrame, display: false)

        audience = a; mirror = m; audienceWindow = aw; presenterWindow = pw
        closeObserver = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: pw, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if self?.isPresenting == true { self?.end() } }
        }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            // Local monitors run on the main thread. Read what the key needs here, so only
            // Sendable values cross into the main-actor closure.
            let code = e.keyCode, mods = e.modifierFlags, window = e.window.map(ObjectIdentifier.init)
            let handled = MainActor.assumeIsolated { self?.handleKey(code: code, modifiers: mods, window: window) ?? false }
            return handled ? nil : e
        }

        if offscreen {
            pw.orderBack(nil)
            aw.orderBack(nil)
        } else {
            applyChrome()
            pw.orderFront(nil)
            aw.makeKeyAndOrderFront(nil)
            NSApp.activate()
        }
        thumbnails.requestAll()

        clock = Task { [weak self] in
            while !Task.isCancelled {
                self?.now = Date()
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
        let effects = state.start(mode, at: at, now: Date())
        Task { [weak self] in
            _ = await a.waitUntilReady()
            self?.apply(effects)
        }
    }

    /// The window frames for the current placement (off screen for the self-test).
    private func frames() -> (audience: NSRect, presenter: NSRect) {
        if offscreen { return (NSRect(x: -20000, y: -20000, width: 1280, height: 720), NSRect(x: -20000, y: -18000, width: 1280, height: 800)) }
        guard let p = placement, screens.indices.contains(p.audience), screens.indices.contains(p.presenter) else {
            return (NSRect(x: 0, y: 0, width: 1280, height: 720), NSRect(x: 60, y: 60, width: 1280, height: 800))
        }
        let inset: CGFloat = p.shared ? 1 : 0
        return (screens[p.audience].frame, screens[p.presenter].visibleFrame.insetBy(dx: 60 * inset, dy: 40 * inset))
    }

    /// Film above everything on its own display; the menu bar and Dock hidden when the film
    /// covers the main display.
    private func applyChrome() {
        guard let aw = audienceWindow, let p = placement else { return }
        aw.level = p.shared ? .normal : NSWindow.Level(rawValue: NSWindow.Level.mainMenu.rawValue + 1)
        let coversMain = displays.indices.contains(p.audience) && displays[p.audience].isMain
        if coversMain {
            if savedOptions == nil { savedOptions = NSApp.presentationOptions }
            NSApp.presentationOptions = [.hideDock, .hideMenuBar]
        } else if let saved = savedOptions {
            NSApp.presentationOptions = saved
            savedOptions = nil
        }
    }

    /// Moves the open windows to the current placement (a choice changed, a display came or went).
    private func relayout() {
        guard isPresenting, !offscreen, let aw = audienceWindow, let pw = presenterWindow else { return }
        let f = frames()
        aw.setFrame(f.audience, display: true)
        pw.setFrame(f.presenter, display: true)
        applyChrome()
        if placement?.shared == true { pw.orderFront(nil); aw.makeKeyAndOrderFront(nil) } else { pw.orderFront(nil); aw.orderFront(nil) }
    }

    /// A presenting key, from either window or the self-test.
    @discardableResult
    func press(_ key: PresenterState.Key) -> Bool {
        guard let fx = state.press(key, now: Date()) else { return false }
        apply(fx)
        return true
    }

    func end() {
        let fx = state.end(now: Date())
        apply(fx.isEmpty ? [.close] : fx)
    }

    private func handleKey(code: UInt16, modifiers: NSEvent.ModifierFlags, window: ObjectIdentifier?) -> Bool {
        let ours = [audienceWindow, presenterWindow].compactMap { $0 }.map(ObjectIdentifier.init)
        guard isPresenting, let window, ours.contains(window) else { return false }
        if !modifiers.intersection([.command, .control, .option]).isEmpty { return false }
        let key: PresenterState.Key? = switch code {
        case 49: .space
        case 124, 121: .right      // → and Page Down (clickers)
        case 123, 116: .left       // ← and Page Up
        case 36, 76: .enter
        case 53: .escape
        default: nil
        }
        guard let key else { return false }
        return press(key)
    }

    private func relay(_ t: Double, _ playing: Bool) {
        state.update(t: t, playing: playing)
        mirror?.scrub(t, render: true)
    }

    private func apply(_ effects: [PresenterState.Effect]) {
        for e in effects {
            switch e {
            case .seek(let t): audience?.seek(t)
            case .next: audience?.next()
            case .previous: audience?.prev()
            case .playThrough: audience?.through()
            case .close: close()
            }
        }
    }

    private func close() {
        let t = state.t
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if let closeObserver { NotificationCenter.default.removeObserver(closeObserver) }
        closeObserver = nil
        clock?.cancel(); clock = nil
        audience?.pause()
        if let savedOptions { NSApp.presentationOptions = savedOptions }
        savedOptions = nil
        audienceWindow?.orderOut(nil)
        presenterWindow?.orderOut(nil)
        audienceWindow?.close()
        presenterWindow?.close()
        audienceWindow = nil; presenterWindow = nil; audience = nil; mirror = nil
        onEnd(t)
    }
}

/// Borderless windows cannot become key by default; the audience window must, for its keys.
final class KeyableWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

/// The presenter display.
struct PresenterView: View {
    let controller: PresentationController
    let mirror: FilmView

    var body: some View {
        let s = controller.state, now = controller.now
        VStack(alignment: .leading, spacing: 18) {
            header(s, now)
            HStack(alignment: .top, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    caption("NOW")
                    FilmViewRepresentable(film: mirror)
                        .aspectRatio(16.0 / 9.0, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.15)))
                        .accessibilityIdentifier("presenter.mirror")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 8) {
                    caption("NEXT")
                    ZStack {
                        RoundedRectangle(cornerRadius: 6).fill(.white.opacity(0.06))
                        if let n = s.nextHold, let img = controller.thumbnails.image(for: n) {
                            Image(nsImage: img).resizable()
                        } else if s.nextHold == nil {
                            Text("End of talk").foregroundStyle(.secondary)
                        }
                    }
                    .aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text(s.nextLabel).font(.title3.weight(.semibold)).lineLimit(2)
                        .accessibilityIdentifier("presenter.next")
                }
                .frame(width: 320)
            }
            .frame(maxHeight: 420)
            VStack(alignment: .leading, spacing: 10) {
                caption("NOTES")
                Text(s.currentHold.map { $0.label.isEmpty ? "Hold \($0.index)" : $0.label } ?? "Press Space to begin")
                    .font(.title2.weight(.bold))
                ScrollView {
                    Text(s.notes.isEmpty ? "No notes for this hold." : s.notes)
                        .font(.system(size: 26))
                        .lineSpacing(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(s.notes.isEmpty ? .secondary : .primary)
                }
                .accessibilityIdentifier("presenter.notes")
            }
            .frame(maxHeight: .infinity, alignment: .top)
            Text("Space / → play to next hold · ← back · Return play through · Esc end")
                .font(.callout).foregroundStyle(.secondary)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(white: 0.07))
        .environment(\.colorScheme, .dark)
        .foregroundStyle(.white)
    }

    private func header(_ s: PresenterState, _ now: Date) -> some View {
        let remaining = s.remaining(now: now)
        return HStack(alignment: .firstTextBaseline, spacing: 30) {
            Text(now, format: .dateTime.hour().minute())
                .font(.system(size: 44, weight: .semibold)).monospacedDigit()
                .accessibilityIdentifier("presenter.clock")
            stat("ELAPSED", PresenterState.formatSigned(s.elapsed(now: now)), .white)
            stat("REMAINING", PresenterState.formatSigned(remaining) + " of " + HoldTimeline.format(s.target),
                 remaining < 0 ? .red : remaining < 60 ? .orange : .white)
            Spacer()
            Menu {
                DisplayChoiceMenus(controller: controller)
            } label: {
                Label("Displays", systemImage: "display.2")
            }
            .menuStyle(.borderlessButton).fixedSize()
            .help("Choose the displays for the film and these notes, or swap them")
            .accessibilityIdentifier("presenter.displays")
            VStack(alignment: .trailing, spacing: 4) {
                Text(s.mode == .rehearse ? "REHEARSING" : "PRESENTING")
                    .font(.caption.weight(.bold)).foregroundStyle(s.mode == .rehearse ? .orange : .green)
                Text(s.positionLabel + (s.playing ? " · ▶" : "")).monospacedDigit().foregroundStyle(.secondary)
            }
        }
    }

    private func stat(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            caption(label)
            Text(value).font(.system(size: 30, weight: .medium)).monospacedDigit().foregroundStyle(color)
        }
    }

    private func caption(_ s: String) -> some View {
        Text(s).font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(.secondary)
    }
}

/// Audience Display, Presenter Display and Swap Displays (the Play menu and the presenter header).
struct DisplayChoiceMenus: View {
    @Bindable var controller: PresentationController

    var body: some View {
        Menu("Audience Display") { picker($controller.audienceChoice, role: \.audience) }
            .accessibilityIdentifier("present.audienceDisplay")
        Menu("Presenter Display") { picker($controller.presenterChoice, role: \.presenter) }
            .accessibilityIdentifier("present.presenterDisplay")
        Button("Swap Displays") { controller.swapDisplays() }
            .disabled(controller.placement?.shared ?? true)
    }

    /// Automatic (naming where it lands now) and every connected display.
    @ViewBuilder
    private func picker(_ choice: Binding<DisplayAssignment.Choice?>, role: KeyPath<DisplayAssignment.Placement, Int>) -> some View {
        let ds = controller.displays
        let auto = DisplayAssignment.place(ds, audience: nil, presenter: nil).map { ds[$0[keyPath: role]].name }
        Picker("Display", selection: choice) {
            Text(auto.map { "Automatic (\($0))" } ?? "Automatic").tag(DisplayAssignment.Choice?.none)
            ForEach(ds, id: \.id) { d in
                Text(d.isMain ? "\(d.name) (main)" : d.name).tag(Optional(DisplayAssignment.Choice(d)))
            }
            // A remembered display that is not connected stays listed, so the choice is visible.
            if let c = choice.wrappedValue, DisplayAssignment.find(c, in: ds) == nil {
                Text("\(c.name) (not connected)").tag(Optional(c))
            }
        }
        .pickerStyle(.inline).labelsHidden()
    }
}
