import Foundation
import Observation

/// Google fonts for the open talk, for any control that sets a font (the theme editor's font
/// roles, and a per-element font control in the canvas format bar):
///
///     let fonts = FontEmbedder(service: client, edits: model.edits)
///     let hits = try await fonts.search("lora")
///     let r = try await fonts.embed(hits[0].id, weights: [400, 700])
///     // r.fontFamily == "Lora, Georgia, \"Times New Roman\", serif": set it as the element's font-family
///
/// `embed` downloads the woff2 files into the talk's assets/fonts, adds their @font-face rules
/// to theme.css (fonts.add) and rebuilds; it is undoable ("Undo Add Font"). Fonts already
/// embedded are listed by `embedded()`.
@MainActor
public struct FontEmbedder {
    public let service: any ThemeService
    public let edits: EditSession?

    public init(service: any ThemeService, edits: EditSession? = nil) { self.service = service; self.edits = edits }

    /// Families matching `query` (empty: a suggested list), best first.
    public func search(_ query: String, category: String? = nil, limit: Int = 60) async throws -> [ThemeProtocol.FontInfo] {
        try await service.searchFonts(.init(query: query, category: category, limit: limit)).fonts
    }

    /// Embeds a family into the open talk; `fontFamily` in the result is the CSS value to use.
    @discardableResult
    public func embed(_ id: String, family: String? = nil, weights: [Int]? = nil, styles: [String]? = nil) async throws -> ThemeProtocol.FontsAddResult {
        let p = ThemeProtocol.FontsAddParams(id: id, weights: weights, styles: styles)
        let service = self.service
        guard let edits else { return try await service.addFont(p) }
        return try await edits.performOther("Add Font \(family.map { "“\($0)”" } ?? id)", { try await service.addFont(p) }, edit: \.edit)
    }

    /// The fonts embedded in the open talk.
    public func embedded() async throws -> [ThemeProtocol.EmbeddedFont] { try await service.listFonts().fonts }

    /// The weights a role should embed, of those the family has: display the heading weight (and
    /// one below), body 400 to 700, mono 400 and 600.
    nonisolated public static func weights(for role: ThemeEditorDraft.Role, of font: ThemeProtocol.FontInfo, headingWeight: Int = 700) -> [Int] {
        let wanted: [Int]
        switch role {
        case .display: wanted = [headingWeight - 100, headingWeight]
        case .body: wanted = [400, 500, 600, 700]
        case .mono: wanted = [400, 600]
        }
        let have = wanted.filter(font.weights.contains)
        if !have.isEmpty { return have }
        // Nearest available to the main weight.
        let main = role == .display ? headingWeight : 400
        return font.weights.min(by: { abs($0 - main) < abs($1 - main) }).map { [$0] } ?? [400]
    }

    /// A CSS fallback list for a catalog category (as the sidecar's fonts.add uses).
    nonisolated public static func fallback(for category: String) -> String {
        switch category {
        case "serif": "Georgia, \"Times New Roman\", serif"
        case "monospace": "Menlo, ui-monospace, monospace"
        case "handwriting": "cursive"
        default: "system-ui, -apple-system, sans-serif"
        }
    }
}

/// The search behind a font picker: type to search the catalog (debounced), pick a family.
@MainActor @Observable
public final class FontPickerModel {
    public var query = "" { didSet { if query != oldValue { scheduleSearch() } } }
    public var category: String? { didSet { if category != oldValue { scheduleSearch(delay: .zero) } } }
    public private(set) var results: [ThemeProtocol.FontInfo] = []
    public private(set) var searching = false
    public private(set) var error: String?

    @ObservationIgnored public var service: () -> (any ThemeService)?
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored public var debounce: Duration = .milliseconds(200)

    public static let categories = ["sans-serif", "serif", "display", "handwriting", "monospace"]

    public init(service: @escaping () -> (any ThemeService)?) { self.service = service }

    /// Runs the search now (the first load, the suggested list).
    public func start() { scheduleSearch(delay: .zero) }

    private func scheduleSearch(delay: Duration? = nil) {
        task?.cancel()
        let q = query, cat = category, wait = delay ?? debounce
        task = Task { [weak self] in
            if wait > .zero { try? await Task.sleep(for: wait) }
            guard !Task.isCancelled, let self else { return }
            await self.run(q, cat)
        }
    }

    /// Searches and publishes the results (awaitable from tests).
    public func run(_ q: String, _ cat: String?) async {
        guard let s = service() else { error = "Open a talk to search Google Fonts."; results = []; return }
        searching = true
        defer { searching = false }
        do {
            let r = try await s.searchFonts(.init(query: q, category: cat, limit: 60))
            guard q == query, cat == category else { return } // a newer search is under way
            results = r.fonts
            error = r.catalog == .stale ? "Offline: showing the cached catalog." : nil
        } catch {
            self.error = EditSession.describe(error)
        }
    }
}
