import SageTalkCore
import SwiftUI
import WebKit

/// Owns the WKWebView that runs the real film. All rendering goes through the engine's
/// deterministic render(t); the app only seeks, plays, and reads state back.
@MainActor
final class CanvasController: NSObject, WKScriptMessageHandler {
    let webView: WKWebView
    var onHolds: ([Hold]) -> Void = { _ in }
    var onPosition: (Int) -> Void = { _ in }

    override init() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        let ucc = WKUserContentController()
        config.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        ucc.add(self, name: "sage")
        // Report holds once the engine has booted, and the current hold after every render.
        ucc.addUserScript(WKUserScript(source: Self.bridgeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    func load(_ talk: TalkFolder) {
        webView.loadFileURL(talk.filmURL, allowingReadAccessTo: talk.root)
    }

    func seek(_ t: Double) { eval("window.T && T.seek(\(t))") }
    func next() { eval("window.T && T.next()") }
    func prev() { eval("window.T && T.prev()") }
    func through() { eval("window.T && T.through()") }

    private func eval(_ js: String) { webView.evaluateJavaScript(js, completionHandler: nil) }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        do {
            guard let dict = message.body as? [String: Any], let kind = dict["kind"] as? String else { return }
            switch kind {
            case "holds":
                let raw = dict["holds"] as? [[String: Any]] ?? []
                onHolds(raw.enumerated().map { i, h in
                    Hold(index: i + 1, at: h["at"] as? Double ?? 0, label: h["label"] as? String ?? "", backup: h["backup"] as? Bool ?? false)
                })
            case "position":
                onPosition(dict["index"] as? Int ?? 0)
            default: break
            }
        }
    }

    private static let bridgeJS = """
    (function () {
      const post = (m) => window.webkit?.messageHandlers?.sage?.postMessage(m);
      let tries = 0;
      const wait = setInterval(() => {
        const T = window.T;
        if (!T && ++tries < 100) return;
        clearInterval(wait);
        if (!T) return;
        post({ kind: 'holds', holds: T.cps.map((c) => ({ at: c.at, label: c.label, backup: !!c.backup })) });
        const prev = T.onRender;
        let last = -2;
        T.onRender = (t) => { prev?.(t); const i = T.cpIndex(t); if (i !== last) { last = i; post({ kind: 'position', index: i + 1 }); } };
      }, 50);
    })();
    """
}

struct CanvasView: NSViewRepresentable {
    let controller: CanvasController
    func makeNSView(context: Context) -> WKWebView { controller.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
