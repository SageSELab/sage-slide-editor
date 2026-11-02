import AppKit
import SageTalkCore
import WebKit

/// Navigator thumbnails (PLAN 5.2): a hidden WKWebView seeks to each hold with `T.seek(at)` and
/// takes a `takeSnapshot`, cached on disk by `ThumbnailCache`.
///
/// Rendering is lazy: a row asks for its thumbnail when it appears, and after a rebuild only
/// the holds already asked for are revisited. Each revisit fingerprints the rendered frame and
/// snapshots only when that changed; an unchanged frame adopts its previous PNG.
///
/// Offscreen stall (spikes/webkit/FINDINGS.md, C): WebKit stops requestAnimationFrame in an
/// occluded window. Nothing here waits for rAF: `T.seek` renders synchronously, the fingerprint
/// reads computed style (which forces style and layout), and `takeSnapshot` asks WebKit for a
/// fresh paint itself. So no private API is used.
@MainActor @Observable
final class ThumbnailStore {
    /// Thumbnail width in points (about 200 px at 1x, 400 px on Retina).
    static let width: CGFloat = 200

    private(set) var images: [String: NSImage] = [:]
    private(set) var freshKeys: Set<String> = []
    /// Counters for the self-test and the status line.
    private(set) var rendered = 0
    private(set) var adopted = 0
    private(set) var loadedFromDisk = 0
    private(set) var busy = false

    @ObservationIgnored private var cache: ThumbnailCache?
    @ObservationIgnored private var film: URL?
    @ObservationIgnored private var readAccess: URL?
    @ObservationIgnored private var filmHash: String?
    @ObservationIgnored private var holds: [Hold] = []
    @ObservationIgnored private var requested: [String: Hold] = [:]
    @ObservationIgnored private var queue: [Hold] = []
    @ObservationIgnored private var renderer: FilmView?
    @ObservationIgnored private var window: NSWindow?
    @ObservationIgnored private var rendererHash: String?

    func image(for hold: Hold) -> NSImage? { images[ThumbnailCache.timeKey(hold.at)] }
    func isFresh(_ hold: Hold) -> Bool { freshKeys.contains(ThumbnailCache.timeKey(hold.at)) }

    /// Holds asked for that are not current yet.
    var pendingCount: Int { requested.keys.filter { !freshKeys.contains($0) }.count }

    /// A talk was opened or rebuilt. Stale thumbnails stay visible until replaced.
    func setFilm(_ film: URL, talkRoot: URL, holds: [Hold]) {
        if cache?.directory != ThumbnailCache(talkRoot: talkRoot).directory {
            cache = ThumbnailCache(talkRoot: talkRoot)
            images = [:]
            requested = [:]
            queue = []
        }
        self.film = film
        readAccess = talkRoot
        self.holds = holds
        filmHash = try? ThumbnailCache.filmHash(of: film)
        freshKeys = []
        let times = Set(holds.map { ThumbnailCache.timeKey($0.at) })
        requested = requested.filter { times.contains($0.key) }
        queue = []
        for h in holds.sorted(by: { $0.index < $1.index }) where requested[ThumbnailCache.timeKey(h.at)] != nil {
            enqueue(h)
        }
        pump()
    }

    func close() {
        cache = nil; film = nil; filmHash = nil
        images = [:]; freshKeys = []; requested = [:]; queue = []; holds = []
        window?.close(); window = nil; renderer = nil; rendererHash = nil
    }

    /// A navigator row became visible.
    func request(_ hold: Hold) {
        let key = ThumbnailCache.timeKey(hold.at)
        guard requested[key] == nil else { return }
        requested[key] = hold
        enqueue(hold)
        pump()
    }

    /// Asks for every hold (the self-test, and presenting, which shows the next hold).
    func requestAll() { for h in holds { request(h) } }

    private func enqueue(_ h: Hold) {
        let key = ThumbnailCache.timeKey(h.at)
        guard let cache, let filmHash else { return }
        switch cache.status(at: h.at, film: filmHash) {
        case .fresh(let url):
            if !freshKeys.contains(key), let img = NSImage(contentsOf: url) {
                images[key] = img
                freshKeys.insert(key)
                loadedFromDisk += 1
            }
        case .stale(let old):
            if images[key] == nil, let old, let img = NSImage(contentsOf: old) { images[key] = img }
            if !queue.contains(where: { $0.at == h.at }) { queue.append(h) }
        }
    }

    private func pump() {
        guard !busy, !queue.isEmpty else { return }
        busy = true
        Task { await drain() }
    }

    private func drain() async {
        defer { busy = false }
        var dirty = 0
        while !queue.isEmpty {
            let h = queue.removeFirst()
            guard let film, let filmHash, var cache = self.cache else { break }
            let key = ThumbnailCache.timeKey(h.at)
            if case .fresh = cache.status(at: h.at, film: filmHash) { enqueue(h); continue }
            guard let r = await renderer(for: film, hash: filmHash) else { break }
            r.seek(h.at)
            do {
                let frame = try await r.call(Self.fingerprintJS) as? String ?? ""
                if let old = cache.reusable(at: h.at, frame: frame) {
                    let u = try cache.adopt(old, at: h.at, film: filmHash, frame: frame)
                    if images[key] == nil { images[key] = NSImage(contentsOf: u) }
                    adopted += 1
                } else {
                    let img = try await r.snapshot(width: Self.width)
                    guard let png = img.pngData else { continue }
                    try cache.store(png, at: h.at, film: filmHash, frame: frame)
                    images[key] = img
                    rendered += 1
                }
                // The film may have changed while this hold rendered; only then is it stale.
                if self.filmHash == filmHash { freshKeys.insert(key) }
                self.cache = cache
                dirty += 1
                if dirty % 10 == 0 { try? cache.save() }
            } catch {
                FileHandle.standardError.write(Data("[thumbs] \(h.at): \(error.localizedDescription)\n".utf8))
            }
        }
        if dirty > 0, var cache {
            cache.prune(keepingTimes: holds.map(\.at))
            try? cache.save()
            self.cache = cache
        }
    }

    /// The hidden web view, loaded with this film. It lives in a borderless window parked far
    /// off screen: it never shows, never takes focus, and the app does not activate for it.
    private func renderer(for film: URL, hash: String) async -> FilmView? {
        if renderer == nil {
            let frame = NSRect(x: 0, y: 0, width: 960, height: 540)
            let r = FilmView(frame: frame)
            let w = NSWindow(contentRect: frame.offsetBy(dx: -20000, dy: -20000), styleMask: [.borderless],
                             backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.ignoresMouseEvents = true
            w.contentView = r.webView
            w.orderBack(nil)
            renderer = r
            window = w
        }
        guard let r = renderer, let readAccess else { return nil }
        if rendererHash != hash {
            r.onLoadError = { e in FileHandle.standardError.write(Data("[thumbs] load failed: \(e)\n".utf8)) }
            r.load(film: film, readAccess: readAccess, capture: true)
            guard await r.waitUntilReady() != nil else {
                FileHandle.standardError.write(Data("[thumbs] the film did not boot in the thumbnail renderer\n".utf8))
                return nil
            }
            rendererHash = hash
        }
        return r
    }

    /// A fingerprint of what is visible after a seek: every element with a non-zero effective
    /// opacity, its attributes, text, and the computed properties animations drive, plus the
    /// page's style sheets. Two 32-bit FNV-1a hashes with different seeds.
    static let fingerprintJS = """
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
    const mix = (s) => {
      s = String(s);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
        h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
      }
      h1 = Math.imul(h1 ^ 0xff, 16777619) >>> 0;
    };
    const walk = (el, op) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const o = op * parseFloat(cs.opacity || '1');
      if (o < 0.002) return;
      const attrs = [...el.attributes].map((a) => a.name + '=' + a.value).join(' ');
      mix(el.tagName + ' ' + attrs + ' | ' + cs.opacity + ' ' + cs.transform + ' ' + cs.filter + ' ' + cs.clipPath + ' '
          + cs.strokeDashoffset + ' ' + cs.color + ' ' + cs.backgroundColor + ' ' + cs.offsetDistance);
      for (const n of el.childNodes) {
        if (n.nodeType === 3) mix('#' + n.data);
        else if (n.nodeType === 1) walk(n, o);
      }
    };
    const stage = document.querySelector('.stage') || document.body;
    walk(stage, 1);
    for (const s of document.querySelectorAll('style')) mix(s.textContent);
    mix(innerWidth + 'x' + innerHeight);
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    """
}
