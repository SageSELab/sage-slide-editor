import Foundation

/// A talk on disk. During Phase 0/1 the app can open either a sage-talk/1 folder
/// (talk.json + build/index.html) or a legacy hand-written deck (index.html + talk.js), read-only.
public struct TalkFolder: Equatable, Sendable {
    public enum Kind: Equatable, Sendable { case beatFormat, legacy }

    public let root: URL
    public let kind: Kind

    public init(root: URL) throws {
        let fm = FileManager.default
        self.root = root.standardizedFileURL
        if fm.fileExists(atPath: root.appendingPathComponent("talk.json").path) {
            kind = .beatFormat
        } else if fm.fileExists(atPath: root.appendingPathComponent("index.html").path),
                  fm.fileExists(atPath: root.appendingPathComponent("talk.js").path) {
            kind = .legacy
        } else {
            throw TalkFolderError.notATalk(root.path)
        }
    }

    /// The compiled film the canvas loads.
    public var filmURL: URL {
        switch kind {
        case .beatFormat: root.appendingPathComponent("build/index.html")
        case .legacy: root.appendingPathComponent("index.html")
        }
    }

    public var displayName: String { root.deletingLastPathComponent().lastPathComponent + "/" + root.lastPathComponent }

    /// URL that opens the film frozen at a time with controls hidden (engine's ?t=&capture).
    public func filmURL(at t: Double, capture: Bool = true) -> URL {
        var c = URLComponents(url: filmURL, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "t", value: String(t))] + (capture ? [URLQueryItem(name: "capture", value: nil)] : [])
        return c.url!
    }
}

public enum TalkFolderError: Error, Equatable, LocalizedError {
    case notATalk(String)
    public var errorDescription: String? {
        switch self {
        case .notATalk(let p): "\(p) is not a talk folder (expected talk.json, or index.html with talk.js)."
        }
    }
}

/// A hold as reported by the engine (`?cplist` or the layout runtime).
public struct Hold: Codable, Equatable, Identifiable, Sendable {
    public var index: Int
    public var at: Double
    public var label: String
    public var backup: Bool
    /// The chapter id (beat-format talks, from talk.layout or the engine); nil for legacy decks.
    public var chapter: String?
    /// Speaker notes (the engine's `T.cps[i].notes`).
    public var notes: String?
    /// The beat ref 'chapter.beat' (beat-format talks); nil for legacy decks.
    public var beat: String?
    public var id: Int { index }
    public init(index: Int, at: Double, label: String, backup: Bool = false, chapter: String? = nil, notes: String? = nil,
                beat: String? = nil) {
        self.index = index; self.at = at; self.label = label; self.backup = backup
        self.chapter = chapter; self.notes = notes; self.beat = beat
    }

    /// Parses the engine's `?cplist` output: lines of "n time label".
    public static func parseCPList(_ text: String) -> [Hold] {
        text.split(separator: "\n").compactMap { line in
            let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            guard parts.count >= 2, let n = Int(parts[0]), let t = Double(parts[1]) else { return nil }
            return Hold(index: n, at: t, label: parts.count > 2 ? String(parts[2]) : "")
        }
    }
}
