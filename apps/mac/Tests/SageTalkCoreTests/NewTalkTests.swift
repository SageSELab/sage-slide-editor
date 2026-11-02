import Foundation
import Testing
@testable import SageTalkCore

@Suite struct NewTalkTests {
    let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

    func temp() throws -> URL {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("newtalk-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    @Test func findsTheRepositoryStarter() throws {
        let s = try #require(NewTalk.starter(environment: ["SAGE_REPO": repo.path], resources: nil, executable: nil))
        #expect(s.path.hasSuffix("skill/academic-talk-film/assets/starter-v2"))
    }

    @Test func findsTheBundledStarterInAPackagedApp() throws {
        let res = try temp()
        let starter = res.appendingPathComponent("sidecar/plugin").appendingPathComponent(NewTalk.starterPath)
        try FileManager.default.createDirectory(at: starter, withIntermediateDirectories: true)
        try "{}".write(to: starter.appendingPathComponent("talk.json"), atomically: true, encoding: .utf8)
        // A complete bundled sidecar, as SidecarConfiguration.Bundled.present checks for it.
        let fm = FileManager.default
        let node = res.appendingPathComponent(SidecarConfiguration.Bundled.node)
        try fm.createDirectory(at: node.deletingLastPathComponent(), withIntermediateDirectories: true)
        fm.createFile(atPath: node.path, contents: Data("#!/bin/sh\n".utf8), attributes: [.posixPermissions: 0o755])
        let side = res.appendingPathComponent(SidecarConfiguration.Bundled.sidecarDir)
        try fm.createDirectory(at: side.appendingPathComponent("dist"), withIntermediateDirectories: true)
        fm.createFile(atPath: side.appendingPathComponent(SidecarConfiguration.Bundled.entry).path, contents: Data())
        fm.createFile(atPath: side.appendingPathComponent(SidecarConfiguration.Bundled.manifest).path, contents: Data("{}".utf8))
        #expect(SidecarConfiguration.Bundled.present(in: res))
        #expect(NewTalk.starter(environment: [:], resources: res, executable: nil)?.standardizedFileURL.path == starter.standardizedFileURL.path)
    }

    @Test func createsATitledTalkFromTheStarter() throws {
        let starter = try #require(NewTalk.starter(environment: ["SAGE_REPO": repo.path], resources: nil, executable: nil))
        let folder = try temp().appendingPathComponent("My Talk")
        try NewTalk.create(at: folder, title: #"A "quoted" talk \ here"#, starter: starter)
        let data = try Data(contentsOf: folder.appendingPathComponent("talk.json"))
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["title"] as? String == #"A "quoted" talk \ here"#)
        #expect(json["format"] as? String == "sage-talk/1")
        for f in ["theme.css", "scenes/title.html", "beats/title.js", "assets/manrope-latin.woff2", ".gitignore", "PLAN.md"] {
            #expect(FileManager.default.fileExists(atPath: folder.appendingPathComponent(f).path), "\(f)")
        }
        #expect((try? TalkFolder(root: folder))?.kind == .beatFormat)
    }

    @Test func refusesANonEmptyFolder() throws {
        let starter = try #require(NewTalk.starter(environment: ["SAGE_REPO": repo.path], resources: nil, executable: nil))
        let folder = try temp()
        try "keep".write(to: folder.appendingPathComponent("notes.txt"), atomically: true, encoding: .utf8)
        #expect(throws: NewTalk.CreateError.notEmpty(folder.lastPathComponent)) {
            try NewTalk.create(at: folder, title: "T", starter: starter)
        }
        #expect(!FileManager.default.fileExists(atPath: folder.appendingPathComponent("talk.json").path))
    }
}
