// wkspike: Phase 0 WKWebView spike for the SAGE talk editor.
//
//   wkspike snap   <index.html> <outDir> <mode: reload|seek|seek-shuffled> <t1,t2,...> [--scale 1|2]
//   wkspike scrub  <index.html> <outJson> [--seconds N]
//   wkspike relay  <index.html> <outJson>
//   wkspike probe  <index.html> <outJson>
//   wkspike show   <index.html> <outPng> [query] [secs]   visible window + takeSnapshot; prints CONTENT x,y,w,h for screencapture -R
//   wkspike sck    <index.html> <outPrefix> [query]       ScreenCaptureKit capture of a visible and an offscreen window
//
// Everything runs inside a real NSApplication run loop with real WKWebViews.
import AppKit
import WebKit
import ScreenCaptureKit

// MARK: - helpers

func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

func fileURL(_ html: String, query: String) -> URL {
    var c = URLComponents(url: URL(fileURLWithPath: html), resolvingAgainstBaseURL: false)!
    c.percentEncodedQuery = query
    return c.url!
}

func writeJSON(_ obj: Any, to path: String) {
    let d = try! JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
    try! d.write(to: URL(fileURLWithPath: path))
}

/// Saves an NSImage as a PNG of exactly w x h pixels (redrawing if the snapshot came back at another scale).
func savePNG(_ img: NSImage, w: Int, h: Int, to path: String) -> (Int, Int) {
    var r = CGRect(x: 0, y: 0, width: img.size.width, height: img.size.height)
    let cg = img.cgImage(forProposedRect: &r, context: nil, hints: nil)!
    let native = (cg.width, cg.height)
    var out = cg
    if cg.width != w || cg.height != h {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        out = ctx.makeImage()!
    }
    let rep = NSBitmapImageRep(cgImage: out)
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
    return native
}

/// Calls a private `-(void)sel:(BOOL)` setter if the object responds to it.
func setBoolSPI(_ obj: NSObject, _ name: String, _ value: Bool) {
    let sel = NSSelectorFromString(name)
    guard obj.responds(to: sel), let m = class_getInstanceMethod(type(of: obj), sel) else { log("SPI \(name) unavailable"); return }
    typealias Fn = @convention(c) (AnyObject, Selector, Bool) -> Void
    unsafeBitCast(method_getImplementation(m), to: Fn.self)(obj, sel, value)
}

/// A web view in its own window. Offscreen windows are borderless and parked far off any screen,
/// which keeps the page "visible" to WebKit (no rAF throttling) without showing anything.
@MainActor
final class Host: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let web: WKWebView
    let window: NSWindow
    var loadCont: CheckedContinuation<Void, Never>?
    var onMessage: ((String, Any) -> Void)?

    init(width: CGFloat, height: CGFloat, offscreen: Bool, title: String, userScripts: [String] = [], handlers: [String] = []) {
        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let ucc = WKUserContentController()
        for s in userScripts { ucc.addUserScript(WKUserScript(source: s, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        cfg.userContentController = ucc
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: cfg)
        if offscreen {
            window = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
        } else {
            window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: width, height: height), styleMask: [.titled, .closable], backing: .buffered, defer: false)
            window.title = title
        }
        window.isReleasedWhenClosed = false // ARC owns it; the AppKit default would over-release on close
        window.contentView = web
        // Offscreen windows are "occluded", and WebKit then stops rAF and painting. This SPI
        // (used by Safari for background tabs it wants live) turns occlusion detection off.
        if offscreen && ProcessInfo.processInfo.environment["WK_OCCLUSION"] == nil {
            setBoolSPI(web, "_setWindowOcclusionDetectionEnabled:", false)
        }
        super.init()
        web.navigationDelegate = self
        for h in handlers { ucc.add(self, name: h) }
        if offscreen { window.setFrameOrigin(NSPoint(x: -20000, y: -20000)) }
        window.orderFrontRegardless()
    }

    func load(_ url: URL, readAccess: URL) async {
        await withCheckedContinuation { c in
            loadCont = c
            web.loadFileURL(url, allowingReadAccessTo: readAccess)
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loadCont?.resume(); loadCont = nil }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { log("nav fail \(error)"); loadCont?.resume(); loadCont = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { log("prov fail \(error)"); loadCont?.resume(); loadCont = nil }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        onMessage?(message.name, message.body)
    }

    @discardableResult
    func js(_ src: String, _ args: [String: Any] = [:]) async -> Any? {
        do { return try await web.callAsyncJavaScript(src, arguments: args, in: nil, contentWorld: .page) }
        catch { log("js error: \(error)"); return nil }
    }

    /// fonts.ready + two animation frames: the same settle step as the Playwright harness.
    func settle() async { await js("await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return 1") }

    func snapshot(width: CGFloat) async -> NSImage {
        let c = WKSnapshotConfiguration()
        c.rect = web.bounds
        c.snapshotWidth = NSNumber(value: Double(width))
        c.afterScreenUpdates = true
        return try! await web.takeSnapshot(configuration: c)
    }
}

// MARK: - C. snapshots

@MainActor
func runSnap(_ a: [String]) async {
    let html = a[0], outDir = a[1], mode = a[2]
    let times = a[3].split(separator: ",").map { Double($0)! }
    let scaleArg = a.firstIndex(of: "--scale").map { Double(a[$0 + 1])! } ?? 1
    try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    let h = Host(width: 1920, height: 1080, offscreen: true, title: "snap")
    let backing = h.window.backingScaleFactor
    // snapshotWidth is in points; the image comes back at points * backing scale.
    // To get a 1x render (comparable to Playwright deviceScaleFactor 1) ask for 1920 / backing points.
    let snapW = 1920 / backing * scaleArg
    var frames: [[String: Any]] = []
    var order = times
    if mode == "seek-shuffled" { var g = SystemRandomNumberGenerator(); order.shuffle(using: &g) }
    if mode != "reload" {
        await h.load(fileURL(html, query: "t=0&capture"), readAccess: dir)
        await h.settle()
    }
    var vis = "?"
    for t in order {
        let t0 = CACurrentMediaTime()
        if mode == "reload" {
            await h.load(fileURL(html, query: "t=\(t)&capture"), readAccess: dir)
        } else {
            await h.js("T.seek(t); return 1", ["t": t])
        }
        let t1 = CACurrentMediaTime()
        await h.settle()
        vis = await h.js("return document.visibilityState") as? String ?? "?"
        let img = await h.snapshot(width: snapW)
        let t2 = CACurrentMediaTime()
        let name = "t" + String(format: "%08.3f", t) + ".png"
        let native = savePNG(img, w: 1920, h: 1080, to: "\(outDir)/\(name)")
        frames.append(["file": name, "t": t, "loadOrSeekMs": (t1 - t0) * 1000, "settleSnapMs": (t2 - t1) * 1000, "nativePx": [native.0, native.1]])
        log("\(mode) t=\(t) \(name) native=\(native) load/seek=\(Int((t1 - t0) * 1000))ms settle+snap=\(Int((t2 - t1) * 1000))ms")
    }
    writeJSON(["engine": "WKWebView", "mode": mode, "backingScale": backing, "snapshotWidthPoints": snapW, "visibilityState": vis,
               "frames": frames.sorted { ($0["t"] as! Double) < ($1["t"] as! Double) }], to: "\(outDir)/wk-manifest.json")
}

// MARK: - D. scrub performance

@MainActor
func runScrub(_ a: [String]) async {
    let html = a[0], outJson = a[1]
    let seconds = a.firstIndex(of: "--seconds").map { Double(a[$0 + 1])! }
    let windowed = a.contains("--windowed")
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    let h = Host(width: 1280, height: 720, offscreen: false, title: "scrub")
    NSApp.activate(ignoringOtherApps: true)
    await h.load(fileURL(html, query: "capture"), readAccess: dir)
    await h.settle()
    let res = await h.js("""
      const D = seconds ?? T.duration;
      let check = null;
      if (windowed) {
        // Engine variant: only touch animations whose [start, end] overlaps the interval we moved
        // across. Paused WAAPI animations clamp outside their interval, so the others cannot change.
        const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
        const idx = T.anims.map((a) => { const tm = a.effect.getTiming(); return [tm.delay, tm.delay + tm.duration, a]; });
        let prev = T.t * 1000;
        const full = T.render.bind(T);
        T.render = function (t) {
          this.t = clamp(t, 0, this.duration);
          const ms = this.t * 1000, lo = Math.min(prev, ms), hi = Math.max(prev, ms);
          for (const [s, e, a] of idx) if (e >= lo && s <= hi) a.currentTime = ms;
          prev = ms;
          for (const tw of this.tweens) tw.fn(tw.ease(clamp((this.t - tw.t) / tw.dur, 0, 1)));
          this.ui?.sync(); this.sync?.(); this.onRender?.(this.t);
        };
        // Correctness: random walk with the windowed render, then compare computed styles with a full render.
        const targets = [...new Set(T.anims.map((a) => a.effect.target))];
        const snap = () => targets.map((e) => { const c = getComputedStyle(e); return c.opacity + '|' + c.transform + '|' + c.filter + '|' + c.strokeDashoffset + '|' + c.offsetDistance; });
        let mism = 0;
        for (let i = 0; i < 200; i++) { const t = Math.random() * T.duration; T.render(t); const a1 = snap(); full(t); const a2 = snap(); prev = t * 1000; a1.forEach((v, k) => { if (v !== a2[k]) mism++; }); }
        check = { randomWalkSteps: 200, targets: targets.length, styleMismatches: mism };
      }
      const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
      const stats = (xs) => ({ n: xs.length, median: q(xs, .5), p95: q(xs, .95), p99: q(xs, .99), max: Math.max(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length });
      // 1. Sequential sweep 0 -> D at 1/60 s of film time per animation frame (60 steps/sec).
      const renderMs = [], layoutMs = [], frameMs = [];
      let t = 0, last = 0;
      await new Promise((done) => {
        const step = (now) => {
          if (last) frameMs.push(now - last);
          last = now;
          const a = performance.now();
          T.render(t);
          const b = performance.now();
          document.body.offsetHeight; // force style + layout so its cost is counted
          const c = performance.now();
          renderMs.push(b - a); layoutMs.push(c - a);
          t += 1 / 60;
          if (t <= D) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
      // 2. Random jumps (scrubber drags across chapters): 600 seeks to random times.
      const jumpMs = [], jumpFrame = []; last = 0; let k = 0;
      await new Promise((done) => {
        const step = (now) => {
          if (last) jumpFrame.push(now - last);
          last = now;
          const a = performance.now();
          T.render(Math.random() * T.duration); document.body.offsetHeight;
          jumpMs.push(performance.now() - a);
          if (++k < 600) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
      return JSON.stringify({ windowed, check, duration: D, anims: T.anims.length, tweens: T.tweens.length,
        sweep: { renderJs: stats(renderMs), renderPlusLayout: stats(layoutMs), rafInterval: stats(frameMs),
                 framesOver20ms: frameMs.filter((x) => x > 20).length, framesOver33ms: frameMs.filter((x) => x > 33.4).length },
        randomJumps: { renderPlusLayout: stats(jumpMs), rafInterval: stats(jumpFrame), framesOver20ms: jumpFrame.filter((x) => x > 20).length } });
    """, ["seconds": seconds as Any? ?? NSNull(), "windowed": windowed])
    let s = res as? String ?? "{}"
    try! s.data(using: .utf8)!.write(to: URL(fileURLWithPath: outJson))
    log(s)
}

// MARK: - E. presenter relay

/// A BroadcastChannel stand-in that hands every message to Swift, which fans it out to the other views.
let bcShim = """
(() => {
  const chans = new Set();
  class RelayChannel {
    constructor(name) { this.name = name; this.onmessage = null; this._l = new Set(); chans.add(this); }
    postMessage(data) { window.webkit.messageHandlers.bc.postMessage({ name: this.name, data: JSON.parse(JSON.stringify(data)), sentAt: Date.now() }); }
    addEventListener(type, fn) { if (type === 'message') this._l.add(fn); }
    removeEventListener(type, fn) { this._l.delete(fn); }
    close() { chans.delete(this); }
  }
  window.__bcDeliver = (name, data, sentAt) => {
    window.__bcLatency = (window.__bcLatency || []); window.__bcLatency.push(Date.now() - sentAt);
    for (const c of chans) if (c.name === name) { const ev = { data }; c.onmessage?.(ev); c._l.forEach((f) => f(ev)); }
  };
  window.BroadcastChannel = RelayChannel;
  window.__bcShim = true;
})();
"""

@MainActor
func runRelay(_ a: [String]) async {
    let html = a[0], outJson = a[1]
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    var result: [String: Any] = [:]

    // Phase 1: native BroadcastChannel between two WKWebViews in this process.
    do {
        let main = Host(width: 960, height: 540, offscreen: false, title: "main (native BC)")
        let pres = Host(width: 960, height: 600, offscreen: false, title: "presenter (native BC)")
        pres.window.setFrameOrigin(NSPoint(x: 1100, y: 80))
        await main.load(fileURL(html, query: "capture"), readAccess: dir)
        await pres.load(fileURL(html, query: "presenter=1"), readAccess: dir)
        await main.settle(); await pres.settle()
        // Also a bare channel test independent of the deck.
        await pres.js("window.__got = []; const c = new BroadcastChannel('spike'); c.onmessage = (e) => window.__got.push(e.data); window.__c = c; return 1")
        await main.js("new BroadcastChannel('spike').postMessage({ hi: 1 }); T.seek(100); return 1")
        try? await Task.sleep(nanoseconds: 800_000_000)
        let bare = await pres.js("return JSON.stringify(window.__got)") as? String ?? "?"
        let presT = await pres.js("return T.t") as? Double ?? -1
        let origin = await main.js("return location.origin + ' ' + (typeof BroadcastChannel)") as? String ?? "?"
        result["native"] = ["bareChannelReceived": bare, "presenterTAfterMainSeek100": presT, "works": presT == 100, "origin": origin]
        log("native BroadcastChannel: bare=\(bare) presenter T.t=\(presT) origin=\(origin)")
        main.window.close(); pres.window.close()
    }

    // Phase 2: Swift relay. Both views get a BroadcastChannel shim; Swift forwards each message
    // from one view to every other view with evaluateJavaScript. The deck runs unmodified.
    do {
        let main = Host(width: 960, height: 540, offscreen: false, title: "main (Swift relay)", userScripts: [bcShim], handlers: ["bc"])
        let pres = Host(width: 960, height: 600, offscreen: false, title: "presenter (Swift relay)", userScripts: [bcShim], handlers: ["bc"])
        pres.window.setFrameOrigin(NSPoint(x: 1100, y: 80))
        var relayed = 0
        var swiftHopMs: [Double] = []
        let views = [main, pres]
        for src in views {
            src.onMessage = { _, body in
                guard let m = body as? [String: Any], let name = m["name"] as? String, let data = m["data"], let sentAt = m["sentAt"] as? Double else { return }
                let t0 = CACurrentMediaTime()
                for dst in views where dst !== src {
                    relayed += 1
                    dst.web.callAsyncJavaScript("__bcDeliver(name, data, sentAt)", arguments: ["name": name, "data": data, "sentAt": sentAt], in: nil, in: .page) { _ in
                        swiftHopMs.append((CACurrentMediaTime() - t0) * 1000)
                    }
                }
            }
        }
        await main.load(fileURL(html, query: "capture"), readAccess: dir)
        await pres.load(fileURL(html, query: "presenter=1"), readAccess: dir)
        await main.settle(); await pres.settle()
        await main.js("T.seek(100); return 1")
        try? await Task.sleep(nanoseconds: 300_000_000)
        let presT1 = await pres.js("return T.t") as? Double ?? -1
        let pos1 = await pres.js("return document.querySelector('.pres-pos')?.textContent ?? ''") as? String ?? ""
        // Presenter -> main: the presenter's Space key sends {cmd:'next'}; main plays to the next hold.
        let before = await main.js("return T.t") as? Double ?? -1
        await pres.js("dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); return 1")
        try? await Task.sleep(nanoseconds: 300_000_000)
        let playing = await main.js("return T.playing") as? Bool ?? false
        let presPlaying = await pres.js("return T.playing") as? Bool ?? false
        try? await Task.sleep(nanoseconds: 6_000_000_000)
        let after = await main.js("return T.t") as? Double ?? -1
        let presAfter = await pres.js("return T.t") as? Double ?? -1
        let lat = await pres.js("const l = window.__bcLatency || []; const s = [...l].sort((a,b)=>a-b); return JSON.stringify({ n: s.length, median: s[Math.floor(s.length/2)], p95: s[Math.floor(.95*(s.length-1))], max: s[s.length-1] })") as? String ?? "?"
        let hop = swiftHopMs.sorted()
        result["swiftRelay"] = [
            "presenterTAfterMainSeek100": presT1, "presenterPosText": pos1,
            "mainTBeforeNext": before, "mainPlayingAfterPresenterSpace": playing, "presenterSawPlaying": presPlaying,
            "mainTAfterPlayToHold": after, "presenterTAfterPlayToHold": presAfter,
            "messagesRelayed": relayed, "presenterDeliveryLatencyMs": lat,
            "swiftHopMs": ["n": hop.count, "median": hop.isEmpty ? 0 : hop[hop.count / 2], "p95": hop.isEmpty ? 0 : hop[Int(0.95 * Double(hop.count - 1))]],
        ]
        log("swift relay: \(result["swiftRelay"]!)")
        main.window.close(); pres.window.close()
    }
    writeJSON(result, to: outJson)
}

// MARK: - F. capability probe

let probeJS = """
const r = {};
r.userAgent = navigator.userAgent;
// WAAPI: paused animation, currentTime scrub, computed value at the midpoint.
{ const d = document.createElement('div'); document.body.appendChild(d);
  const a = d.animate([{ opacity: 0, filter: 'blur(12px)', transform: 'translateZ(0px)' }, { opacity: 1, filter: 'blur(0px)', transform: 'translateZ(100px)' }], { duration: 1000, fill: 'both', easing: 'linear' });
  a.pause(); a.currentTime = 500;
  const cs = getComputedStyle(d);
  r.waapi = { animate: typeof d.animate === 'function', opacityAtHalf: cs.opacity, filterAtHalf: cs.filter, transformAtHalf: cs.transform, playState: a.playState };
  const b = d.animate([{ offsetDistance: '0%' }, { offsetDistance: '100%' }], { duration: 1000, fill: 'both' }); b.pause(); b.currentTime = 500;
  r.waapi.offsetDistanceAtHalf = getComputedStyle(d).offsetDistance; d.remove(); }
r.supports = {
  colorMix: CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'),
  backgroundClipText: CSS.supports('background-clip', 'text'),
  webkitBackgroundClipText: CSS.supports('-webkit-background-clip', 'text'),
  filterBlur: CSS.supports('filter', 'blur(4px)'),
  backdropFilter: CSS.supports('backdrop-filter', 'blur(10px)'),
  offsetPath: CSS.supports('offset-path', "path('M 0 0 L 10 10')"),
  preserve3d: CSS.supports('transform-style', 'preserve-3d'),
  uiMonospace: CSS.supports('font-family', 'ui-monospace'),
};
{ const d = document.createElement('div'); d.style.color = 'color-mix(in srgb, #bf5af2 25%, transparent)'; document.body.appendChild(d); r.colorMixComputed = getComputedStyle(d).color; d.remove(); }
{ const g = document.querySelector('.grad'); if (g) { const cs = getComputedStyle(g); r.gradElement = { backgroundClip: cs.backgroundClip, webkitBackgroundClip: cs.webkitBackgroundClip, color: cs.color }; } }
// contenteditable="plaintext-only"
{ const p = document.createElement('p'); p.setAttribute('contenteditable', 'plaintext-only'); p.textContent = 'hello'; document.body.appendChild(p);
  p.focus(); const s = getSelection(); s.selectAllChildren(p);
  const boldOk = document.execCommand('bold'); document.execCommand('insertText', false, 'typed');
  r.plaintextOnly = { contentEditable: p.contentEditable, isContentEditable: p.isContentEditable, execBoldReturned: boldOk, innerHTMLAfter: p.innerHTML };
  // simulated rich paste: insertHTML must not create elements in plaintext-only
  s.selectAllChildren(p); document.execCommand('insertHTML', false, '<b>bold</b> <i>it</i>'); r.plaintextOnly.afterInsertHTML = p.innerHTML; p.remove(); }
// Fonts
await document.fonts.ready;
r.fonts = { manropeCheck: document.fonts.check('700 40px Manrope'), faces: [...document.fonts].map((f) => f.family + ' ' + f.weight + ' ' + f.status) };
{ const m = (fam) => { const s = document.createElement('span'); s.style.cssText = `position:absolute;white-space:nowrap;font:700 40px ${fam}`; s.textContent = 'Inside the phone 0123456789'; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
  r.fonts.widthManrope = m('Manrope'); r.fonts.widthFallback = m('sans-serif'); r.fonts.widthTextStack = m('var(--text)'); r.fonts.widthMonoStack = m('var(--mono)'); r.fonts.widthSystemUi = m('system-ui'); r.fonts.widthMenlo = m('Menlo'); }
r.broadcastChannel = typeof BroadcastChannel;
r.visibility = document.visibilityState;
r.devicePixelRatio = devicePixelRatio;
return JSON.stringify(r);
"""

@MainActor
func runProbe(_ a: [String]) async {
    let html = a[0], outJson = a[1]
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    let h = Host(width: 1920, height: 1080, offscreen: true, title: "probe")
    await h.load(fileURL(html, query: "t=12.5&capture"), readAccess: dir)
    await h.settle()
    let s = await h.js(probeJS) as? String ?? "{}"
    try! s.data(using: .utf8)!.write(to: URL(fileURLWithPath: outJson))
    log(s)
}

// MARK: - show: visible window + takeSnapshot, for comparing the snapshot path with what is on screen

@MainActor
func runShow(_ a: [String]) async {
    let html = a[0], outPng = a[1]
    let query = a.count > 2 ? a[2] : ""
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    let h = Host(width: 960, height: 540, offscreen: false, title: "show")
    h.window.setFrameTopLeftPoint(NSPoint(x: 100, y: (NSScreen.main?.frame.maxY ?? 1000) - 100))
    NSApp.activate(ignoringOtherApps: true)
    await h.load(fileURL(html, query: query), readAccess: dir)
    await h.settle()
    let img = await h.snapshot(width: 960)
    _ = savePNG(img, w: 960 * Int(h.window.backingScaleFactor), h: 540 * Int(h.window.backingScaleFactor), to: outPng)
    let f = h.window.frame, sh = NSScreen.screens[0].frame.height
    // window content rect in top-left screen coordinates, for `screencapture -R`
    let c = h.window.contentRect(forFrameRect: f)
    print("CONTENT \(Int(c.minX)),\(Int(sh - c.maxY)),\(Int(c.width)),\(Int(c.height))")
    fflush(stdout)
    try? await Task.sleep(nanoseconds: UInt64((Double(a.count > 3 ? a[3] : "4") ?? 4) * 1e9))
}

// MARK: - sck: compositor capture of the web view's window via ScreenCaptureKit (sees 3D, unlike takeSnapshot)

@MainActor
func captureWindowSCK(_ window: NSWindow, to path: String) async -> String {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let w = content.windows.first(where: { $0.windowID == CGWindowID(window.windowNumber) }) else { return "window not in SCShareableContent" }
        let filter = SCContentFilter(desktopIndependentWindow: w)
        let cfg = SCStreamConfiguration()
        let scale = window.backingScaleFactor
        cfg.width = Int(w.frame.width * scale); cfg.height = Int(w.frame.height * scale)
        cfg.showsCursor = false
        let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
        let rep = NSBitmapImageRep(cgImage: img)
        try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
        return "ok \(img.width)x\(img.height) onScreen=\(w.isOnScreen)"
    } catch { return "error: \(error)" }
}

@MainActor
func runSCK(_ a: [String]) async {
    let html = a[0], outPrefix = a[1], query = a.count > 2 ? a[2] : ""
    let dir = URL(fileURLWithPath: html).deletingLastPathComponent()
    for offscreen in [false, true] {
        let h = Host(width: 960, height: 540, offscreen: offscreen, title: "sck")
        await h.load(fileURL(html, query: query), readAccess: dir)
        await h.settle()
        try? await Task.sleep(nanoseconds: 300_000_000)
        let t0 = CACurrentMediaTime()
        let r = await captureWindowSCK(h.window, to: "\(outPrefix)-\(offscreen ? "offscreen" : "visible").png")
        log("SCK offscreen=\(offscreen): \(r) in \(Int((CACurrentMediaTime() - t0) * 1000)) ms")
        h.window.close()
    }
}

// MARK: - main

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else { log("usage: wkspike snap|scrub|relay|probe ..."); exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.regular)
Task { @MainActor in
    let rest = Array(args.dropFirst())
    switch cmd {
    case "snap": await runSnap(rest)
    case "scrub": await runScrub(rest)
    case "relay": await runRelay(rest)
    case "probe": await runProbe(rest)
    case "show": await runShow(rest)
    case "sck": await runSCK(rest)
    default: log("unknown command \(cmd)")
    }
    exit(0)
}
app.run()
