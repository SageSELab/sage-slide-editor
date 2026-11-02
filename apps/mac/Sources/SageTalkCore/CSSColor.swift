import Foundation

/// The CSS colors a theme uses, as RGBA in 0...1 (sRGB), for color wells. Parses `#rgb`, `#rgba`,
/// `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (commas or spaces, `/ alpha`, percentages) and a few
/// names; formats back as `#rrggbb`, or `rgba(r, g, b, a)` when not opaque.
public struct CSSColor: Equatable, Hashable, Sendable {
    public var red: Double, green: Double, blue: Double, alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = Self.clamp(red); self.green = Self.clamp(green); self.blue = Self.clamp(blue); self.alpha = Self.clamp(alpha)
    }

    private static func clamp(_ v: Double) -> Double { min(1, max(0, v.isFinite ? v : 0)) }

    static let names: [String: String] = [
        "black": "#000000", "white": "#ffffff", "transparent": "#00000000", "red": "#ff0000", "green": "#008000",
        "blue": "#0000ff", "gray": "#808080", "grey": "#808080", "tomato": "#ff6347", "gold": "#ffd700", "orange": "#ffa500",
    ]

    public init?(css: String) {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        if let hex = Self.names[s] { self.init(css: hex); return }
        if s.hasPrefix("#") {
            var h = String(s.dropFirst())
            guard [3, 4, 6, 8].contains(h.count), h.allSatisfy(\.isHexDigit) else { return nil }
            if h.count <= 4 { h = h.map { "\($0)\($0)" }.joined() }
            if h.count == 6 { h += "ff" }
            let v = UInt64(h, radix: 16)!
            self.init(red: Double((v >> 24) & 0xff) / 255, green: Double((v >> 16) & 0xff) / 255,
                      blue: Double((v >> 8) & 0xff) / 255, alpha: Double(v & 0xff) / 255)
            return
        }
        guard s.hasPrefix("rgb"), let open = s.firstIndex(of: "("), s.hasSuffix(")") else { return nil }
        let inner = s[s.index(after: open)..<s.index(before: s.endIndex)]
        let parts = inner.replacingOccurrences(of: "/", with: " ").replacingOccurrences(of: ",", with: " ")
            .split(separator: " ").map(String.init)
        guard parts.count == 3 || parts.count == 4 else { return nil }
        func channel(_ p: String) -> Double? { p.hasSuffix("%") ? Double(p.dropLast()).map { $0 / 100 } : Double(p).map { $0 / 255 } }
        func alphaValue(_ p: String) -> Double? { p.hasSuffix("%") ? Double(p.dropLast()).map { $0 / 100 } : Double(p) }
        guard let r = channel(parts[0]), let g = channel(parts[1]), let b = channel(parts[2]) else { return nil }
        let a = parts.count == 4 ? alphaValue(parts[3]) : 1
        guard let a else { return nil }
        self.init(red: r, green: g, blue: b, alpha: a)
    }

    /// `#rrggbb` when opaque, else `rgba(r, g, b, a)` (alpha to 3 places).
    public var css: String {
        let r = Int((red * 255).rounded()), g = Int((green * 255).rounded()), b = Int((blue * 255).rounded())
        if alpha >= 0.9995 { return String(format: "#%02x%02x%02x", r, g, b) }
        let a = (alpha * 1000).rounded() / 1000
        let aText = a == a.rounded() ? String(Int(a)) : String(a)
        return "rgba(\(r), \(g), \(b), \(aText))"
    }

    /// Relative luminance (WCAG), for contrast checks.
    public var luminance: Double {
        func lin(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(red) + 0.7152 * lin(green) + 0.0722 * lin(blue)
    }

    /// WCAG contrast ratio of two opaque colors (1...21).
    public static func contrast(_ a: CSSColor, _ b: CSSColor) -> Double {
        let (x, y) = (a.luminance, b.luminance)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }
}
