import Foundation
import Testing
@testable import SageTalkCore

/// `.talk` packages: recognition, naming, and the in-place conversion of a plain talk folder.
/// Everything runs on small temp talks (never on the fixtures).
@Suite struct TalkPackageTests {
    func temp() throws -> URL {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("talkpkg-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    func beatTalk(_ dir: URL) throws -> URL {
        try FileManager.default.createDirectory(at: dir.appendingPathComponent("scenes"), withIntermediateDirectories: true)
        try #"{"format": "sage-talk/1", "title": "T"}"#.write(to: dir.appendingPathComponent("talk.json"), atomically: true, encoding: .utf8)
        try "<div></div>".write(to: dir.appendingPathComponent("scenes/title.html"), atomically: true, encoding: .utf8)
        return dir
    }

    @Test func recognisesAPackageAndNamesItWithoutTheExtension() throws {
        let pkg = try beatTalk(try temp().appendingPathComponent("My Talk.talk"))
        let t = try TalkFolder(root: pkg)
        #expect(t.kind == .beatFormat)
        #expect(t.isPackage)
        #expect(t.name == "My Talk")
        #expect(!TalkPackage.canConvert(t))
        let plain = try TalkFolder(root: try beatTalk(try temp().appendingPathComponent("issta.v2")))
        #expect(!plain.isPackage)
        #expect(plain.name == "issta.v2")
        #expect(TalkPackage.canConvert(plain))
    }

    @Test func packageURLAddsTheExtensionOnce() {
        #expect(TalkPackage.packageURL(URL(fileURLWithPath: "/t/Untitled Talk")).lastPathComponent == "Untitled Talk.talk")
        #expect(TalkPackage.packageURL(URL(fileURLWithPath: "/t/Untitled Talk.talk")).lastPathComponent == "Untitled Talk.talk")
    }

    @Test func convertsAPlainFolderInPlace() throws {
        let base = try temp()
        let folder = try beatTalk(base.appendingPathComponent("issta26"))
        let dest = try TalkPackage.convert(folder)
        #expect(dest.lastPathComponent == "issta26.talk")
        #expect(dest.deletingLastPathComponent().standardizedFileURL.path == base.standardizedFileURL.path)
        #expect(!FileManager.default.fileExists(atPath: folder.path))
        #expect(try String(contentsOf: dest.appendingPathComponent("scenes/title.html"), encoding: .utf8) == "<div></div>")
        #expect(try TalkFolder(root: dest).isPackage)
    }

    @Test func refusesWhenTheTargetExists() throws {
        let base = try temp()
        let folder = try beatTalk(base.appendingPathComponent("t"))
        try FileManager.default.createDirectory(at: base.appendingPathComponent("t.talk"), withIntermediateDirectories: true)
        #expect(throws: TalkPackage.ConvertError.targetExists(base.appendingPathComponent("t.talk").standardizedFileURL.path)) {
            try TalkPackage.convert(folder)
        }
        #expect(FileManager.default.fileExists(atPath: folder.appendingPathComponent("talk.json").path))
    }

    @Test func refusesLegacyDecksAndPackages() throws {
        let legacy = try temp().appendingPathComponent("old")
        try FileManager.default.createDirectory(at: legacy, withIntermediateDirectories: true)
        try "<!doctype html>".write(to: legacy.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
        try "".write(to: legacy.appendingPathComponent("talk.js"), atomically: true, encoding: .utf8)
        #expect(throws: TalkPackage.ConvertError.self) { try TalkPackage.convert(legacy) }
        let pkg = try beatTalk(try temp().appendingPathComponent("p.talk"))
        #expect(throws: TalkPackage.ConvertError.self) { try TalkPackage.convert(pkg) }
        #expect(FileManager.default.fileExists(atPath: pkg.path))
    }

    @Test func findsTheEnclosingGitRepository() throws {
        let repo = try temp()
        try FileManager.default.createDirectory(at: repo.appendingPathComponent(".git"), withIntermediateDirectories: true)
        let talk = try beatTalk(repo.appendingPathComponent("paper/talk"))
        #expect(TalkPackage.gitRepository(containing: talk)?.standardizedFileURL.path == repo.standardizedFileURL.path)
        // A worktree or submodule has a .git file.
        let wt = try temp()
        try "gitdir: /elsewhere".write(to: wt.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        #expect(TalkPackage.gitRepository(containing: try beatTalk(wt.appendingPathComponent("t")))?.standardizedFileURL.path == wt.standardizedFileURL.path)
        #expect(TalkPackage.gitRepository(containing: try temp()) == nil)
    }
}
