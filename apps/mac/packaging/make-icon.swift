// make-icon.swift — draws the placeholder app icon into an .iconset folder (package.sh then runs
// iconutil). A rounded square with the stage's dark-to-blue gradient, a "play" triangle and
// three hold ticks: the film-with-checkpoints idea. Replace with a designed icon later.
//   swift packaging/make-icon.swift <out.iconset>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "AppIcon.iconset")
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data? {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let s = CGFloat(px)
    // macOS icon grid: the shape fills about 80 % of the canvas.
    let inset = s * 0.1, rect = NSRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
    let shape = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    NSGradient(starting: NSColor(calibratedRed: 0.07, green: 0.09, blue: 0.16, alpha: 1),
               ending: NSColor(calibratedRed: 0.13, green: 0.35, blue: 0.85, alpha: 1))?.draw(in: shape, angle: 70)
    // Play triangle.
    let c = NSPoint(x: rect.midX + rect.width * 0.03, y: rect.midY + rect.height * 0.06), r = rect.width * 0.24
    let tri = NSBezierPath()
    tri.move(to: NSPoint(x: c.x - r * 0.75, y: c.y + r))
    tri.line(to: NSPoint(x: c.x + r, y: c.y))
    tri.line(to: NSPoint(x: c.x - r * 0.75, y: c.y - r))
    tri.close()
    NSColor.white.setFill()
    tri.fill()
    // Timeline with three hold ticks.
    let y = rect.minY + rect.height * 0.2, x0 = rect.minX + rect.width * 0.18, x1 = rect.maxX - rect.width * 0.18
    let line = NSBezierPath()
    line.move(to: NSPoint(x: x0, y: y)); line.line(to: NSPoint(x: x1, y: y))
    line.lineWidth = max(1, s * 0.018); line.lineCapStyle = .round
    NSColor(white: 1, alpha: 0.55).setStroke(); line.stroke()
    for f in [0.2, 0.55, 0.8] {
        let d = max(2, s * 0.05), x = x0 + (x1 - x0) * f
        NSColor(calibratedRed: 1, green: 0.78, blue: 0.3, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: x - d / 2, y: y - d / 2, width: d, height: d)).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

for pt in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(pt)x\(pt).png" : "icon_\(pt)x\(pt)@2x.png"
        guard let png = draw(pt * scale) else { fatalError("could not draw \(name)") }
        try png.write(to: out.appendingPathComponent(name))
    }
}
print(out.path)
