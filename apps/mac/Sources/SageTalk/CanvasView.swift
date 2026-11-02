import SwiftUI
import WebKit

/// Hosts a FilmView's web view in SwiftUI (the canvas, and the presenter's mirror).
struct FilmViewRepresentable: NSViewRepresentable {
    let film: FilmView
    func makeNSView(context: Context) -> WKWebView { film.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
