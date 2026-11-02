import CryptoKit
import Foundation

/// The navigator's thumbnail cache in `<talk>/.sage/thumbs` (PLAN 5.2).
///
/// A thumbnail's file name is its key: a hash of the compiled film (`build/index.html`, or a
/// legacy deck's `index.html`, plus the engine files beside it) and the hold time,
/// `"<film>-<t>.png"`. Every compiled input is inlined in that file, so a key can only be stale
/// when the film changed or the hold moved.
///
/// A rebuild changes the film hash for every hold, but most frames do not change. So the cache
/// also records, per hold time, a fingerprint of the rendered frame (computed by the renderer
/// from the visible DOM after `T.seek`). After a rebuild the renderer seeks, fingerprints, and
/// only snapshots holds whose fingerprint differs; the others adopt their previous PNG under the
/// new key. `index.json` holds those records.
public struct ThumbnailCache: Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public var film: String
        public var frame: String?
        public var file: String
    }

    /// What the navigator can show for one hold before any rendering happens.
    public enum Status: Equatable, Sendable {
        /// Current for this film.
        case fresh(URL)
        /// Rendered from an older film (shown until replaced), or nil if never rendered.
        case stale(URL?)
    }

    public let directory: URL
    public private(set) var entries: [String: Entry] = [:]

    private var manifestURL: URL { directory.appendingPathComponent("index.json") }

    public init(directory: URL) {
        self.directory = directory
        if let data = try? Data(contentsOf: manifestURL),
           let m = try? JSONDecoder().decode(Manifest.self, from: data), m.version == Manifest.current {
            entries = m.entries
        }
    }

    public init(talkRoot: URL) {
        self.init(directory: talkRoot.appendingPathComponent(".sage/thumbs", isDirectory: true))
    }

    /// Where a talk's thumbnails live. A sage-talk/1 folder is the app's document, so its cache
    /// sits in its own gitignored `.sage/`. A legacy deck is opened read-only and usually lives
    /// in a paper repository, so nothing is written next to it: its cache goes under
    /// `caches` (normally ~/Library/Caches/<bundle id>) in a folder named by its path's hash.
    public static func directory(for talk: TalkFolder, caches: URL) -> URL {
        switch talk.kind {
        case .beatFormat:
            return talk.root.appendingPathComponent(".sage/thumbs", isDirectory: true)
        case .legacy:
            let digest = SHA256.hash(data: Data(talk.root.standardizedFileURL.path.utf8))
            let name = digest.prefix(8).map { String(format: "%02x", $0) }.joined()
            return caches.appendingPathComponent("legacy-thumbs/\(name)", isDirectory: true)
        }
    }

    /// The per-user caches folder for this app.
    public static var userCaches: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "io.sagelab.talk", isDirectory: true)
    }

    // MARK: Keys

    /// Engine files the compiled film loads from beside itself; they change every frame too.
    public static let engineFiles = ["talk.js", "talk.css", "talk-layout.js", "edit.js"]

    /// First 16 hex digits of the SHA-256 of the film file, plus the engine files next to it.
    public static func filmHash(of film: URL) throws -> String {
        var data = try Data(contentsOf: film)
        let dir = film.deletingLastPathComponent()
        for name in engineFiles {
            if let d = try? Data(contentsOf: dir.appendingPathComponent(name)) {
                data.append(Data("\u{0}\(name)\u{0}".utf8))
                data.append(d)
            }
        }
        return filmHash(of: data)
    }

    public static func filmHash(of data: Data) -> String {
        SHA256.hash(data: data).prefix(8).map { String(format: "%02x", $0) }.joined()
    }

    /// The hold time as it appears in keys: millisecond precision, so float noise from the layout
    /// (27.600000000000001) does not split a key.
    public static func timeKey(_ at: Double) -> String { String(format: "%.3f", at) }

    public static func key(film: String, at: Double) -> String { "\(film)-\(timeKey(at))" }

    public func url(film: String, at: Double) -> URL {
        directory.appendingPathComponent(Self.key(film: film, at: at) + ".png")
    }

    // MARK: Lookup

    public func status(at: Double, film: String) -> Status {
        let fm = FileManager.default
        let exact = url(film: film, at: at)
        if fm.fileExists(atPath: exact.path) { return .fresh(exact) }
        if let e = entries[Self.timeKey(at)] {
            let old = directory.appendingPathComponent(e.file)
            if fm.fileExists(atPath: old.path) { return .stale(old) }
        }
        return .stale(nil)
    }

    /// Holds that need work for this film, in the given order.
    public func stale(_ holds: [Hold], film: String) -> [Hold] {
        holds.filter { if case .fresh = status(at: $0.at, film: film) { false } else { true } }
    }

    /// The previous PNG for this time if its frame fingerprint matches, so it can be adopted
    /// under the new film's key instead of being snapshotted again.
    public func reusable(at: Double, frame: String) -> URL? {
        guard let e = entries[Self.timeKey(at)], e.frame == frame else { return nil }
        let u = directory.appendingPathComponent(e.file)
        return FileManager.default.fileExists(atPath: u.path) ? u : nil
    }

    // MARK: Writing

    /// Writes a freshly rendered PNG under its key and records it.
    @discardableResult
    public mutating func store(_ png: Data, at: Double, film: String, frame: String?) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let u = url(film: film, at: at)
        try png.write(to: u, options: .atomic)
        entries[Self.timeKey(at)] = Entry(film: film, frame: frame, file: u.lastPathComponent)
        return u
    }

    /// Re-keys an unchanged frame's PNG for a new film without re-rendering it.
    @discardableResult
    public mutating func adopt(_ existing: URL, at: Double, film: String, frame: String) throws -> URL {
        let u = url(film: film, at: at)
        let fm = FileManager.default
        if existing.standardizedFileURL != u.standardizedFileURL {
            try? fm.removeItem(at: u)
            try fm.copyItem(at: existing, to: u)
        }
        entries[Self.timeKey(at)] = Entry(film: film, frame: frame, file: u.lastPathComponent)
        return u
    }

    public func save() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .prettyPrinted]
        try enc.encode(Manifest(version: Manifest.current, entries: entries)).write(to: manifestURL, options: .atomic)
    }

    /// Drops records for times that are no longer holds and deletes PNGs nothing refers to.
    public mutating func prune(keepingTimes times: [Double]) {
        let keep = Set(times.map(Self.timeKey))
        entries = entries.filter { keep.contains($0.key) }
        let referenced = Set(entries.values.map(\.file))
        let fm = FileManager.default
        for name in (try? fm.contentsOfDirectory(atPath: directory.path)) ?? []
        where name.hasSuffix(".png") && !referenced.contains(name) {
            try? fm.removeItem(at: directory.appendingPathComponent(name))
        }
    }

    private struct Manifest: Codable {
        static let current = 1
        var version: Int
        var entries: [String: Entry]
    }
}
