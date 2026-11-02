import Foundation
import SageTalkCore
import WebKit

/// The editing overlay script (packages/engine/src/canvas.js). It is injected into the canvas
/// film of an editable talk (it steps aside on its own while the film plays), never into the
/// audience, presenter or thumbnail films.
enum CanvasScript {
    static let relativePath = "packages/engine/src/canvas.js"

    /// Read from the repository the app runs its sidecar from (fresh each time, so a change to
    /// canvas.js needs no app rebuild), else from the app's resources. A packaged app running
    /// its bundled sidecar uses its own copy (Resources/canvas.js, from package.sh).
    static func source() -> String? {
        let env = ProcessInfo.processInfo.environment
        if !SidecarLocator.usesBundle(environment: env),
           let repo = SidecarLocator.repoRoot(environment: env, resources: Bundle.main.resourceURL, executable: Bundle.main.executableURL),
           let s = try? String(contentsOf: repo.appendingPathComponent(relativePath), encoding: .utf8) { return s }
        if let url = Bundle.main.url(forResource: "canvas", withExtension: "js") { return try? String(contentsOf: url, encoding: .utf8) }
        return nil
    }
}

extension FilmView {
    /// Injects canvas.js (once per page load) and enables it; restores `select` without
    /// reporting it, and returns that object's current state.
    func enableEditing(select id: String?) async -> CanvasObject? {
        guard let js = CanvasScript.source() else { return nil }
        let body = """
        if (!window.SageCanvas) { (0, eval)(src); }
        if (!window.SageCanvas) return null;
        SageCanvas.enable();
        const m = id ? SageCanvas.select(id, { silent: true }) : null;
        return m && m.id ? JSON.stringify(m) : null;
        """
        guard let json = try? await call(body, ["src": js, "id": id ?? NSNull()]) as? String,
              let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              case .select(let o) = CanvasMessage.parse(obj) else { return nil }
        return o
    }

    func disableEditing() {
        webView.evaluateJavaScript("window.SageCanvas && SageCanvas.disable(), 0", completionHandler: nil)
    }

    /// Selects an object on the canvas (reported back as a `select` message unless silent).
    func canvasSelect(_ id: String?, silent: Bool = false) async -> CanvasObject? {
        let body = "if (!window.SageCanvas) return null; const m = SageCanvas.select(id, { silent }); return m && m.id ? JSON.stringify(m) : null;"
        guard let json = try? await call(body, ["id": id ?? NSNull(), "silent": silent]) as? String,
              let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              case .select(let o) = CanvasMessage.parse(obj) else { return nil }
        return o
    }

    /// The edit gave the element at `key` (an address) the id `id`: the page's element takes it.
    func canvasAdopt(_ key: String, _ id: String) async {
        _ = try? await call("return !!(window.SageCanvas && SageCanvas.adopt(key, id));", ["key": key, "id": id])
    }

    /// Offers a key the app's menus caught to the overlay; false when it did not handle it.
    func canvasKey(_ name: String, shift: Bool = false) async -> Bool {
        let r = try? await call("return !!(window.SageCanvas && SageCanvas.on && SageCanvas.key(name, { shift }));", ["name": name, "shift": shift])
        return (r as? Bool) ?? false
    }

    /// A format-bar command on the selected object: "inline" (applied to the selected text
    /// range, saved when the text is committed), "element" (posted as a `style` message for
    /// setStyle), or nil (nothing selected, or the film is playing).
    @discardableResult
    func canvasFormat(_ f: CanvasFormat) async -> String? {
        let r = try? await call("return window.SageCanvas && SageCanvas.on ? SageCanvas.format(cmd, value) : null;",
                                ["cmd": f.command, "value": f.value.map { $0 as Any } ?? NSNull()])
        return r as? String
    }

    /// Ends in-place text editing and returns its change (not posted), so the app can save it
    /// before an edit of its own; nil when nothing was being edited or nothing changed.
    func takeCanvasText() async -> CanvasMessage? {
        let body = "if (!window.SageCanvas || !SageCanvas.on) return null; const m = SageCanvas.takeText(); return m ? JSON.stringify(m) : null;"
        guard let json = try? await call(body) as? String,
              let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { return nil }
        return CanvasMessage.parse(obj)
    }
}
