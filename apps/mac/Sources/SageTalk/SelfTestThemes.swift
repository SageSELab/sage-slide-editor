import AppKit
import SageTalkCore
import SwiftUI

/// SAGE_SELFTEST, themes on a temp copy of the talk, with a temp theme library (never the
/// user's): applies the built-in Paper theme through the Themes model, checks theme.css, the
/// embedded fonts and the reloaded canvas, saves the talk's look as a library theme, then undoes
/// the theme and checks theme.css is byte-identical. Writes
///   themes-canvas.png   the canvas with Paper applied
///   themes-window.png   the Themes window, drawn off screen from its SwiftUI view
///   theme-editor.png    the theme editor for the saved theme
///   themes.txt          what each step returned
extension SelfTest {
    static func themes(model: TalkWindowModel, source: URL, out: URL) async {
        let fm = FileManager.default
        let base = fm.temporaryDirectory.appendingPathComponent("sage-selftest-themes-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: base) }
        let copy = base.appendingPathComponent("talk")
        guard (try? fm.createDirectory(at: base, withIntermediateDirectories: true)) != nil,
              (try? fm.copyItem(at: source, to: copy)) != nil else { check(false, "themes: copy the talk"); return }
        try? fm.removeItem(at: copy.appendingPathComponent(".sage"))
        try? fm.removeItem(at: copy.appendingPathComponent("build"))
        var log: [String] = []
        defer { try? (log.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("themes.txt"), atomically: true, encoding: .utf8) }

        let themes = AppThemes.model
        let savedLibrary = themes.library
        defer { themes.library = savedLibrary; themes.reload() }
        var lib = ThemeLibrary(userDirectory: base.appendingPathComponent("Themes"), builtinDirectory: ThemeLibrary.builtins())
        lib.useTrash = false
        themes.library = lib
        themes.reload()
        check(themes.entries.map(\.id).starts(with: ["sage"]) && themes.entries.count >= 4, "themes: the library lists the built-ins (\(themes.entries.map(\.id)))")

        model.open(copy)
        let opened = await waitFor(seconds: 60) { model.canvas.info != nil && !model.holds.isEmpty && model.talk?.root == copy.standardizedFileURL && themes.canUseTalk }
        check(opened, "themes: temp copy opened")
        guard opened, let paper = themes.entries.first(where: { $0.id == "paper" }) else { return }
        let cssURL = copy.appendingPathComponent("theme.css")
        let before = (try? Data(contentsOf: cssURL)) ?? Data()
        let display = "return getComputedStyle(document.documentElement).getPropertyValue('--display')"

        // Apply Paper.
        let reloads = model.reloads, ready = model.canvas.readyCount
        let r = await themes.apply(paper)
        log.append("apply: changed \(r?.edit.changed ?? []), ok \(r?.edit.ok ?? false), status \(themes.status ?? themes.error ?? "-")")
        check(r?.edit.ok == true && r?.fonts.count == 8, "themes: Paper applied and the talk rebuilt (\(themes.error ?? "ok"))")
        let css = (try? String(contentsOf: cssURL, encoding: .utf8)) ?? ""
        check(css.hasPrefix("/* sage-fonts:begin") && css.contains("--display: Fraunces") && css.hasSuffix(String(decoding: before, as: UTF8.self)),
              "themes: theme.css gained the generated blocks on top and kept the talk's own rules")
        let fonts = (try? fm.contentsOfDirectory(atPath: copy.appendingPathComponent("assets/fonts").path)) ?? []
        check(fonts.count == 8, "themes: 8 woff2 files embedded in assets/fonts")
        check(model.edits.undoTitle == "Undo Apply Theme “Paper”", "themes: Edit ▸ \(model.edits.undoTitle)")
        let reloaded = await waitFor(seconds: 30) { model.reloads > reloads && model.canvas.readyCount > ready }
        check(reloaded, "themes: the canvas reloaded after applying")
        try? await Task.sleep(for: .milliseconds(400))
        let shown = (try? await model.canvas.call(display, [:]) as? String) ?? ""
        let loaded = (try? await model.canvas.call("await document.fonts.ready; return document.fonts.check('700 60px Fraunces')", [:]) as? Bool) ?? false
        log.append("canvas --display: \(shown); Fraunces loaded: \(loaded)")
        check(shown.contains("Fraunces") && loaded, "themes: the canvas uses the theme's embedded display font")
        if let img = try? await model.canvas.snapshot(width: 960) { write(img, to: out.appendingPathComponent("themes-canvas.png")) }

        // Save the talk's look into the (temp) library.
        let saved = await themes.saveCurrentTalk(named: "Selftest Look")
        log.append("saved: \(saved?.url.path ?? themes.error ?? "-")")
        check(saved?.theme.fonts.display.family == "Fraunces" && saved.map { fm.fileExists(atPath: $0.url.appendingPathComponent("fonts/fraunces-latin-700-normal.woff2").path) } == true,
              "themes: Save Current Talk's Theme wrote a package with its fonts")
        renderView(ThemesView(themes: themes), size: NSSize(width: 980, height: 640), to: out.appendingPathComponent("themes-window.png"), appearance: .aqua)
        if let saved {
            renderView(ThemeEditorView(themes: themes, entry: saved, done: {}), size: NSSize(width: 560, height: 720), to: out.appendingPathComponent("theme-editor.png"), appearance: .aqua)
        }

        // Undo.
        let reloads2 = model.reloads
        _ = await model.undoNow()
        let after = (try? Data(contentsOf: cssURL)) ?? Data()
        check(after == before, "themes: undo restored theme.css byte for byte")
        _ = await waitFor(seconds: 30) { model.reloads > reloads2 }
        try? await Task.sleep(for: .milliseconds(400))
        let back = (try? await model.canvas.call(display, [:]) as? String) ?? ""
        log.append("after undo --display: \(back)")
        check(back.contains("Manrope"), "themes: after undo the canvas is back to Manrope")
    }
}
