import AppKit
import SageTalkCore
import WebKit

/// SAGE_SELFTEST=<dir> runs the app without taking focus, opens SAGE_OPEN, waits for the
/// engine to report its holds, seeks to a few of them, and writes:
///   holds.txt            the hold list the app received ("n time label")
///   canvas-<n>.png       the WKWebView snapshot at hold n
///   window.png           the whole window (navigator, canvas, inspector)
/// then quits. Used by scripts/selftest.sh and CI; never captures anything but its own window.
@MainActor
enum SelfTest {
    static var outDir: URL? {
        ProcessInfo.processInfo.environment["SAGE_SELFTEST"].map { URL(fileURLWithPath: $0, isDirectory: true) }
    }

    static func run(model: TalkWindowModel, out: URL) {
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        Task { @MainActor in
            for _ in 0..<200 where model.holds.isEmpty { try? await Task.sleep(for: .milliseconds(50)) }
            let lines = model.holds.map { "\($0.index) \(String(format: "%.1f", $0.at)) \($0.label)" }
            try? (lines.joined(separator: "\n") + "\n").write(to: out.appendingPathComponent("holds.txt"), atomically: true, encoding: .utf8)
            let picks = [1, 4, 8].filter { $0 <= model.holds.count }
            for n in picks {
                model.select(n)
                try? await Task.sleep(for: .milliseconds(400))
                if let img = try? await model.canvas.webView.takeSnapshot(configuration: nil) {
                    write(img, to: out.appendingPathComponent("canvas-\(n).png"))
                }
            }
            if let win = NSApp.windows.first(where: { $0.isVisible }), let view = win.contentView {
                if let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                    view.cacheDisplay(in: view.bounds, to: rep)
                    try? rep.representation(using: .png, properties: [:])?.write(to: out.appendingPathComponent("window.png"))
                }
            }
            print("selftest: \(model.holds.count) holds, error=\(model.error ?? "none")")
            quit()
        }
    }

    /// Quits from a run-loop callout rather than from this main-actor task, so terminate's
    /// nested run loop can still run main-actor work (the sidecar shutdown).
    static func quit() {
        RunLoop.main.perform { MainActor.assumeIsolated { NSApp.terminate(nil) } }
    }

    private static func write(_ image: NSImage, to url: URL) {
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: url)
    }
}
