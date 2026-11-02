import AppKit
import SageTalkCore
import WebKit

/// What the engine reports once it has booted.
struct FilmInfo: Equatable {
    var holds: [Hold]
    var chapters: [ChapterInfo]
    var duration: Double
}

/// One WKWebView running the real film (canvas, thumbnail renderer, audience screen, presenter
/// mirror). Rendering always goes through the engine's deterministic render(t); this class seeks,
/// plays, snapshots, and reads state back.
///
/// The engine's own `talk-sync` BroadcastChannel is replaced by a shim that posts to Swift
/// (spikes/webkit/FINDINGS.md, E): the app sees `{t, playing}` after every render and relays it
/// itself, and no two web views ever talk to each other directly.
@MainActor
final class FilmView: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    private(set) var info: FilmInfo?
    private(set) var t: Double = 0
    private(set) var playing = false
    /// Counts engine boots; a reload bumps it.
    private(set) var readyCount = 0
    private(set) var film: URL?

    var onReady: (FilmInfo) -> Void = { _ in }
    var onState: (_ t: Double, _ playing: Bool) -> Void = { _, _ in }
    var onLoadError: (String) -> Void = { _ in }
    /// Messages from the editing overlay (canvas.js), when it is enabled.
    var onCanvas: (CanvasMessage) -> Void = { _ in }

    private var readyWaiters: [CheckedContinuation<FilmInfo?, Never>] = []

    init(frame: NSRect = .zero) {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let ucc = WKUserContentController()
        config.userContentController = ucc
        webView = WKWebView(frame: frame, configuration: config)
        super.init()
        ucc.add(WeakMessageHandler(self), name: "sage")
        ucc.addUserScript(WKUserScript(source: Self.shimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.addUserScript(WKUserScript(source: Self.bridgeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView.navigationDelegate = self
    }

    /// Loads the film. `capture` hides the engine's own scrub bar (audience, mirror, thumbnails).
    func load(film: URL, readAccess: URL, at time: Double? = nil, capture: Bool = false) {
        self.film = film
        info = nil
        var c = URLComponents(url: film, resolvingAgainstBaseURL: false)!
        var q: [URLQueryItem] = []
        if let time { q.append(URLQueryItem(name: "t", value: String(time))) }
        if capture { q.append(URLQueryItem(name: "capture", value: nil)) }
        c.queryItems = q.isEmpty ? nil : q
        webView.loadFileURL(c.url ?? film, allowingReadAccessTo: readAccess)
    }

    /// Waits for the next engine boot (or returns at once if it has booted since the last load).
    func waitUntilReady(timeout: Duration = .seconds(20)) async -> FilmInfo? {
        if let info { return info }
        let timer = Task { [weak self] in
            try? await Task.sleep(for: timeout)
            self?.releaseWaiters(nil)
        }
        defer { timer.cancel() }
        return await withCheckedContinuation { readyWaiters.append($0) }
    }

    private func releaseWaiters(_ info: FilmInfo?) {
        let w = readyWaiters
        readyWaiters.removeAll()
        for c in w { c.resume(returning: info) }
    }

    // MARK: Driving the engine

    func seek(_ t: Double) { run("T.seek(\(Self.num(t)))") }

    /// Seeks for a dragged scrubber: at most one seek in flight, intermediate positions dropped,
    /// so renders never queue up behind slow paints (FINDINGS D).
    /// `render` instead of `seek` draws without touching play state (the presenter mirror).
    func scrub(_ t: Double, render: Bool = false) {
        if scrubInFlight { scrubPending = (t, render); return }
        scrubInFlight = true
        webView.evaluateJavaScript("window.T && (T.\(render ? "render" : "seek")(\(Self.num(t))), 0)") { [weak self] _, _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.scrubInFlight = false
                if let next = self.scrubPending { self.scrubPending = nil; self.scrub(next.0, render: next.1) }
            }
        }
    }
    private var scrubInFlight = false
    private var scrubPending: (Double, Bool)?
    /// Draws a frame without touching play state (the presenter mirror).
    func render(_ t: Double) { run("T.render(\(Self.num(t)))") }
    func next() { run("T.next()") }
    func prev() { run("T.prev()") }
    func through() { run("T.through()") }
    func pause() { run("T.pause()") }

    private func run(_ js: String) {
        webView.evaluateJavaScript("window.T && (\(js), 0)", completionHandler: nil)
    }

    /// Runs a function body (may `await`) and returns its result.
    func call(_ body: String, _ args: [String: Any] = [:]) async throws -> Any? {
        try await webView.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
    }

    /// The current frame, `width` points wide.
    func snapshot(width: CGFloat) async throws -> NSImage {
        let c = WKSnapshotConfiguration()
        c.snapshotWidth = NSNumber(value: Double(width))
        c.afterScreenUpdates = true
        return try await webView.takeSnapshot(configuration: c)
    }

    private static func num(_ t: Double) -> String { t.isFinite ? String(t) : "0" }

    // MARK: Messages

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any], let kind = dict["kind"] as? String else { return }
        switch kind {
        case "ready":
            let info = Self.parseInfo(dict)
            self.info = info
            readyCount += 1
            t = dict["t"] as? Double ?? 0
            onReady(info)
            releaseWaiters(info)
        case "canvas":
            if let msg = CanvasMessage.parse(dict) { onCanvas(msg) }
        case "bc":
            // The engine's talk-sync broadcast: {t, playing, started} after each render and pause.
            guard dict["name"] as? String == "talk-sync", let data = dict["data"] as? [String: Any],
                  let t = data["t"] as? Double else { return }
            self.t = t
            playing = data["playing"] as? Bool ?? false
            onState(t, playing)
        default: break
        }
    }

    static func parseInfo(_ dict: [String: Any]) -> FilmInfo {
        let rawHolds = dict["holds"] as? [[String: Any]] ?? []
        let holds = rawHolds.enumerated().map { i, h -> Hold in
            let id = h["id"] as? String ?? ""
            let chapter = id.split(separator: ".", maxSplits: 1).count == 2 ? String(id.split(separator: ".")[0]) : nil
            let notes = h["notes"] as? String
            return Hold(index: i + 1, at: h["at"] as? Double ?? 0, label: h["label"] as? String ?? "",
                        backup: h["backup"] as? Bool ?? false, chapter: chapter,
                        notes: notes?.isEmpty == false ? notes : nil, beat: chapter == nil ? nil : id)
        }
        let chapters = (dict["chapters"] as? [[String: Any]] ?? []).map { c in
            ChapterInfo(id: c["id"] as? String ?? "", label: c["label"] as? String ?? "",
                        at: c["at"] as? Double ?? 0, dark: c["dark"] as? Bool ?? false)
        }
        return FilmInfo(holds: holds, chapters: chapters, duration: dict["duration"] as? Double ?? 0)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        onLoadError(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        onLoadError(error.localizedDescription)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        onLoadError("The film's web content process stopped.")
    }

    // MARK: Scripts

    /// Document start: a BroadcastChannel that hands every message to Swift.
    private static let shimJS = """
    (function () {
      const post = (m) => { try { window.webkit.messageHandlers.sage.postMessage(m); } catch (e) {} };
      const all = [];
      class RelayChannel {
        constructor(name) { this.name = String(name); this.onmessage = null; all.push(this); }
        postMessage(data) { post({ kind: 'bc', name: this.name, data: JSON.parse(JSON.stringify(data ?? null)) }); }
        close() {}
        addEventListener() {}
        removeEventListener() {}
      }
      window.__bcDeliver = (name, data) => { for (const c of all) if (c.name === name && c.onmessage) c.onmessage({ data }); };
      window.BroadcastChannel = RelayChannel;
    })();
    """

    /// Document end: report holds, notes, chapters and duration once the engine has booted
    /// and its fonts are loaded.
    private static let bridgeJS = """
    (function () {
      const post = (m) => { try { window.webkit.messageHandlers.sage.postMessage(m); } catch (e) {} };
      let tries = 0;
      const wait = setInterval(() => {
        const T = window.T;
        if (!T && ++tries < 200) return;
        clearInterval(wait);
        if (!T) return;
        const report = () => post({
          kind: 'ready', t: T.t, duration: T.duration,
          holds: T.cps.map((c) => ({ at: c.at, label: c.label || '', backup: !!c.backup, notes: c.notes || '', id: c.id || '' })),
          chapters: (T.chapters || []).map((c, i) => ({ id: c.id || ('chapter' + (i + 1)), label: c.label || '', at: c.at, dark: !!c.dark })),
        });
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(report, report);
      }, 25);
    })();
    """
}

/// Breaks the WKUserContentController -> handler retain cycle.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(ucc, didReceive: message)
    }
}

extension NSImage {
    var pngData: Data? {
        guard let cg = cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        return NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
    }
}
