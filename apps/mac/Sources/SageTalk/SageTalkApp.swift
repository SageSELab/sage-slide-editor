import AppKit
import SageTalkCore
import SwiftUI

@main
struct SageTalkApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var model = TalkWindowModel.shared

    var body: some Scene {
        Window("SAGE Talk", id: "talk") {
            TalkWindow(model: model)
                .frame(minWidth: 1100, minHeight: 680)
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Setup Assistant…") { model.presentOnboarding() }
            }
            CommandGroup(replacing: .newItem) {
                Button("New Talk…") { model.presentNewTalkPanel() }
                    .keyboardShortcut("n")
                Button("Open Talk…") { model.presentOpenPanel() }
                    .keyboardShortcut("o")
                Button("Reveal in Finder") { model.revealInFinder() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                    .disabled(model.talk == nil)
                Button("Convert to .talk Package…") { model.convertToPackage() }
                    .disabled(!model.canConvertToPackage)
            }
            // Publish and export (PLAN 5.6; TalkWindowModel+Publish.swift).
            CommandGroup(after: .newItem) {
                Divider()
                Button("Publish…") { model.showPublish() }
                    .keyboardShortcut("p", modifiers: [.command, .shift])
                    .disabled(!model.canPublish)
                Menu("Export") {
                    Button("PNGs of Holds…") { model.startExport(.png) }
                    Button("PDF of Holds…") { model.startExport(.pdf) }
                }
                .disabled(!model.canPublish || model.publishing.exporting)
            }
            // Undo/redo of the app's own edits (inverses kept by EditSession). A focused text
            // field, and canvas text with the caret in it, keep their own undo.
            CommandGroup(replacing: .undoRedo) {
                Button(model.textEditing != nil ? "Undo Typing" : model.edits.undoTitle) { model.undo() }
                    .keyboardShortcut("z")
                Button(model.textEditing != nil ? "Redo Typing" : model.edits.redoTitle) { model.redo() }
                    .keyboardShortcut("z", modifiers: [.command, .shift])
            }
            // Themes (TalkWindowModel+Themes.swift, ThemesView.swift).
            CommandMenu("Format") {
                ShowThemesButton().keyboardShortcut("t", modifiers: [.command, .option])
            }
            CommandMenu("Play") {
                Button("Present") { model.present(.present) }
                    .keyboardShortcut("p", modifiers: [.command, .option])
                    .disabled(model.holds.isEmpty || model.presentation.isPresenting)
                Button("Rehearse") { model.present(.rehearse) }
                    .keyboardShortcut("r", modifiers: [.command, .option])
                    .disabled(model.holds.isEmpty || model.presentation.isPresenting)
                Button("End Presentation") { model.presentation.end() }
                    .disabled(!model.presentation.isPresenting)
                Divider()
                // The keys go to the canvas first (nudge, text caret, commit); see nextKey().
                Button("Next Hold") { model.nextKey() }.keyboardShortcut(.rightArrow, modifiers: [])
                Button("Previous Hold") { model.prevKey() }.keyboardShortcut(.leftArrow, modifiers: [])
                Button("Play Through") { model.throughKey() }.keyboardShortcut(.return, modifiers: [])
            }
        }
        Window("Themes", id: "themes") {
            ThemesView(themes: AppThemes.model)
        }
        .defaultSize(width: 980, height: 640)
        Settings { SettingsView() }
    }
}

/// SwiftPM executables launch as background processes; make this one a regular foreground app.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // In self-test mode, stay in the background and never take focus from the user.
        if SelfTest.outDir == nil {
            NSApp.setActivationPolicy(.regular)
            NSApp.activate()
        } else {
            NSApp.setActivationPolicy(.accessory)
        }
        TalkWindowModel.shared.presentOnboardingIfNeeded()
        if let path = ProcessInfo.processInfo.environment["SAGE_OPEN"] ?? CommandLine.arguments.dropFirst().first(where: { !$0.hasPrefix("-") }) {
            NotificationCenter.default.post(name: .sageOpenPath, object: path)
        }
    }
    /// .talk packages, folders and talk.json files from Finder (double-click, Open With, a drop on
    /// the Dock icon).
    func application(_ application: NSApplication, open urls: [URL]) {
        if let url = urls.first { TalkWindowModel.shared.openDocument(url) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    /// Stops the sidecar before quitting (it would also exit on its own when stdin closes).
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let sup = TalkWindowModel.shared.supervisor else { return .terminateNow }
        // terminate() waits in a nested run loop, which may itself be running inside a main-queue
        // job (a MainActor task called it), so the reply must not need the main queue.
        Task.detached {
            await sup.shutdown()
            RunLoop.main.perform(inModes: [.common]) {
                MainActor.assumeIsolated { NSApp.reply(toApplicationShouldTerminate: true) }
            }
        }
        return .terminateLater
    }
}

extension Notification.Name {
    static let sageOpenPath = Notification.Name("sageOpenPath")
}
