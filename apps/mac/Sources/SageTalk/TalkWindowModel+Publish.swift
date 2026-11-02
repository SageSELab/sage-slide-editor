import AppKit
import SageTalkCore

// Publish and export (PLAN 5.6) on the window model: File ▸ Publish…, File ▸ Export ▸ PNGs / PDF,
// talk.exportProgress into the model, Reveal in Finder and Open in Browser for the results.
extension TalkWindowModel {
    /// Publishing needs a sage-talk/1 talk open through the sidecar.
    var canPublish: Bool { talk?.kind == .beatFormat && publishing.service != nil }

    /// A talk was opened: the sheet starts over with the folder's name as the slug.
    func resetPublishing(_ folder: TalkFolder) {
        publishing.service = nil
        publishing.reset(talkFolder: folder.root, title: Self.talkTitle(folder.root))
        showingPublish = false
        showingExport = false
    }

    func showPublish() { if canPublish { showingPublish = true } }

    func startExport(_ kind: PublishProtocol.ExportKind) {
        guard canPublish, !publishing.exporting else { return }
        showingExport = true
        Task { await publishing.runExport(kind) }
    }

    /// Routes talk.exportProgress to the model; false for other methods.
    func handlePublishNotification(_ method: String, _ params: JSONValue?) -> Bool {
        guard method == PublishProtocol.Notification.exportProgress else { return false }
        if let p: PublishProtocol.ExportProgress = try? params?.decode() { publishing.apply(p) }
        return true
    }

    func reveal(_ path: String) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }

    /// Opens the public file in the default browser (it is self-contained; file:// is fine).
    func openInBrowser(_ path: String) {
        let url = URL(fileURLWithPath: path)
        if let browser = NSWorkspace.shared.urlForApplication(toOpen: URL(string: "https://example.org")!) {
            NSWorkspace.shared.open([url], withApplicationAt: browser, configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.open(url)
        }
    }

    static func talkTitle(_ root: URL) -> String {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("talk.json")),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return obj["title"] as? String ?? ""
    }
}
