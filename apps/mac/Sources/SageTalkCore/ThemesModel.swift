import Foundation
import Observation

/// A theme being edited: the theme plus accessors the editor binds to (a color per palette
/// role, light and dark; a font per role).
public struct ThemeEditorDraft: Equatable, Sendable {
    public var theme: ThemeProtocol.Theme

    public enum Side: String, CaseIterable, Sendable { case light, dark }
    public enum ColorRole: String, CaseIterable, Sendable, Identifiable {
        case bg, ink, ink2, ink3, line, panel, accent1, accent2, accent3
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .bg: "Background"
            case .ink: "Text"
            case .ink2: "Secondary text"
            case .ink3: "Captions"
            case .line: "Lines"
            case .panel: "Panels"
            case .accent1: "Accent"
            case .accent2: "Accent 2"
            case .accent3: "Accent 3"
            }
        }
    }
    public enum Role: String, CaseIterable, Sendable, Identifiable {
        case display, body, mono
        public var id: String { rawValue }
        public var title: String {
            switch self {
            case .display: "Headings"
            case .body: "Text"
            case .mono: "Code"
            }
        }
    }

    public init(_ theme: ThemeProtocol.Theme) { self.theme = theme }

    private static func path(_ r: ColorRole) -> WritableKeyPath<ThemeProtocol.Palette, String>? {
        switch r {
        case .bg: \.bg
        case .ink: \.ink
        case .ink2: \.ink2
        case .ink3: \.ink3
        case .line: \.line
        case .panel: \.panel
        default: nil
        }
    }
    private static func accent(_ r: ColorRole) -> WritableKeyPath<ThemeProtocol.Palette, String?> {
        switch r {
        case .accent2: \.accent2
        case .accent3: \.accent3
        default: \.accent1
        }
    }

    /// The CSS color of a role; a dark accent that is not set reads as the light one.
    public func color(_ role: ColorRole, _ side: Side) -> String {
        let p = side == .light ? theme.light : theme.dark
        if let k = Self.path(role) { return p[keyPath: k] }
        let k = Self.accent(role)
        return p[keyPath: k] ?? theme.light[keyPath: k] ?? "#000000"
    }

    /// Sets a role's color. A dark accent equal to the light one is left unset (it inherits).
    public mutating func setColor(_ role: ColorRole, _ side: Side, _ css: String) {
        if let k = Self.path(role) {
            if side == .light { theme.light[keyPath: k] = css } else { theme.dark[keyPath: k] = css }
            return
        }
        let k = Self.accent(role)
        if side == .light { theme.light[keyPath: k] = css }
        else { theme.dark[keyPath: k] = css == theme.light[keyPath: k] ? nil : css }
    }

    public func font(_ role: Role) -> ThemeProtocol.FontRole {
        switch role { case .display: theme.fonts.display; case .body: theme.fonts.body; case .mono: theme.fonts.mono }
    }

    public mutating func setFont(_ role: Role, _ f: ThemeProtocol.FontRole) {
        switch role { case .display: theme.fonts.display = f; case .body: theme.fonts.body = f; case .mono: theme.fonts.mono = f }
    }

    /// Uses a Google font for a role, embedding the weights the role needs.
    public mutating func setGoogleFont(_ role: Role, _ font: ThemeProtocol.FontInfo) {
        let heading = theme.type?.headingWeight ?? 700
        setFont(role, .init(family: font.family, fallback: FontEmbedder.fallback(for: font.category), source: .google, id: font.id,
                            weights: FontEmbedder.weights(for: role, of: font, headingWeight: heading)))
    }

    public var type: ThemeProtocol.TypeScale {
        get { theme.type ?? .standard }
        set { theme.type = newValue }
    }

    /// Text against the background below WCAG AA (4.5:1), as warnings for the editor.
    public var contrastWarnings: [String] {
        var out: [String] = []
        for side in Side.allCases {
            guard let bg = CSSColor(css: color(.bg, side)) else { continue }
            for role in [ColorRole.ink, .ink2, .ink3] {
                guard let fg = CSSColor(css: color(role, side)) else { continue }
                let c = CSSColor.contrast(fg, bg)
                if c < 4.5 { out.append("\(side == .light ? "Slides" : "Dark passage"): \(role.title.lowercased()) is \(String(format: "%.1f", c)):1 against the background (4.5:1 or more reads well).") }
            }
        }
        return out
    }
}

/// The Themes window's model: the library, applying a theme to the open talk (undoable), saving
/// the talk's current look, import, duplicate, delete, and saving edits through the sidecar
/// (theme.save regenerates theme.css and downloads fonts).
@MainActor @Observable
public final class ThemesModel {
    public private(set) var entries: [ThemeLibrary.Entry] = []
    public var selectedID: String?
    public private(set) var busy = false
    public var status: String?
    public var error: String?
    /// The theme applied last in this session (the cards mark it).
    public private(set) var appliedID: String?

    @ObservationIgnored public var library: ThemeLibrary
    /// The open talk's sidecar (nil: no beat-format talk open).
    @ObservationIgnored public var service: () -> (any ThemeService)?
    /// The window's undo stack, so applying a theme is undoable.
    @ObservationIgnored public var edits: EditSession?

    public init(library: ThemeLibrary, service: @escaping () -> (any ThemeService)? = { nil }, edits: EditSession? = nil) {
        self.library = library; self.service = service; self.edits = edits
        reload()
    }

    public var selected: ThemeLibrary.Entry? { entries.first { $0.id == selectedID } }
    public var canUseTalk: Bool { service() != nil }

    public func reload() {
        entries = library.entries()
        if selectedID == nil || !entries.contains(where: { $0.id == selectedID }) { selectedID = entries.first?.id }
    }

    private func run<T>(_ what: String, _ body: () async throws -> T) async -> T? {
        busy = true
        defer { busy = false }
        do {
            let r = try await body()
            error = nil
            return r
        } catch {
            self.error = "\(what): \(EditSession.describe(error))"
            return nil
        }
    }

    private func requireService() throws -> any ThemeService {
        guard let s = service() else { throw ThemesError.noTalk }
        return s
    }

    public enum ThemesError: LocalizedError {
        case noTalk
        public var errorDescription: String? { "Open a talk first (themes are applied and saved by the talk's helper process)." }
    }

    // MARK: Applying

    /// Restyles the open talk with a library theme; Edit ▸ Undo puts the old look back.
    @discardableResult
    public func apply(_ entry: ThemeLibrary.Entry) async -> ThemeProtocol.ApplyResult? {
        let r = await run("Applying “\(entry.theme.name)”") { () async throws -> ThemeProtocol.ApplyResult in
            let s = try requireService()
            let p = ThemeProtocol.ApplyParams(path: entry.url.path)
            if let edits { return try await edits.performOther("Apply Theme “\(entry.theme.name)”", { try await s.applyTheme(p) }, edit: \.edit) }
            return try await s.applyTheme(p)
        }
        if let r {
            appliedID = entry.id
            status = r.edit.changed.isEmpty ? "The talk already uses “\(entry.theme.name)”." : "Applied “\(entry.theme.name)”" + (r.edit.ok ? "." : ", but the rebuild failed.")
        }
        return r
    }

    // MARK: Library

    /// Saves the open talk's current look as a new user theme named `name`.
    @discardableResult
    public func saveCurrentTalk(named name: String) async -> ThemeLibrary.Entry? {
        let id = library.uniqueID(name)
        let url = library.userURL(for: id)
        let r = await run("Saving the talk's theme") { () async throws -> ThemeProtocol.ExtractResult in
            try FileManager.default.createDirectory(at: library.userDirectory, withIntermediateDirectories: true)
            return try await requireService().extractTheme(.init(path: url.path, id: id, name: name))
        }
        guard r != nil else { return nil }
        reload()
        selectedID = id
        status = "Saved “\(name)” to the library."
        return selected
    }

    @discardableResult
    public func importPackage(_ url: URL) -> ThemeLibrary.Entry? {
        do {
            let e = try library.importPackage(url)
            reload()
            selectedID = e.id
            status = "Imported “\(e.theme.name)”."
            error = nil
            return e
        } catch {
            self.error = "Importing \(url.lastPathComponent): \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    public func duplicate(_ entry: ThemeLibrary.Entry) -> ThemeLibrary.Entry? {
        do {
            let e = try library.duplicate(entry)
            reload()
            selectedID = e.id
            error = nil
            return e
        } catch {
            self.error = "Duplicating: \(error.localizedDescription)"
            return nil
        }
    }

    public func delete(_ entry: ThemeLibrary.Entry) {
        do {
            try library.delete(entry)
            if selectedID == entry.id { selectedID = nil }
            reload()
            status = "Moved “\(entry.theme.name)” to the Trash."
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Copies a theme package to `destination` (File ▸ Export).
    public func export(_ entry: ThemeLibrary.Entry, to destination: URL) {
        do {
            let fm = FileManager.default
            if fm.fileExists(atPath: destination.path) { try fm.removeItem(at: destination) }
            try fm.copyItem(at: entry.url, to: destination)
            status = "Exported “\(entry.theme.name)”."
        } catch {
            self.error = "Exporting: \(error.localizedDescription)"
        }
    }

    /// Saves an edited user theme: theme.json, a regenerated theme.css and its fonts (downloaded
    /// as needed). The id stays; a new name is just a new name.
    @discardableResult
    public func save(_ draft: ThemeEditorDraft, over entry: ThemeLibrary.Entry) async -> ThemeLibrary.Entry? {
        guard !entry.builtin else { error = ThemeLibrary.LibraryError.builtin(entry.theme.name).localizedDescription; return nil }
        var theme = draft.theme
        theme.id = entry.id
        let r = await run("Saving “\(theme.name)”") { () async throws -> ThemeProtocol.SaveResult in
            try await requireService().saveTheme(.init(path: entry.url.path, theme: theme))
        }
        guard r != nil else { return nil }
        reload()
        selectedID = entry.id
        status = "Saved “\(theme.name)”."
        return selected
    }
}
