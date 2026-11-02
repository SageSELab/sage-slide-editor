import Foundation

/// File ▸ New Talk…: scaffolds a sage-talk/1 folder from the skill's `assets/starter-v2`, the same
/// minimal working talk `scripts/new-talk.sh` copies (title, one chapter, the dark close, a backup
/// and a public end card; it validates and builds as is). The title goes into talk.json.
public enum NewTalk {
    public static let starterPath = "skills/academic-talk-film/assets/starter-v2"

    public enum CreateError: Error, Equatable, LocalizedError {
        case noStarter, notEmpty(String)
        public var errorDescription: String? {
            switch self {
            case .noStarter: "The starter talk was not found in the app or the repository."
            case .notEmpty(let name): "“\(name)” already exists and is not empty. Choose a new folder name."
            }
        }
    }

    /// The starter folder: inside a packaged app's bundled plugin, else the repository's skill.
    public static func starter(environment: [String: String] = ProcessInfo.processInfo.environment,
                               resources: URL? = Bundle.main.resourceURL,
                               executable: URL? = Bundle.main.executableURL) -> URL? {
        var candidates: [URL] = []
        if SidecarLocator.usesBundle(environment: environment, resources: resources), let resources {
            candidates.append(resources.appendingPathComponent("sidecar/plugin").appendingPathComponent(starterPath))
        }
        if let repo = SidecarLocator.repoRoot(environment: environment, resources: resources, executable: executable) {
            candidates.append(repo.appendingPathComponent("skill/academic-talk-film/assets/starter-v2"))
        }
        return candidates.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("talk.json").path) }
    }

    /// Copies the starter into `folder` (created; an existing folder must be empty) and sets the title.
    public static func create(at folder: URL, title: String, starter: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: folder.path) {
            let visible = try fm.contentsOfDirectory(atPath: folder.path).filter { !$0.hasPrefix(".") }
            guard visible.isEmpty else { throw CreateError.notEmpty(folder.lastPathComponent) }
        } else {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        try copyContents(of: starter, into: folder)
        let spine = folder.appendingPathComponent("talk.json")
        let text = try String(contentsOf: spine, encoding: .utf8)
        try text.replacingOccurrences(of: "\"__TITLE__\"", with: jsonString(title))
            .write(to: spine, atomically: true, encoding: .utf8)
        let ignore = folder.appendingPathComponent(".gitignore")
        if !fm.fileExists(atPath: ignore.path) { try "build/\n.sage/\n".write(to: ignore, atomically: true, encoding: .utf8) }
        let plan = folder.appendingPathComponent("PLAN.md")
        if !fm.fileExists(atPath: plan.path) {
            try "# \(title) · storyboard\n\n(see the skill's references/storyboard.md for the template)\n"
                .write(to: plan, atomically: true, encoding: .utf8)
        }
    }

    /// Copies file contents only. FileManager.copyItem would also copy extended attributes, and the
    /// bundled starter carries Dropbox's com.dropbox.attrs (the app is built inside Dropbox): a new
    /// talk in Dropbox would then claim the starter's Dropbox identity until Dropbox rewrote it.
    static func copyContents(of source: URL, into dest: URL) throws {
        let fm = FileManager.default
        for name in try fm.contentsOfDirectory(atPath: source.path) where name != ".DS_Store" {
            let from = source.appendingPathComponent(name), to = dest.appendingPathComponent(name)
            var isDir: ObjCBool = false
            fm.fileExists(atPath: from.path, isDirectory: &isDir)
            if isDir.boolValue {
                try fm.createDirectory(at: to, withIntermediateDirectories: true)
                try copyContents(of: from, into: to)
            } else {
                try Data(contentsOf: from).write(to: to)
            }
        }
    }

    static func jsonString(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [s], options: [.withoutEscapingSlashes])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }
}
