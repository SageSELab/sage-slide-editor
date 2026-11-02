import Foundation

/// The theme library on disk: the built-in themes (read-only, in the skill the app bundles) and
/// the user's (`~/Library/Application Support/SAGE Talk/Themes`, or `SAGE_THEME_LIBRARY`, the
/// same folder the sidecar saves Claude's themes to). Each theme is a `.talktheme` folder named
/// after its id. A user theme with a built-in's id shadows the built-in.
public struct ThemeLibrary: Sendable {
    public struct Entry: Identifiable, Equatable, Hashable, Sendable {
        public var theme: ThemeProtocol.Theme
        public var url: URL
        public var builtin: Bool
        public var id: String { theme.id }
        public init(theme: ThemeProtocol.Theme, url: URL, builtin: Bool) { self.theme = theme; self.url = url; self.builtin = builtin }
    }

    public enum LibraryError: LocalizedError, Equatable {
        case notATheme(String)
        case builtin(String)
        public var errorDescription: String? {
            switch self {
            case .notATheme(let why): "This is not a SAGE theme: \(why)"
            case .builtin(let name): "“\(name)” is a built-in theme; duplicate it to change it."
            }
        }
    }

    public static let builtinPath = "skills/academic-talk-film/assets/themes"

    public var userDirectory: URL
    public var builtinDirectory: URL?
    /// Delete moves to the Trash (tests turn it off).
    public var useTrash = true

    public init(userDirectory: URL, builtinDirectory: URL?) {
        self.userDirectory = userDirectory; self.builtinDirectory = builtinDirectory
    }

    /// The app's library: the user folder, and the built-ins in the bundled plugin or the repository.
    public static func standard(environment: [String: String] = ProcessInfo.processInfo.environment,
                                resources: URL? = Bundle.main.resourceURL, executable: URL? = Bundle.main.executableURL) -> ThemeLibrary {
        ThemeLibrary(userDirectory: userDirectory(environment: environment),
                     builtinDirectory: builtins(environment: environment, resources: resources, executable: executable))
    }

    public static func userDirectory(environment: [String: String] = ProcessInfo.processInfo.environment) -> URL {
        if let p = environment["SAGE_THEME_LIBRARY"], !p.isEmpty { return URL(fileURLWithPath: p, isDirectory: true) }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return support.appendingPathComponent("SAGE Talk/Themes", isDirectory: true)
    }

    /// Built-ins: inside a packaged app's bundled plugin, else the repository's skill.
    public static func builtins(environment: [String: String] = ProcessInfo.processInfo.environment,
                                resources: URL? = Bundle.main.resourceURL, executable: URL? = Bundle.main.executableURL) -> URL? {
        var candidates: [URL] = []
        if SidecarLocator.usesBundle(environment: environment, resources: resources), let resources {
            candidates.append(resources.appendingPathComponent("sidecar/plugin").appendingPathComponent(builtinPath))
        }
        if let repo = SidecarLocator.repoRoot(environment: environment, resources: resources, executable: executable) {
            candidates.append(repo.appendingPathComponent("skill/academic-talk-film/assets/themes"))
        }
        return candidates.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("sage.talktheme/theme.json").path) }
    }

    // MARK: Reading

    public static func read(_ package: URL) throws -> ThemeProtocol.Theme {
        let data: Data
        do { data = try Data(contentsOf: package.appendingPathComponent("theme.json")) } catch { throw LibraryError.notATheme("it has no readable theme.json") }
        let theme: ThemeProtocol.Theme
        do { theme = try JSONDecoder().decode(ThemeProtocol.Theme.self, from: data) } catch { throw LibraryError.notATheme("theme.json does not decode (\(error.localizedDescription))") }
        guard theme.format == ThemeProtocol.format else { throw LibraryError.notATheme("its format is \(theme.format), not \(ThemeProtocol.format)") }
        return theme
    }

    private static func scan(_ dir: URL?, builtin: Bool) -> [Entry] {
        guard let dir, let names = try? FileManager.default.contentsOfDirectory(atPath: dir.path) else { return [] }
        return names.filter { $0.hasSuffix("." + ThemeProtocol.fileExtension) }.sorted().compactMap { name in
            let url = dir.appendingPathComponent(name, isDirectory: true)
            return (try? read(url)).map { Entry(theme: $0, url: url, builtin: builtin) }
        }
    }

    /// Built-ins first (SAGE leading), then the user's themes by name.
    public func entries() -> [Entry] {
        let user = Self.scan(userDirectory, builtin: false)
        let shadowed = Set(user.map(\.id))
        let builtins = Self.scan(builtinDirectory, builtin: true).filter { !shadowed.contains($0.id) }
            .sorted { ($0.id == "sage" ? 0 : 1, $0.theme.name) < ($1.id == "sage" ? 0 : 1, $1.theme.name) }
        return builtins + user.sorted { $0.theme.name.localizedStandardCompare($1.theme.name) == .orderedAscending }
    }

    // MARK: Changing

    /// The package a user theme with this id lives in.
    public func userURL(for id: String) -> URL {
        userDirectory.appendingPathComponent("\(id).\(ThemeProtocol.fileExtension)", isDirectory: true)
    }

    /// `base`, or `base-2`, `base-3`... so that no library theme has it.
    public func uniqueID(_ base: String) -> String {
        let taken = Set(entries().map(\.id))
        let stem = Self.slug(base)
        if !taken.contains(stem) { return stem }
        var n = 2
        while taken.contains("\(stem)-\(n)") { n += 1 }
        return "\(stem)-\(n)"
    }

    /// Lowercase letters, digits and "-" (the theme.json id rule).
    public static func slug(_ name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        var out = "", dash = false
        for ch in folded.unicodeScalars {
            if CharacterSet.alphanumerics.contains(ch) && ch.isASCII { out.unicodeScalars.append(ch); dash = false }
            else if !dash && !out.isEmpty { out += "-"; dash = true }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "theme" : String(out.prefix(63))
    }

    /// Copies a package into the user folder. A theme whose id is already in the library is
    /// imported under a new id (and " 2" added to its name) unless `replace` is set.
    @discardableResult
    public func importPackage(_ source: URL, replace: Bool = false) throws -> Entry {
        var theme = try Self.read(source)
        let fm = FileManager.default
        if !replace, entries().contains(where: { $0.id == theme.id }) {
            let id = uniqueID(theme.id)
            theme.name += " " + (id.split(separator: "-").last.map(String.init) ?? "2")
            theme.id = id
        }
        let dest = userURL(for: theme.id)
        if dest.standardizedFileURL == source.standardizedFileURL { return Entry(theme: theme, url: dest, builtin: false) }
        try fm.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.copyItem(at: source, to: dest)
        try Self.write(theme, to: dest)
        return Entry(theme: theme, url: dest, builtin: false)
    }

    /// A copy of any theme (a built-in included) in the user folder, named "<name> Copy".
    @discardableResult
    public func duplicate(_ entry: Entry, name: String? = nil) throws -> Entry {
        var theme = entry.theme
        theme.name = name ?? "\(theme.name) Copy"
        theme.id = uniqueID(theme.name)
        let fm = FileManager.default
        try fm.createDirectory(at: userDirectory, withIntermediateDirectories: true)
        let dest = userURL(for: theme.id)
        try fm.copyItem(at: entry.url, to: dest)
        try Self.write(theme, to: dest)
        return Entry(theme: theme, url: dest, builtin: false)
    }

    /// Moves a user theme to the Trash (built-ins cannot be deleted).
    public func delete(_ entry: Entry) throws {
        guard !entry.builtin else { throw LibraryError.builtin(entry.theme.name) }
        var trashed: NSURL?
        if useTrash, (try? FileManager.default.trashItem(at: entry.url, resultingItemURL: &trashed)) != nil { return }
        try FileManager.default.removeItem(at: entry.url)
    }

    /// Rewrites theme.json only (the sidecar's theme.save regenerates theme.css and fonts/).
    public static func write(_ theme: ThemeProtocol.Theme, to package: URL) throws {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try (enc.encode(theme) + Data("\n".utf8)).write(to: package.appendingPathComponent("theme.json"), options: .atomic)
    }
}
