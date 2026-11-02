// make-icon.swift — renders packaging/AppIcon.svg (the SAGE Lab leaf on a slide stack) into an
// .iconset folder at every macOS size; package.sh then runs iconutil. The SVG is full-bleed, so
// it is inset to the macOS icon grid (the shape fills about 80 % of the canvas) with a soft shadow.
//   swift packaging/make-icon.swift <out.iconset> [AppIcon.svg]
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
let out = URL(fileURLWithPath: args.first ?? "AppIcon.iconset")
let svgPath = args.count > 1 ? args[1]
    : URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("AppIcon.svg").path
guard let art = NSImage(contentsOfFile: svgPath), art.isValid else { fatalError("cannot load \(svgPath)") }
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data? {
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                     bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    let ctx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = ctx
    ctx.imageInterpolation = .high
    let s = CGFloat(px), inset = s * 0.1
    let rect = NSRect(x: inset, y: inset * 1.15, width: s - 2 * inset, height: s - 2 * inset)
    if px >= 64 {
        let shadow = NSShadow()
        shadow.shadowColor = NSColor(white: 0, alpha: 0.28)
        shadow.shadowBlurRadius = s * 0.02
        shadow.shadowOffset = NSSize(width: 0, height: -s * 0.01)
        shadow.set()
    }
    art.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
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
