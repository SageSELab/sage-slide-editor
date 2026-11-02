import Foundation

/// `.talk` document packages (UTType `io.sagelab.talk`, declared in the app's Info.plist): a
/// sage-talk/1 folder named `<name>.talk`. It stays a real folder on disk (git, Dropbox, Claude
/// and talkc see its files), while Finder shows it as one document and opens it in SAGE Talk.
/// Plain talk folders keep working; the app offers, never forces, to rename one into a package.
public enum TalkPackage {
    public static let pathExtension = "talk"
    public static let typeIdentifier = "io.sagelab.talk"
    /// A theme package (theme.json, theme.css, fonts/), declared alongside.
    public static let themeExtension = "talktheme"
    public static let themeTypeIdentifier = "io.sagelab.talktheme"

    public static func isPackage(_ url: URL) -> Bool { url.pathExtension.lowercased() == pathExtension }

    /// The folder name without a `.talk` extension.
    public static func name(of url: URL) -> String {
        isPackage(url) ? url.deletingPathExtension().lastPathComponent : url.lastPathComponent
    }

    /// `url` with the `.talk` extension added unless it has it (File ▸ New Talk…).
    public static func packageURL(_ url: URL) -> URL {
        isPackage(url) ? url : url.appendingPathExtension(pathExtension)
    }

    /// A plain beat-format folder, which can become a package. Legacy decks and packages cannot.
    public static func canConvert(_ talk: TalkFolder) -> Bool { talk.kind == .beatFormat && !talk.isPackage }

    /// Where converting `folder` puts it: `<name>.talk` beside it.
    public static func target(for folder: URL) -> URL {
        let f = folder.standardizedFileURL
        return f.deletingLastPathComponent().appendingPathComponent(f.lastPathComponent + "." + pathExtension, isDirectory: true)
    }

    /// The git working tree containing `folder` (the nearest ancestor, or itself, with a `.git`
    /// folder or file), if any: renaming the talk there shows up in git as a move.
    public static func gitRepository(containing folder: URL) -> URL? {
        var dir = folder.standardizedFileURL.path
        while !dir.isEmpty {
            if FileManager.default.fileExists(atPath: (dir as NSString).appendingPathComponent(".git")) {
                return URL(fileURLWithPath: dir, isDirectory: true)
            }
            if dir == "/" { return nil }
            dir = (dir as NSString).deletingLastPathComponent
        }
        return nil
    }

    public enum ConvertError: Error, Equatable, LocalizedError {
        case notConvertible(String), targetExists(String)
        public var errorDescription: String? {
            switch self {
            case .notConvertible(let p): "\(p) is not a plain talk folder, so it cannot be converted to a .talk package."
            case .targetExists(let p): "“\((p as NSString).lastPathComponent)” already exists next to the talk folder. Rename or move it first."
            }
        }
    }

    /// Renames a plain beat-format talk folder to `<name>.talk` in place and returns the new URL.
    /// Nothing inside the folder changes.
    @discardableResult
    public static func convert(_ folder: URL) throws -> URL {
        let talk = try TalkFolder(root: folder)
        guard canConvert(talk) else { throw ConvertError.notConvertible(talk.root.path) }
        let dest = target(for: talk.root)
        guard !FileManager.default.fileExists(atPath: dest.path) else { throw ConvertError.targetExists(dest.path) }
        try FileManager.default.moveItem(at: talk.root, to: dest)
        return dest
    }
}
