import AppKit
import SageTalkCore
import SwiftUI

@main
struct SageTalkApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @State private var model = TalkWindowModel()

    var body: some Scene {
        Window("SAGE Talk", id: "talk") {
            TalkWindow(model: model)
                .frame(minWidth: 1100, minHeight: 680)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Open Talk…") { model.presentOpenPanel() }
                    .keyboardShortcut("o")
            }
            CommandMenu("Play") {
                Button("Next Hold") { model.canvas.next() }.keyboardShortcut(.rightArrow, modifiers: [])
                Button("Previous Hold") { model.canvas.prev() }.keyboardShortcut(.leftArrow, modifiers: [])
                Button("Play Through") { model.canvas.through() }.keyboardShortcut(.return, modifiers: [])
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
}

extension Notification.Name {
    static let sageOpenPath = Notification.Name("sageOpenPath")
}
