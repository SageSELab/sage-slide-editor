import Foundation
import Testing
@testable import SageTalkCore

@Suite struct ThumbnailCacheTests {
    let root: URL
    init() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("sage-thumbs-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func film(_ html: String) throws -> URL {
        let u = root.appendingPathComponent("index.html")
        try Data(html.utf8).write(to: u)
        return u
    }

    @Test func keysHashTheFilmAndTheTime() throws {
        let a = try ThumbnailCache.filmHash(of: film("<p>one</p>"))
        let a2 = try ThumbnailCache.filmHash(of: film("<p>one</p>"))
        let b = try ThumbnailCache.filmHash(of: film("<p>two</p>"))
        #expect(a == a2)
        #expect(a != b)
        #expect(a.count == 16)
        #expect(ThumbnailCache.key(film: a, at: 27.600000000000001) == "\(a)-27.600")
        #expect(ThumbnailCache.key(film: a, at: 36) != ThumbnailCache.key(film: b, at: 36))
        #expect(ThumbnailCache.key(film: a, at: 36) != ThumbnailCache.key(film: a, at: 36.5))
    }

    @Test func engineFilesBesideTheFilmAreHashedToo() throws {
        let f = try film("<p>same</p>")
        let before = try ThumbnailCache.filmHash(of: f)
        try Data("/* engine v2 */".utf8).write(to: root.appendingPathComponent("talk.css"))
        #expect(try ThumbnailCache.filmHash(of: f) != before)
    }

    @Test func legacyDecksAreNeverWrittenTo() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("legacy-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data().write(to: root.appendingPathComponent("index.html"))
        try Data().write(to: root.appendingPathComponent("talk.js"))
        let caches = URL(fileURLWithPath: "/caches")
        let dir = ThumbnailCache.directory(for: try TalkFolder(root: root), caches: caches)
        #expect(dir.path.hasPrefix("/caches/legacy-thumbs/"))
        #expect(!dir.path.hasPrefix(root.path))
        // Stable per deck path.
        #expect(dir == ThumbnailCache.directory(for: try TalkFolder(root: root), caches: caches))
    }

    @Test func beatFormatTalksKeepTheirCacheInSage() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("beat-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("{}".utf8).write(to: root.appendingPathComponent("talk.json"))
        let dir = ThumbnailCache.directory(for: try TalkFolder(root: root), caches: URL(fileURLWithPath: "/caches"))
        #expect(dir.path.hasSuffix(".sage/thumbs"))
    }

    @Test func livesInTheTalksSageFolder() {
        let c = ThumbnailCache(talkRoot: URL(fileURLWithPath: "/talk"))
        #expect(c.directory.path == "/talk/.sage/thumbs")
    }

    @Test func freshAfterStoreStaleAfterRebuild() throws {
        let holds = [Hold(index: 1, at: 5, label: "A"), Hold(index: 2, at: 13.5, label: "B")]
        var c = ThumbnailCache(talkRoot: root)
        #expect(c.stale(holds, film: "f1").count == 2)
        #expect(c.status(at: 5, film: "f1") == .stale(nil))

        let u = try c.store(Data("png5".utf8), at: 5, film: "f1", frame: "x")
        #expect(c.status(at: 5, film: "f1") == .fresh(u))
        #expect(c.stale(holds, film: "f1").map(\.index) == [2])

        // A rebuild: everything is stale, but the old PNG is still shown meanwhile.
        #expect(c.stale(holds, film: "f2").map(\.index) == [1, 2])
        #expect(c.status(at: 5, film: "f2") == .stale(u))
    }

    @Test func unchangedFramesAreAdoptedChangedOnesAreNot() throws {
        var c = ThumbnailCache(talkRoot: root)
        try c.store(Data("five".utf8), at: 5, film: "f1", frame: "frameA")
        try c.store(Data("thirteen".utf8), at: 13.5, film: "f1", frame: "frameB")

        // After a rebuild, the renderer fingerprints each hold again.
        let same = try #require(c.reusable(at: 5, frame: "frameA"))
        #expect(c.reusable(at: 13.5, frame: "frameB-edited") == nil)
        #expect(c.reusable(at: 99, frame: "frameA") == nil)

        let adopted = try c.adopt(same, at: 5, film: "f2", frame: "frameA")
        #expect(c.status(at: 5, film: "f2") == .fresh(adopted))
        #expect(try Data(contentsOf: adopted) == Data("five".utf8))
        try c.store(Data("thirteen v2".utf8), at: 13.5, film: "f2", frame: "frameB-edited")
        #expect(c.stale([Hold(index: 1, at: 5, label: ""), Hold(index: 2, at: 13.5, label: "")], film: "f2").isEmpty)
    }

    @Test func manifestPersistsAndPruneDeletesOrphans() throws {
        var c = ThumbnailCache(talkRoot: root)
        try c.store(Data("a".utf8), at: 5, film: "f1", frame: "fa")
        try c.store(Data("b".utf8), at: 8, film: "f1", frame: "fb")
        try c.store(Data("a2".utf8), at: 5, film: "f2", frame: "fa2")
        try c.save()

        var reloaded = ThumbnailCache(talkRoot: root)
        #expect(reloaded.entries == c.entries)
        #expect(reloaded.reusable(at: 5, frame: "fa2") != nil)

        reloaded.prune(keepingTimes: [5]) // the hold at 8 was deleted from the talk
        let files = try FileManager.default.contentsOfDirectory(atPath: reloaded.directory.path).filter { $0.hasSuffix(".png") }
        #expect(files == ["f2-5.000.png"])
        #expect(reloaded.entries.keys.sorted() == ["5.000"])
    }

    @Test func ignoresAManifestFromAnotherVersion() throws {
        let c = ThumbnailCache(talkRoot: root)
        try FileManager.default.createDirectory(at: c.directory, withIntermediateDirectories: true)
        try Data(#"{"version":99,"entries":{"5.000":{"film":"x","file":"x-5.000.png"}}}"#.utf8)
            .write(to: c.directory.appendingPathComponent("index.json"))
        #expect(ThumbnailCache(talkRoot: root).entries.isEmpty)
    }
}
