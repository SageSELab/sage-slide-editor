import AppKit
import Observation
import SageTalkCore

@MainActor @Observable
final class TalkWindowModel {
    var talk: TalkFolder?
    var holds: [Hold] = []
    var selectedHold: Hold.ID?
    var error: String?
    let canvas = CanvasController()

    init() {
        canvas.onHolds = { [weak self] holds in self?.holds = holds }
        canvas.onPosition = { [weak self] index in
            guard let self, index > 0, self.selectedHold != index else { return }
            self.selectedHold = index
        }
        NotificationCenter.default.addObserver(forName: .sageOpenPath, object: nil, queue: .main) { [weak self] note in
            guard let path = note.object as? String else { return }
            MainActor.assumeIsolated {
                guard let self else { return }
                self.open(URL(fileURLWithPath: path))
                if let out = SelfTest.outDir { SelfTest.run(model: self, out: out) }
            }
        }
    }

    func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Open Talk"
        panel.message = "Choose a talk folder (talk.json, or a legacy index.html + talk.js)."
        if panel.runModal() == .OK, let url = panel.url { open(url) }
    }

    func open(_ url: URL) {
        do {
            let t = try TalkFolder(root: url)
            talk = t
            holds = []
            error = nil
            canvas.load(t)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func select(_ id: Hold.ID?) {
        selectedHold = id
        if let id, let h = holds.first(where: { $0.id == id }) { canvas.seek(h.at) }
    }
}
