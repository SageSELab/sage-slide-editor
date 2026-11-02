import Foundation

// Themes and fonts in the sidecar protocol (packages/sidecar/src/protocol.ts, docs/rpc.md "Themes
// and fonts"). A theme is a sage-theme/1 theme.json (@sage/core's ThemeSchema); a .talktheme is a
// folder with theme.json, a generated theme.css and fonts/*.woff2. Fixtures: tests/rpc/themes/,
// decoded by ThemeProtocolTests.

public enum ThemeProtocol {
    public enum Method {
        public static let validate = "theme.validate"
        public static let save = "theme.save"
        public static let apply = "theme.apply"
        public static let extract = "theme.extract"
        public static let searchFonts = "fonts.search"
        public static let addFont = "fonts.add"
        public static let listFonts = "fonts.list"
        public static let all = [validate, save, apply, extract, searchFonts, addFont, listFonts]
    }

    public enum ErrorCode {
        /// The theme does not validate; data.problems.
        public static let themeInvalid = -32030
        /// A font could not be found, embedded or downloaded; data.code.
        public static let fontFailed = -32031
        public static let all = [themeInvalid, fontFailed]
    }

    public static let format = "sage-theme/1"
    public static let fileExtension = "talktheme"

    // MARK: theme.json

    /// The slides' colors (light) or the dark passage's. CSS color strings.
    public struct Palette: Codable, Equatable, Hashable, Sendable {
        public var bg: String
        public var ink: String
        public var ink2: String
        public var ink3: String
        public var line: String
        public var panel: String
        /// Required for light; optional for dark (missing: the light accent).
        public var accent1: String?
        public var accent2: String?
        public var accent3: String?
        /// Other custom properties, named without the leading "--".
        public var tokens: [String: String]?
        public init(bg: String, ink: String, ink2: String, ink3: String, line: String, panel: String,
                    accent1: String? = nil, accent2: String? = nil, accent3: String? = nil, tokens: [String: String]? = nil) {
            self.bg = bg; self.ink = ink; self.ink2 = ink2; self.ink3 = ink3; self.line = line; self.panel = panel
            self.accent1 = accent1; self.accent2 = accent2; self.accent3 = accent3; self.tokens = tokens
        }
    }

    public enum FontSource: String, Codable, Sendable, CaseIterable { case google, system, engine }

    public struct FontRole: Codable, Equatable, Hashable, Sendable {
        public var family: String
        /// The rest of the CSS font-family list.
        public var fallback: String
        public var source: FontSource
        /// Fontsource id (google).
        public var id: String?
        public var weights: [Int]?
        public var styles: [String]?
        public var subset: String?
        public init(family: String, fallback: String, source: FontSource, id: String? = nil, weights: [Int]? = nil, styles: [String]? = nil, subset: String? = nil) {
            self.family = family; self.fallback = fallback; self.source = source; self.id = id; self.weights = weights; self.styles = styles; self.subset = subset
        }
    }

    public struct Fonts: Codable, Equatable, Hashable, Sendable {
        public var display: FontRole
        public var body: FontRole
        public var mono: FontRole
        public init(display: FontRole, body: FontRole, mono: FontRole) { self.display = display; self.body = body; self.mono = mono }
    }

    public struct TypeScale: Codable, Equatable, Hashable, Sendable {
        public var xl: Double, l: Double, m: Double, s: Double
        public var sub: Double, cap: Double, eyebrow: Double
        public var headingWeight: Int
        public var headingTracking: Double
        /// talk.css's values.
        public static let standard = TypeScale(xl: 124, l: 92, m: 62, s: 40, sub: 34, cap: 26, eyebrow: 28, headingWeight: 700, headingTracking: 1)
        public init(xl: Double, l: Double, m: Double, s: Double, sub: Double, cap: Double, eyebrow: Double, headingWeight: Int, headingTracking: Double) {
            self.xl = xl; self.l = l; self.m = m; self.s = s; self.sub = sub; self.cap = cap; self.eyebrow = eyebrow
            self.headingWeight = headingWeight; self.headingTracking = headingTracking
        }
    }

    public struct Theme: Codable, Equatable, Hashable, Sendable, Identifiable {
        public var format: String
        public var id: String
        public var name: String
        public var description: String?
        public var author: String?
        public var light: Palette
        public var dark: Palette
        public var fonts: Fonts
        public var type: TypeScale?
        public var css: String?
        public init(id: String, name: String, description: String? = nil, author: String? = nil, light: Palette, dark: Palette,
                    fonts: Fonts, type: TypeScale? = nil, css: String? = nil) {
            self.format = ThemeProtocol.format; self.id = id; self.name = name; self.description = description; self.author = author
            self.light = light; self.dark = dark; self.fonts = fonts; self.type = type; self.css = css
        }
    }

    // MARK: Methods

    public struct ValidateParams: Codable, Equatable, Sendable {
        public var path: String?
        public var theme: Theme?
        public init(path: String) { self.path = path; self.theme = nil }
        public init(theme: Theme) { self.path = nil; self.theme = theme }
    }
    public struct ValidateResult: Codable, Equatable, Sendable {
        public var ok: Bool
        public var problems: [String]
        public var theme: Theme?
        public var missingFonts: [String]
        public init(ok: Bool, problems: [String] = [], theme: Theme? = nil, missingFonts: [String] = []) {
            self.ok = ok; self.problems = problems; self.theme = theme; self.missingFonts = missingFonts
        }
    }

    public struct SaveParams: Codable, Equatable, Sendable {
        public var path: String
        public var theme: Theme
        public init(path: String, theme: Theme) { self.path = path; self.theme = theme }
    }
    public struct SaveResult: Codable, Equatable, Sendable {
        public var path: String
        public var theme: Theme
        public var fonts: [String]
        public init(path: String, theme: Theme, fonts: [String] = []) { self.path = path; self.theme = theme; self.fonts = fonts }
    }

    public struct ApplyParams: Codable, Equatable, Sendable {
        public var path: String
        public init(path: String) { self.path = path }
    }
    public struct ApplyResult: Codable, Equatable, Sendable {
        public var theme: Theme
        public var fonts: [String]
        /// As talk.edit: its inverse undoes the change to theme.css.
        public var edit: SidecarProtocol.EditResult
        public init(theme: Theme, fonts: [String], edit: SidecarProtocol.EditResult) { self.theme = theme; self.fonts = fonts; self.edit = edit }
    }

    public struct ExtractParams: Codable, Equatable, Sendable {
        public var path: String?
        public var id: String?
        public var name: String?
        public var description: String?
        public init(path: String? = nil, id: String? = nil, name: String? = nil, description: String? = nil) {
            self.path = path; self.id = id; self.name = name; self.description = description
        }
    }
    public struct ExtractResult: Codable, Equatable, Sendable {
        public var theme: Theme
        public var path: String?
        public var fonts: [String]
        public init(theme: Theme, path: String? = nil, fonts: [String] = []) { self.theme = theme; self.path = path; self.fonts = fonts }
    }

    /// A family in the Google Fonts catalog (Fontsource).
    public struct FontInfo: Codable, Equatable, Hashable, Sendable, Identifiable {
        public var id: String
        public var family: String
        public var category: String
        public var weights: [Int]
        public var styles: [String]
        public var subsets: [String]
        public var defSubset: String
        public var variable: Bool
        public var license: String
        public init(id: String, family: String, category: String, weights: [Int], styles: [String] = ["normal"], subsets: [String] = ["latin"],
                    defSubset: String = "latin", variable: Bool = false, license: String = "OFL-1.1") {
            self.id = id; self.family = family; self.category = category; self.weights = weights; self.styles = styles
            self.subsets = subsets; self.defSubset = defSubset; self.variable = variable; self.license = license
        }
        public var hasItalic: Bool { styles.contains("italic") }
    }

    public struct FontsSearchParams: Codable, Equatable, Sendable {
        public var query: String
        public var category: String?
        public var limit: Int?
        public init(query: String, category: String? = nil, limit: Int? = nil) { self.query = query; self.category = category; self.limit = limit }
    }
    public enum CatalogSource: String, Codable, Sendable { case cache, network, stale }
    public struct FontsSearchResult: Codable, Equatable, Sendable {
        public var fonts: [FontInfo]
        public var catalog: CatalogSource
        public init(fonts: [FontInfo], catalog: CatalogSource = .cache) { self.fonts = fonts; self.catalog = catalog }
    }

    public struct FontsAddParams: Codable, Equatable, Sendable {
        public var id: String
        public var weights: [Int]?
        public var styles: [String]?
        public var subset: String?
        public init(id: String, weights: [Int]? = nil, styles: [String]? = nil, subset: String? = nil) {
            self.id = id; self.weights = weights; self.styles = styles; self.subset = subset
        }
    }
    public struct FontsAddResult: Codable, Equatable, Sendable {
        public var family: String
        /// The CSS font-family value to use (the family quoted, then a fallback for its category).
        public var fontFamily: String
        public var files: [String]
        public var edit: SidecarProtocol.EditResult
        public init(family: String, fontFamily: String, files: [String], edit: SidecarProtocol.EditResult) {
            self.family = family; self.fontFamily = fontFamily; self.files = files; self.edit = edit
        }
    }

    public struct EmbeddedFont: Codable, Equatable, Hashable, Sendable, Identifiable {
        public var family: String
        public var id: String
        public var subset: String
        public var weights: [Int]
        public var styles: [String]
        public var files: [String]
        public init(family: String, id: String, subset: String = "latin", weights: [Int], styles: [String] = ["normal"], files: [String] = []) {
            self.family = family; self.id = id; self.subset = subset; self.weights = weights; self.styles = styles; self.files = files
        }
    }
    public struct FontsListResult: Codable, Equatable, Sendable {
        public var fonts: [EmbeddedFont]
        public init(fonts: [EmbeddedFont]) { self.fonts = fonts }
    }
}

/// Themes and fonts through the sidecar; the client, or a fake in tests.
public protocol ThemeService: Sendable {
    func validateTheme(_ p: ThemeProtocol.ValidateParams) async throws -> ThemeProtocol.ValidateResult
    func saveTheme(_ p: ThemeProtocol.SaveParams) async throws -> ThemeProtocol.SaveResult
    func applyTheme(_ p: ThemeProtocol.ApplyParams) async throws -> ThemeProtocol.ApplyResult
    func extractTheme(_ p: ThemeProtocol.ExtractParams) async throws -> ThemeProtocol.ExtractResult
    func searchFonts(_ p: ThemeProtocol.FontsSearchParams) async throws -> ThemeProtocol.FontsSearchResult
    func addFont(_ p: ThemeProtocol.FontsAddParams) async throws -> ThemeProtocol.FontsAddResult
    func listFonts() async throws -> ThemeProtocol.FontsListResult
}

extension SidecarClient: ThemeService {
    public func validateTheme(_ p: ThemeProtocol.ValidateParams) async throws -> ThemeProtocol.ValidateResult {
        try await call(ThemeProtocol.Method.validate, p)
    }
    /// Downloads missing fonts, so it may take a while on a slow network.
    public func saveTheme(_ p: ThemeProtocol.SaveParams) async throws -> ThemeProtocol.SaveResult {
        try await call(ThemeProtocol.Method.save, p, timeout: .seconds(180))
    }
    public func applyTheme(_ p: ThemeProtocol.ApplyParams) async throws -> ThemeProtocol.ApplyResult {
        try await call(ThemeProtocol.Method.apply, p, timeout: .seconds(180))
    }
    public func extractTheme(_ p: ThemeProtocol.ExtractParams) async throws -> ThemeProtocol.ExtractResult {
        try await call(ThemeProtocol.Method.extract, p, timeout: .seconds(180))
    }
    public func searchFonts(_ p: ThemeProtocol.FontsSearchParams) async throws -> ThemeProtocol.FontsSearchResult {
        try await call(ThemeProtocol.Method.searchFonts, p, timeout: .seconds(60))
    }
    public func addFont(_ p: ThemeProtocol.FontsAddParams) async throws -> ThemeProtocol.FontsAddResult {
        try await call(ThemeProtocol.Method.addFont, p, timeout: .seconds(120))
    }
    public func listFonts() async throws -> ThemeProtocol.FontsListResult {
        try await call(ThemeProtocol.Method.listFonts)
    }
}
