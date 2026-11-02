import AppKit
import SageTalkCore
import SwiftUI

/// SAGE Talk ▸ Settings… (⌘,): where the two website repositories are. Stored in UserDefaults
/// (SiteSettings' keys); empty until the user chooses them, so nothing is staged by default.
struct SettingsView: View {
    @AppStorage(SiteSettings.personalKey) private var personal = ""
    @AppStorage(SiteSettings.labKey) private var lab = ""

    var body: some View {
        Form {
            Section {
                repoRow("Personal site", $personal, id: "settings.personal")
                repoRow("Lab site", $lab, id: "settings.lab")
            } header: {
                Text("Website repositories")
            } footer: {
                Text("Each is the top folder of a site's git working tree (it has public/talks/ and src/content/). File ▸ Publish… stages talks there and commits only when you click Commit. SAGE Talk never pushes.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
        .frame(width: 560)
        .padding(.vertical, 8)
    }

    private func repoRow(_ title: String, _ path: Binding<String>, id: String) -> some View {
        HStack {
            TextField(title, text: path, prompt: Text("Not set"))
                .font(.body.monospaced())
                .accessibilityIdentifier(id)
            Button("Choose…") {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.prompt = "Choose"
                panel.message = "Choose the \(title.lowercased())'s repository folder."
                if !path.wrappedValue.isEmpty { panel.directoryURL = URL(fileURLWithPath: path.wrappedValue) }
                if panel.runModal() == .OK, let url = panel.url { path.wrappedValue = url.path }
            }
            if !path.wrappedValue.isEmpty {
                Button { path.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).help("Clear")
            }
        }
    }
}
