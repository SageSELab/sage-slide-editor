import AppKit
import SageTalkCore
import UniformTypeIdentifiers

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

    /// File ▸ Export ▸ PDF / PNGs: asks where to save (a .pdf, or a new folder of PNGs), then
    /// renders and copies the result there. Cancelling the panel exports nothing.
    func startExport(_ kind: PublishProtocol.ExportKind) {
        guard canPublish, !publishing.exporting else { return }
        let name = talk.map { TalkPackage.name(of: $0.root) } ?? "Talk"
        let suggested = kind == .pdf ? "\(name).pdf" : "\(name) PNGs"
        Task {
            guard let dest = await chooseSaveLocation(title: kind == .pdf ? "Export PDF of Holds" : "Export PNGs of Holds",
                                                      name: suggested, type: kind == .pdf ? .pdf : nil,
                                                      message: kind == .pdf ? nil : "The PNGs go into a new folder with this name.") else { return }
            showingExport = true
            await publishing.runExport(kind, saveTo: dest)
        }
    }

    /// File ▸ Export ▸ Web Page (HTML): asks where to save, builds the public page (private
    /// chapters, backups and notes cut, every asset inlined) and copies it there. The page also
    /// stays in build/public, where the Publish sheet stages it on a website.
    func exportWebPage() {
        guard canPublish, publishing.phase != .running else { return }
        let base = publishing.slug.isEmpty ? (talk.map { TalkPackage.name(of: $0.root) } ?? "talk") : publishing.slug
        Task {
            guard let dest = await chooseSaveLocation(title: "Export Web Page", name: "\(base).html", type: .html,
                                                      message: "One self-contained HTML file: private chapters, backups and speaker notes are removed.") else { return }
            let stem = PublishModel.slugify(dest.deletingPathExtension().lastPathComponent)
            if !stem.isEmpty { publishing.slug = stem }
            showingPublish = true
            await publishing.publish(saveTo: dest)
        }
    }

    /// The Publish sheet's Save a Copy…: the page already built, to a file the user chooses.
    func savePublishedCopy() {
        guard let r = publishing.result else { return }
        Task {
            guard let dest = await chooseSaveLocation(title: "Save a Copy of the Web Page", name: URL(fileURLWithPath: r.path).lastPathComponent, type: .html) else { return }
            publishing.saveCopy(to: dest)
        }
    }

    /// A Save panel, as a sheet on the talk window when there is one. The folder is remembered
    /// across exports (the Desktop at first). nil when cancelled.
    func chooseSaveLocation(title: String, name: String, type: UTType?, message: String? = nil) async -> URL? {
        let panel = NSSavePanel()
        panel.title = title
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        if let type { panel.allowedContentTypes = [type] }
        if let message { panel.message = message }
        let defaults = UserDefaults.standard, key = "export.directory"
        if let dir = defaults.string(forKey: key), FileManager.default.fileExists(atPath: dir) {
            panel.directoryURL = URL(fileURLWithPath: dir, isDirectory: true)
        } else {
            panel.directoryURL = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
        }
        let response: NSApplication.ModalResponse
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            response = await panel.beginSheetModal(for: window)
        } else {
            response = await withCheckedContinuation { c in panel.begin { c.resume(returning: $0) } }
        }
        guard response == .OK, let url = panel.url else { return nil }
        defaults.set(url.deletingLastPathComponent().path, forKey: key)
        return url
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
