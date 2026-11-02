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

/// Opens the Themes window when asked to (a .talktheme opened from Finder), and provides the
/// format bar's Font button: a Google Fonts picker whose choice is embedded into the talk
/// (fonts.add, undoable) and then set on the selected object (applyFont).
struct ThemesWindowOpener: ViewModifier {
    @Environment(\.openWindow) private var openWindow
    @State private var pick = AppThemes.fontPick
    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .sageShowThemes)) { _ in openWindow(id: "themes") }
            .onAppear { TalkWindowModel.shared.installFontPicker() }
            .sheet(isPresented: Binding(get: { pick.target != nil }, set: { if !$0 { pick.target = nil } })) {
                ElementFontSheet(pick: pick, model: TalkWindowModel.shared)
            }
    }
}

/// Who the font picker is open for.
@MainActor @Observable
final class ElementFontPick {
    var target: CanvasObject?
    var busy = false
    var error: String?
}

extension AppThemes {
    static let fontPick = ElementFontPick()
}

extension TalkWindowModel {
    /// Sets the Font button's hook (TalkWindowModel+Editing.swift: onPickFont).
    func installFontPicker() {
        onPickFont = { obj in
            AppThemes.fontPick.error = nil
            AppThemes.fontPick.target = obj
        }
    }

    /// Embeds a Google font into the talk (undoable), then sets it on the selected object.
    /// Returns an error message, or nil.
    func embedAndApplyFont(_ info: ThemeProtocol.FontInfo) async -> String? {
        guard let s = themeService else { return "Open a talk to add fonts." }
        do {
            let r = try await FontEmbedder(service: s, edits: edits).embed(info.id, family: info.family, weights: FontEmbedder.weights(for: .body, of: info))
            applyFont(r.fontFamily)
            return nil
        } catch {
            return EditSession.describe(error)
        }
    }
}

struct ElementFontSheet: View {
    @Bindable var pick: ElementFontPick
    var model: TalkWindowModel
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Font for #\(pick.target?.id ?? "")").font(.headline).padding([.top, .horizontal], 12)
            FontPicker(service: { model.themeService }, selectedID: nil) { info in
                pick.busy = true
                Task {
                    let err = await model.embedAndApplyFont(info)
                    pick.busy = false
                    if let err { pick.error = err } else { pick.target = nil }
                }
            }
            HStack {
                if pick.busy { ProgressView().controlSize(.small); Text("Embedding…").font(.caption) }
                if let e = pick.error { Text(e).font(.caption).foregroundStyle(.red).lineLimit(2) }
                Spacer()
                Button("Cancel", role: .cancel) { pick.target = nil }.keyboardShortcut(.cancelAction)
            }
            .padding(12)
        }
    }
}
