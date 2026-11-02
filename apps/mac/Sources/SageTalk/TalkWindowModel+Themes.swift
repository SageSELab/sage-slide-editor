import AppKit
import CoreText
import SageTalkCore
import SwiftUI

// Themes (Format ▸ Themes…): one library for the app, applied to the open talk through its
// sidecar, undoable from the talk window's Edit menu.
extension TalkWindowModel {
    /// The open talk's sidecar, when it can take theme and font calls.
    var themeService: (any ThemeService)? { canEdit ? supervisor?.client : nil }

    /// A .talktheme from Finder: into the library, then the Themes window shows it.
    func importTheme(_ url: URL) {
        if AppThemes.model.importPackage(url) != nil { NotificationCenter.default.post(name: .sageShowThemes, object: nil) }
        else { error = AppThemes.model.error }
    }
}

@MainActor
enum AppThemes {
    static let model = ThemesModel(library: .standard(), service: { TalkWindowModel.shared.themeService }, edits: TalkWindowModel.shared.edits)

    /// Registers a package's fonts for this process so cards can show them (best effort).
    private static var registered = Set<String>()
    static func registerFonts(_ entry: ThemeLibrary.Entry) {
        let dir = entry.url.appendingPathComponent("fonts")
        guard !registered.contains(dir.path),
              let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        registered.insert(dir.path)
        let fonts = files.filter { $0.pathExtension == "woff2" } as CFArray
        CTFontManagerRegisterFontURLs(fonts, .process, false, nil)
    }
}

extension Notification.Name {
    static let sageShowThemes = Notification.Name("sageShowThemes")
}

/// Opens the Themes window (Format menu, toolbar).
struct ShowThemesButton: View {
    @Environment(\.openWindow) private var openWindow
    var toolbar = false
    var body: some View {
        Button { openWindow(id: "themes") } label: {
            if toolbar { Label("Themes", systemImage: "paintpalette") } else { Text("Themes…") }
        }
        .help("Colors and fonts for the whole talk")
    }
}

/// Opens the Themes window when asked to (a .talktheme opened from Finder).
struct ThemesWindowOpener: ViewModifier {
    @Environment(\.openWindow) private var openWindow
    func body(content: Content) -> some View {
        content.onReceive(NotificationCenter.default.publisher(for: .sageShowThemes)) { _ in openWindow(id: "themes") }
    }
}
