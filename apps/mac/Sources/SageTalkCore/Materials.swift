import Foundation

/// The Materials sidebar's model (PLAN 7): the folders and files talk.json declares under
/// `"materials"` (paths relative to the talk), each listed a few levels deep. AppKit-free; the
/// view (SageTalk/MaterialsView.swift) adds Quick Look and dragging a file into the chat.
public enum Materials {
    public struct Item: Identifiable, Hashable, Sendable {
        public var url: URL
        public var name: String
        public var isDirectory: Bool
        /// nil for files; the folder's listing (possibly cut short) otherwise.
        public var children: [Item]?
        /// Entries left out of this folder's listing (depth or count limit).
        public var omitted: Int
        public var id: String { url.path }
        /// Children for an outline: nil for files and for folders listed empty (or cut by depth).
        public var outlineChildren: [Item]? { children.flatMap { $0.isEmpty ? nil : $0 } }
    }

    public struct Entry: Identifiable, Hashable, Sendable {
        /// The key in talk.json ("paper", "pdf", "package").
        public var key: String
        /// The path as written in talk.json.
        public var path: String
        public var url: URL
        public var exists: Bool
        public var isDirectory: Bool
        /// A folder's contents; empty for a file or a missing path.
        public var items: [Item]
        public var omitted: Int
        public var id: String { key }
    }

    public struct Limits: Sendable {
        public var depth: Int
        public var perFolder: Int
        public init(depth: Int = 3, perFolder: Int = 200) { self.depth = depth; self.perFolder = perFolder }
    }

    /// Folders not worth listing (generated, vendored, version control).
    public static let skipped: Set<String> = ["node_modules", ".git", ".svn", "build", ".sage", "__pycache__", ".venv", "DerivedData"]

    /// talk.json's `materials` (empty when absent or unreadable), in key order.
    public static func declared(talkRoot: URL) -> [(key: String, path: String)] {
        guard let data = try? Data(contentsOf: talkRoot.appendingPathComponent("talk.json")),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let m = obj["materials"] as? [String: Any] else { return [] }
        return m.compactMap { k, v in (v as? String).map { (key: k, path: $0) } }.sorted { $0.key < $1.key }
    }

    /// Every declared entry, resolved against the talk and listed.
    public static func load(talkRoot: URL, limits: Limits = Limits()) -> [Entry] {
        declared(talkRoot: talkRoot).map { d in
            let url = URL(fileURLWithPath: d.path, relativeTo: talkRoot).standardizedFileURL
            var isDir: ObjCBool = false
            let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            let (items, omitted) = exists && isDir.boolValue ? list(url, depth: limits.depth, limits: limits) : ([], 0)
            return Entry(key: d.key, path: d.path, url: url, exists: exists, isDirectory: isDir.boolValue, items: items, omitted: omitted)
        }
    }

    /// A folder's visible entries, folders first, then by name (Finder order), `depth` levels deep.
    public static func list(_ dir: URL, depth: Int, limits: Limits = Limits()) -> ([Item], Int) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return ([], 0) }
        var rows: [(name: String, url: URL, dir: Bool)] = []
        for n in names where !n.hasPrefix(".") && !skipped.contains(n) {
            let u = dir.appendingPathComponent(n)
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: u.path, isDirectory: &isDir) else { continue }
            rows.append((n, u, isDir.boolValue))
        }
        rows.sort { a, b in a.dir != b.dir ? a.dir : a.name.localizedStandardCompare(b.name) == .orderedAscending }
        let kept = rows.prefix(limits.perFolder)
        let items = kept.map { r -> Item in
            guard r.dir else { return Item(url: r.url, name: r.name, isDirectory: false, children: nil, omitted: 0) }
            if depth <= 1 {
                let n = (try? fm.contentsOfDirectory(atPath: r.url.path).filter { !$0.hasPrefix(".") }.count) ?? 0
                return Item(url: r.url, name: r.name, isDirectory: true, children: [], omitted: n)
            }
            let (kids, more) = list(r.url, depth: depth - 1, limits: limits)
            return Item(url: r.url, name: r.name, isDirectory: true, children: kids, omitted: more)
        }
        return (items, rows.count - kept.count)
    }

    /// How a file is named in a message to Claude: relative to the talk when that is shorter to
    /// read (inside it, or a sibling such as ../paper/main.tex), else absolute.
    public static func attachmentPath(for url: URL, talkRoot: URL) -> String {
        let a = url.standardizedFileURL.pathComponents, r = talkRoot.standardizedFileURL.pathComponents
        var i = 0
        while i < a.count, i < r.count, a[i] == r[i] { i += 1 }
        let ups = r.count - i
        // Sharing only "/" or a couple of top folders: an absolute path reads better.
        if i <= 1 || ups > 3 { return url.standardizedFileURL.path }
        let rel = Array(repeating: "..", count: ups) + a[i...]
        return rel.isEmpty ? "." : rel.joined(separator: "/")
    }
}
