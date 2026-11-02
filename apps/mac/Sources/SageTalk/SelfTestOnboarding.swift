import AppKit
import SageTalkCore
import SwiftUI

/// SAGE_SELFTEST, onboarding: runs the first-run checks against a real sidecar of their own
/// (the same one the app would use: bundled in a packaged app), including the Claude account
/// check, which starts the Claude CLI but never sends it a message. Never downloads the
/// browser. Writes
///   onboarding.txt   each step's status and detail, the mode, the browser and auth states
///   onboarding.png   the sheet, drawn off screen from its SwiftUI view
/// SAGE_SELFTEST_EXPECT_MODE=bundled|development makes the mode a checked expectation
/// (scripts/package-smoke.sh expects bundled).
extension SelfTest {
    static func onboarding(out: URL) async {
        let m = OnboardingModel()
        await m.run()
        let lines = m.steps.map { "\($0.kind.rawValue) \($0.status.rawValue): \($0.detail)" } + [
            "mode \(m.mode?.rawValue ?? "-")",
            "sidecar startup \(m.startupMs.map { "\($0) ms" } ?? "-")",
            "browser \(m.result?.browser.state.rawValue ?? "-") \(m.result?.browser.path ?? "")",
            "auth \(m.result?.auth?.state.rawValue ?? "-")",
            "talkc \(m.result?.talkc ?? "-")",
            "claude \(m.result?.claudeBinary ?? "-")",
        ]
        try? (lines.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("onboarding.txt"), atomically: true, encoding: .utf8)

        let step = { (k: OnboardingStepKind) in m.steps.first { $0.kind == k }! }
        check(step(.runtime).status == .ok, "onboarding: Node runtime (\(step(.runtime).detail))")
        check(step(.sidecar).status == .ok, "onboarding: sidecar started with nothing missing (\(step(.sidecar).detail))")
        if let want = ProcessInfo.processInfo.environment["SAGE_SELFTEST_EXPECT_MODE"] {
            check(m.mode?.rawValue == want && m.result?.mode.rawValue == want, "onboarding: the sidecar runs in \(want) mode (app \(m.mode?.rawValue ?? "-"), sidecar \(m.result?.mode.rawValue ?? "-"))")
        }
        // Signed in or not depends on the Mac; what matters is that the CLI answered.
        let auth = m.result?.auth?.state
        check(auth != nil && auth != .unknown, "onboarding: Claude auth state reported without a model call (\(auth?.rawValue ?? "none"): \(step(.claude).detail))")
        let browser = m.result?.browser
        check(browser != nil && (browser!.state != .missing || browser!.canInstall || m.mode != .bundled),
              "onboarding: render browser \(browser?.state.rawValue ?? "-")\(browser?.state == .missing ? ", offered for download" : "")")

        writeSheet(m, to: out.appendingPathComponent("onboarding.png"))
        await m.close()
    }

    /// Draws the sheet into a PNG in an off-screen window (never on screen).
    private static func writeSheet(_ m: OnboardingModel, to url: URL) {
        let host = NSHostingView(rootView: OnboardingSheet(model: m, onDone: {}).background(Color(nsColor: .windowBackgroundColor)))
        host.appearance = NSAppearance(named: .aqua)
        let size = host.fittingSize
        host.frame = NSRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -10_000, y: -10_000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        host.layoutSubtreeIfNeeded()
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: url)
        window.contentView = nil
    }
}
