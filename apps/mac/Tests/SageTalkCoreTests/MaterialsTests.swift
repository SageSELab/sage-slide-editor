import Foundation
import Testing
@testable import SageTalkCore

/// The Materials sidebar's model: talk.json's materials resolved and listed, and the paths a
/// file dragged into the chat is attached under.
@MainActor @Suite struct MaterialsTests {
    /// base/talk (talk.json), base/paper (sources, figures, junk), base/pkg (deep), base/paper/main.pdf.
    static func tree() throws -> (base: URL, talk: URL) {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-materials-\(UUID().uuidString)").resolvingSymlinksInPath()
        func file(_ rel: String, _ text: String = "x") throws {
            let u = base.appendingPathComponent(rel)
            try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            try text.write(to: u, atomically: true, encoding: .utf8)
        }
        try file("talk/talk.json", #"{"format":"sage-talk/1","title":"T","materials":{"paper":"../paper","pdf":"../paper/main.pdf","package":"../pkg","missing":"../nope"},"chapters":[]}"#)
        try file("talk/scenes/c.html")
        for f in ["paper/main.tex", "paper/main.pdf", "paper/sections/intro.tex", "paper/sections/results.tex", "paper/figures/b.png",
                  "paper/figures/a.png", "paper/.DS_Store", "paper/node_modules/x/index.js", "paper/build/out.pdf", "paper/Appendix.tex",
                  "pkg/data/raw/2024/runs.csv", "pkg/README.md"] { try file(f) }
        return (base, base.appendingPathComponent("talk"))
    }

    @Test func listsTheDeclaredMaterials() throws {
        let (base, talk) = try Self.tree()
        defer { try? FileManager.default.removeItem(at: base) }
        let e = Materials.load(talkRoot: talk, limits: .init(depth: 2, perFolder: 50))
        #expect(e.map(\.key) == ["missing", "package", "paper", "pdf"])
        let byKey = Dictionary(uniqueKeysWithValues: e.map { ($0.key, $0) })
        #expect(byKey["missing"]?.exists == false)
        #expect(byKey["pdf"].map { $0.exists && !$0.isDirectory && $0.items.isEmpty } == true)
        #expect(byKey["pdf"]?.url.path == base.appendingPathComponent("paper/main.pdf").path)
        // Folders first, then names in Finder order; hidden, node_modules and build skipped.
        let paper = try #require(byKey["paper"])
        #expect(paper.items.map(\.name) == ["figures", "sections", "Appendix.tex", "main.pdf", "main.tex"])
        #expect(paper.items[0].children?.map(\.name) == ["a.png", "b.png"])
        #expect(paper.items[2].outlineChildren == nil)
        // Depth 2: pkg/data is listed, pkg/data/raw is a leaf folder with a count of what is under it.
        let data = try #require(byKey["package"]?.items.first)
        #expect(data.name == "data")
        let raw = try #require(data.children?.first)
        #expect(raw.name == "raw" && raw.isDirectory && raw.children == [] && raw.omitted == 1 && raw.outlineChildren == nil)
        // A per-folder cap counts what it leaves out.
        let capped = Materials.load(talkRoot: talk, limits: .init(depth: 1, perFolder: 2)).first { $0.key == "paper" }
        #expect(capped?.items.map(\.name) == ["figures", "sections"])
        #expect(capped?.omitted == 3)
    }

    @Test func noMaterials() throws {
        let (base, talk) = try Self.tree()
        defer { try? FileManager.default.removeItem(at: base) }
        try #"{"format":"sage-talk/1","title":"T","chapters":[]}"#.write(to: talk.appendingPathComponent("talk.json"), atomically: true, encoding: .utf8)
        #expect(Materials.load(talkRoot: talk).isEmpty)
        #expect(Materials.load(talkRoot: base.appendingPathComponent("absent")).isEmpty)
    }

    @Test func attachmentPaths() {
        let talk = URL(fileURLWithPath: "/Users/k/papers/issta/talk")
        let path = { (p: String) in Materials.attachmentPath(for: URL(fileURLWithPath: p), talkRoot: talk) }
        #expect(path("/Users/k/papers/issta/paper/main.tex") == "../paper/main.tex")
        #expect(path("/Users/k/papers/issta/talk/scenes/c.html") == "scenes/c.html")
        #expect(path("/Users/k/papers/other/pkg/data.csv") == "../../other/pkg/data.csv")
        #expect(path("/Volumes/Data/runs.csv") == "/Volumes/Data/runs.csv")
        #expect(path("/Users/x/Downloads/a.pdf") == "/Users/x/Downloads/a.pdf")
    }

    /// Dropping a file on the pane attaches it; the next message carries it, once.
    @Test func dropAttachesToTheNextMessage() async throws {
        let chat = ClaudeChat()
        let talk = URL(fileURLWithPath: "/Users/k/papers/issta/talk")
        chat.attachmentBase = talk
        let box = SentBox()
        chat.commands = .init(send: { p in await box.add(p) }, interrupt: {}, reset: {})
        chat.attach(URL(fileURLWithPath: "/Users/k/papers/issta/paper/tables/results.tex"))
        chat.attach(URL(fileURLWithPath: "/Users/k/papers/issta/paper/tables/results.tex"))
        chat.attach(URL(fileURLWithPath: "/Users/k/papers/issta/paper/main.pdf"))
        #expect(chat.attachments == ["../paper/tables/results.tex", "../paper/main.pdf"])
        chat.detach("../paper/main.pdf")
        chat.draft = "Use the numbers in this table."
        await chat.send()
        chat.draft = "And now?"
        await chat.send()
        let sent = await box.params
        // The first message is the fixture tests/rpc/claude/claude.send.request.attachments.json.
        #expect(sent.first == ClaudeProtocol.SendParams(text: "Use the numbers in this table.", attachments: ["../paper/tables/results.tex"], effort: .high))
        #expect(sent.last?.attachments == nil)
        #expect(chat.attachments.isEmpty)
        if case .user(_, let t) = chat.entries.first { #expect(t == "Use the numbers in this table.\n\nAttached: ../paper/tables/results.tex") }
    }
}

private actor SentBox {
    var params: [ClaudeProtocol.SendParams] = []
    func add(_ p: ClaudeProtocol.SendParams) { params.append(p) }
}
