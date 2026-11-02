import Foundation
import Testing
@testable import SageTalkCore

/// A fake sidecar for themes: records calls, writes theme.json for save/extract, returns an
/// inverse for apply and fonts.add.
actor FakeThemeService: ThemeService {
    typealias T = ThemeProtocol
    private(set) var calls: [String] = []
    var fail: RPCError?
    let catalog: [T.FontInfo] = [
        .init(id: "lora", family: "Lora", category: "serif", weights: [400, 500, 600, 700], styles: ["italic", "normal"]),
        .init(id: "inter", family: "Inter", category: "sans-serif", weights: [100, 200, 300, 400, 500, 600, 700, 800, 900]),
        .init(id: "jetbrains-mono", family: "JetBrains Mono", category: "monospace", weights: [100, 200, 300, 400, 500, 600, 700, 800]),
    ]
    func setFail(_ e: RPCError?) { fail = e }
    private func check() throws { if let e = fail { throw SidecarError.remote(e) } }

    static func edit(_ tag: String) -> SidecarProtocol.EditResult {
        .init(inverse: .init(patches: [.init(file: "theme.css", range: [0, 1], newText: tag)], digests: ["theme.css": String(repeating: "b", count: 64)]), changed: ["theme.css"])
    }

    func validateTheme(_ p: T.ValidateParams) async throws -> T.ValidateResult { calls.append("validate"); return .init(ok: true) }
    func saveTheme(_ p: T.SaveParams) async throws -> T.SaveResult {
        calls.append("save \(URL(fileURLWithPath: p.path).lastPathComponent)")
        try check()
        try FileManager.default.createDirectory(atPath: p.path, withIntermediateDirectories: true)
        try ThemeLibrary.write(p.theme, to: URL(fileURLWithPath: p.path))
        return .init(path: p.path, theme: p.theme)
    }
    func applyTheme(_ p: T.ApplyParams) async throws -> T.ApplyResult {
        calls.append("apply \(URL(fileURLWithPath: p.path).lastPathComponent)")
        try check()
        return .init(theme: try ThemeLibrary.read(URL(fileURLWithPath: p.path)), fonts: [], edit: Self.edit("theme-\(calls.count)"))
    }
    func extractTheme(_ p: T.ExtractParams) async throws -> T.ExtractResult {
        calls.append("extract \(p.name ?? "-")")
        let sage = try ThemeLibrary.read(ThemesModelTests.builtins.appendingPathComponent("sage.talktheme"))
        var t = sage
        t.id = p.id ?? "x"; t.name = p.name ?? "X"
        if let path = p.path {
            try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
            try ThemeLibrary.write(t, to: URL(fileURLWithPath: path))
        }
        return .init(theme: t, path: p.path)
    }
    func searchFonts(_ p: T.FontsSearchParams) async throws -> T.FontsSearchResult {
        calls.append("search \(p.query)")
        let q = p.query.lowercased()
        return .init(fonts: catalog.filter { (q.isEmpty || $0.family.lowercased().contains(q)) && (p.category == nil || $0.category == p.category) })
    }
    func addFont(_ p: T.FontsAddParams) async throws -> T.FontsAddResult {
        calls.append("add \(p.id) \(p.weights ?? [])")
        try check()
        return .init(family: "Lora", fontFamily: "Lora, Georgia, \"Times New Roman\", serif", files: ["assets/fonts/lora-latin-400-normal.woff2"], edit: Self.edit("font"))
    }
    func listFonts() async throws -> T.FontsListResult { .init(fonts: [.init(family: "Lora", id: "lora", weights: [400])]) }
}

@MainActor @Suite struct ThemesModelTests {
    nonisolated static let builtins = RPCFixtures.directory.deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("skill/academic-talk-film/assets/themes")

    func tempLibrary() -> ThemeLibrary {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("sage-themes-\(UUID().uuidString)")
        var lib = ThemeLibrary(userDirectory: dir, builtinDirectory: Self.builtins)
        lib.useTrash = false
        return lib
    }

    @Test func libraryListsBuiltinsFirstAndUserThemesShadowThem() throws {
        let lib = tempLibrary()
        #expect(lib.entries().map(\.id) == ["sage", "contrast", "paper", "slate"])
        #expect(lib.entries().allSatisfy { $0.builtin })
        // Import a built-in: same id is taken, so it arrives as paper-2 / "Paper 2".
        let e = try lib.importPackage(Self.builtins.appendingPathComponent("paper.talktheme"))
        #expect(e.id == "paper-2" && e.theme.name == "Paper 2" && !e.builtin)
        #expect(FileManager.default.fileExists(atPath: e.url.appendingPathComponent("fonts/fraunces-latin-700-normal.woff2").path))
        #expect(try ThemeLibrary.read(e.url).id == "paper-2")
        // Replacing keeps the id and shadows the built-in.
        let same = try lib.importPackage(Self.builtins.appendingPathComponent("slate.talktheme"), replace: true)
        #expect(same.id == "slate")
        #expect(lib.entries().filter { $0.id == "slate" }.map(\.builtin) == [false])
        let copy = try lib.duplicate(lib.entries().first { $0.id == "sage" }!)
        #expect(copy.id == "sage-copy" && copy.theme.name == "SAGE Copy")
        let sage = try #require(lib.entries().first { $0.id == "sage" })
        #expect(throws: ThemeLibrary.LibraryError.builtin("SAGE")) { try lib.delete(sage) }
        try lib.delete(copy)
        #expect(!lib.entries().contains { $0.id == "sage-copy" })
        #expect(ThemeLibrary.slug("Warm Paper (v2)") == "warm-paper-v2" && ThemeLibrary.slug("Élan") == "elan")
        #expect(throws: ThemeLibrary.LibraryError.self) { try lib.importPackage(lib.userDirectory) }
    }

    @Test func applyIsUndoableAndSavingGoesThroughTheSidecar() async throws {
        let fake = FakeThemeService(), edits = EditSession(service: FakeEditService())
        let m = ThemesModel(library: tempLibrary(), service: { fake }, edits: edits)
        let paper = try #require(m.entries.first { $0.id == "paper" })
        let r = await m.apply(paper)
        #expect(r?.theme.id == "paper")
        #expect(edits.undoTitle == "Undo Apply Theme “Paper”")
        #expect(m.appliedID == "paper" && m.status == "Applied “Paper”.")
        await edits.undo()
        #expect(edits.redoTitle == "Redo Apply Theme “Paper”")

        let saved = await m.saveCurrentTalk(named: "My Look")
        #expect(saved?.id == "my-look" && saved?.builtin == false && m.selectedID == "my-look")
        var draft = ThemeEditorDraft(try #require(saved).theme)
        draft.theme.name = "My Look 2"
        draft.setColor(.accent1, .light, "#ff0000")
        let again = await m.save(draft, over: try #require(saved))
        #expect(again?.theme.name == "My Look 2" && again?.id == "my-look")
        #expect(await fake.calls == ["apply paper.talktheme", "extract My Look", "save my-look.talktheme"])
        // Built-ins are not saved over.
        #expect(await m.save(draft, over: paper) == nil)
        #expect(m.error?.contains("built-in") == true)
    }

    @Test func failuresAndNoTalk() async throws {
        let fake = FakeThemeService()
        await fake.setFail(RPCError(code: ThemeProtocol.ErrorCode.themeInvalid, message: "light.bg: bad"))
        let m = ThemesModel(library: tempLibrary(), service: { fake })
        #expect(await m.apply(m.entries[0]) == nil)
        #expect(m.error == "Applying “SAGE”: light.bg: bad")
        let none = ThemesModel(library: tempLibrary())
        #expect(!none.canUseTalk)
        #expect(await none.apply(none.entries[0]) == nil)
        #expect(none.error?.contains("Open a talk first") == true)
    }

    @Test func draftColorsFontsAndContrast() throws {
        var d = ThemeEditorDraft(try ThemeLibrary.read(Self.builtins.appendingPathComponent("sage.talktheme")))
        #expect(d.color(.bg, .light) == "#ffffff" && d.color(.accent1, .dark) == "#0a84ff") // the dark accent inherits
        d.setColor(.accent1, .dark, "#0a84ff")
        #expect(d.theme.dark.accent1 == nil) // equal to light: stays inherited
        d.setColor(.accent1, .dark, "#00ff00")
        #expect(d.theme.dark.accent1 == "#00ff00")
        #expect(d.contrastWarnings.isEmpty == false) // SAGE's ink-3 captions are light grey
        d.setColor(.ink2, .light, "#eeeeee")
        #expect(d.contrastWarnings.contains { $0.hasPrefix("Slides: secondary text is") })
        let lora = ThemeProtocol.FontInfo(id: "lora", family: "Lora", category: "serif", weights: [400, 500, 600, 700])
        d.setGoogleFont(.display, lora)
        #expect(d.font(.display) == .init(family: "Lora", fallback: "Georgia, \"Times New Roman\", serif", source: .google, id: "lora", weights: [600, 700]))
        d.setGoogleFont(.mono, .init(id: "x", family: "X Mono", category: "monospace", weights: [300]))
        #expect(d.font(.mono).weights == [300])
    }

    @Test func cssColors() {
        #expect(CSSColor(css: "#fff")?.css == "#ffffff")
        #expect(CSSColor(css: "#0A84FF")?.css == "#0a84ff")
        #expect(CSSColor(css: "rgba(0, 0, 0, 0.12)")?.css == "rgba(0, 0, 0, 0.12)")
        #expect(CSSColor(css: "rgb(255 128 0 / 50%)")?.css == "rgba(255, 128, 0, 0.5)")
        #expect(CSSColor(css: "#00000080")?.css == "rgba(0, 0, 0, 0.502)")
        #expect(CSSColor(css: "black")?.css == "#000000")
        #expect(CSSColor(css: "color-mix(in srgb, red, blue)") == nil)
        #expect(CSSColor(css: "#12") == nil)
        let c = CSSColor.contrast(CSSColor(css: "#000")!, CSSColor(css: "#fff")!)
        #expect(abs(c - 21) < 0.01)
    }

    @Test func fontPickerAndEmbedder() async throws {
        let fake = FakeThemeService(), edits = EditSession(service: FakeEditService())
        let picker = FontPickerModel(service: { fake })
        await picker.run("", nil)
        #expect(picker.results.map(\.id) == ["lora", "inter", "jetbrains-mono"])
        picker.query = "lo"
        await picker.run("lo", nil)
        #expect(picker.results.map(\.id) == ["lora"])
        let embedder = FontEmbedder(service: fake, edits: edits)
        #expect(try await embedder.search("inter").map(\.family) == ["Inter"])
        let r = try await embedder.embed("lora", family: "Lora", weights: [400])
        #expect(r.fontFamily == "Lora, Georgia, \"Times New Roman\", serif")
        #expect(edits.undoTitle == "Undo Add Font “Lora”")
        #expect(try await embedder.embedded().map(\.family) == ["Lora"])
        await fake.setFail(RPCError(code: ThemeProtocol.ErrorCode.fontFailed, message: "Lora has no latin 100 normal"))
        await #expect(throws: SidecarError.self) { try await embedder.embed("lora", weights: [100]) }
        #expect(edits.lastError == "Lora has no latin 100 normal")
        #expect(FontEmbedder.weights(for: .body, of: .init(id: "a", family: "A", category: "sans-serif", weights: [400, 700])) == [400, 700])
    }
}
