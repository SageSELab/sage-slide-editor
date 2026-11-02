import AppKit
import SageTalkCore
import SwiftUI
import WebKit

/// The canvas: the film's web view, with the format bar floating over the selected text
/// object. The bar is its own hosting view above the web view (not a SwiftUI overlay), so it
/// sits exactly over the object in the web view's coordinates and the self-test can draw it
/// over the film's snapshot.
struct CanvasHost: NSViewRepresentable {
    let model: TalkWindowModel
    /// The object's box in the web view (points, top-left origin); nil hides the bar.
    let anchor: CGRect?

    func makeNSView(context: Context) -> CanvasContainerView {
        CanvasContainerView(webView: model.canvas.webView, bar: NSHostingView(rootView: FormatBar(model: model)))
    }

    func updateNSView(_ view: CanvasContainerView, context: Context) {
        view.anchor = anchor
    }
}

final class CanvasContainerView: NSView {
    let webView: WKWebView
    let bar: NSView
    /// Where the bar attaches (the selected object's box); nil hides it.
    var anchor: CGRect? { didSet { needsLayout = true } }

    init(webView: WKWebView, bar: NSView) {
        self.webView = webView
        self.bar = bar
        super.init(frame: .zero)
        webView.removeFromSuperview()
        addSubview(webView)
        addSubview(bar)
        bar.isHidden = true
        (bar as? NSHostingView<FormatBar>)?.sizingOptions = [.intrinsicContentSize]
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        webView.frame = bounds
        guard let a = anchor else { bar.isHidden = true; return }
        let size = bar.fittingSize
        guard size.width > 1, size.height > 1 else { bar.isHidden = true; return }
        bar.frame = Self.place(size, over: a, in: bounds)
        bar.isHidden = false
    }

    /// Above the object, centred on it, kept inside the canvas; below it when there is no room
    /// above, and over its top edge when there is none below either. `size` includes the
    /// bar's 10 pt shadow margin.
    static func place(_ size: CGSize, over a: CGRect, in bounds: CGRect) -> CGRect {
        let margin: CGFloat = 10, gap: CGFloat = 2 // the shadow margin already spaces it from the object
        var x = a.midX - size.width / 2
        x = min(max(x, bounds.minX - margin + 6), bounds.maxX - size.width + margin - 6)
        var y = a.minY - size.height - gap
        if y < bounds.minY - margin + 4 { y = a.maxY + gap }
        if y + size.height > bounds.maxY + margin - 4 { y = max(bounds.minY - margin + 4, a.minY + 6) }
        return CGRect(origin: CGPoint(x: x.rounded(), y: y.rounded()), size: size)
    }
}

extension TalkWindowModel {
    /// Where the format bar floats: over the selected text object, while the canvas is editable.
    var formatBarAnchor: CGRect? {
        guard canvasEditable, let o = formatTarget, let r = o.rect, r.w > 0, r.h > 0 else { return nil }
        return CGRect(x: r.x, y: r.y, width: r.w, height: r.h)
    }
}
