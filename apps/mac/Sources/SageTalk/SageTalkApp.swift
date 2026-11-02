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
            CommandGroup(replacing: .newItem) {
                Button("Open Talk…") { model.presentOpenPanel() }
                    .keyboardShortcut("o")
                Button("Reveal in Finder") { model.revealInFinder() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                    .disabled(model.talk == nil)
            }
            CommandMenu("Play") {
                Button("Next Hold") { model.next() }.keyboardShortcut(.rightArrow, modifiers: [])
                Button("Previous Hold") { model.prev() }.keyboardShortcut(.leftArrow, modifiers: [])
                Button("Play Through") { model.through() }.keyboardShortcut(.return, modifiers: [])
            }
        }
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
        if let path = ProcessInfo.processInfo.environment["SAGE_OPEN"] ?? CommandLine.arguments.dropFirst().first(where: { !$0.hasPrefix("-") }) {
            NotificationCenter.default.post(name: .sageOpenPath, object: path)
        }
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
