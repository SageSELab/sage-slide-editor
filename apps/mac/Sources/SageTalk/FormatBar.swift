import AppKit
import SageTalkCore
import SwiftUI

/// The small floating bar over the selected text object on the canvas (Keynote-style): bold,
/// italic, underline, text colour, font size, alignment and the font. While the caret is in
/// the text with a range selected, B/I/U and colour apply to that range in place; otherwise
/// every control changes the whole object (TalkWindowModel.format).
struct FormatBar: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        if let o = model.formatTarget {
            HStack(spacing: 8) {
                TextStyleToggles(model: model)
                bar
                TextColorWell(model: model)
                bar
                FontSizeField(model: model, object: o)
                bar
                AlignmentPicker(model: model, object: o)
                bar
                FontButton(model: model, object: o, compact: true)
            }
            .controlSize(.small)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color(nsColor: .windowBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Color.primary.opacity(0.14)))
            .shadow(color: .black.opacity(0.22), radius: 8, y: 3)
            .padding(10) // room for the shadow inside the hosting view
            .fixedSize()
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("canvas.format-bar")
        }
    }

    private var bar: some View { Divider().frame(height: 16) }
}

/// Bold, italic and underline toggles (the format bar and the inspector's Text section).
struct TextStyleToggles: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        let s = model.formatState
        HStack(spacing: 2) {
            toggle("bold", s.bold, .bold, "Bold (⌘B)", "format.bold")
            toggle("italic", s.italic, .italic, "Italic (⌘I)", "format.italic")
            toggle("underline", s.underline, .underline, "Underline (⌘U)", "format.underline")
        }
    }

    private func toggle(_ symbol: String, _ on: Bool, _ f: CanvasFormat, _ help: String, _ id: String) -> some View {
        Toggle(isOn: Binding(get: { on }, set: { _ in model.format(f) })) {
            Image(systemName: symbol).frame(width: 14)
        }
        .toggleStyle(.button)
        .help(help)
        .accessibilityLabel(help)
        .accessibilityIdentifier(id)
    }
}

/// The text colour well: the selected range's colour while editing one, else the object's.
struct TextColorWell: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        ColorPicker("Text colour", selection: Binding(
            get: { Color(nsColor: NSColor(cssHex: model.formatState.color) ?? .white) },
            set: { model.formatColor(NSColor($0).cssHex) }
        ), supportsOpacity: false)
        .labelsHidden()
        .help("Text colour")
        .accessibilityIdentifier("format.color")
    }
}

/// The font size in px: type a size (Return) or step it.
struct FontSizeField: View {
    @Bindable var model: TalkWindowModel
    let object: CanvasObject
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 2) {
            TextField("Size", text: $text)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(width: 42)
                .focused($focused)
                .onSubmit(send)
                .accessibilityIdentifier("format.size")
            Stepper("Font size", onIncrement: { step(+1) }, onDecrement: { step(-1) })
                .labelsHidden()
        }
        .help("Font size (px)")
        .onAppear { text = InspectorFormat.number(object.fontSize) }
        .onChange(of: object.fontSize) { _, v in text = InspectorFormat.number(v) }
        .onChange(of: focused) { _, f in if !f { send() } }
    }

    private func send() {
        guard let v = InspectorFormat.parse(text), v > 0 else { text = InspectorFormat.number(object.fontSize); return }
        if abs(v - object.fontSize) > 1e-9 { model.format(.fontSize(v)) }
    }

    /// Whole px, by 2 below 40 px and by 4 above (headline sizes move in bigger steps).
    private func step(_ dir: Double) {
        let cur = InspectorFormat.parse(text) ?? object.fontSize
        let by: Double = cur >= 40 ? 4 : 2
        let next = max(1, (cur / by).rounded(dir > 0 ? .down : .up) * by + dir * by)
        text = InspectorFormat.number(next)
        model.format(.fontSize(next))
    }
}

/// Left, centre, right alignment of the whole object.
struct AlignmentPicker: View {
    @Bindable var model: TalkWindowModel
    let object: CanvasObject

    var body: some View {
        Picker("Alignment", selection: Binding(
            get: { object.text?.align ?? "left" },
            set: { model.format(.align($0)) }
        )) {
            Image(systemName: "text.alignleft").help("Align left").tag("left")
            Image(systemName: "text.aligncenter").help("Centre").tag("center")
            Image(systemName: "text.alignright").help("Align right").tag("right")
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        .accessibilityIdentifier("format.align")
    }
}

/// The font: the object's family, and the hook to a font picker (TalkWindowModel.pickFont).
struct FontButton: View {
    @Bindable var model: TalkWindowModel
    let object: CanvasObject
    var compact = false

    var body: some View {
        Button { model.pickFont(for: object) } label: {
            HStack(spacing: 4) {
                Image(systemName: "textformat")
                Text(Self.primaryFamily(object.text?.family ?? "")).lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: compact ? 96 : 140, alignment: .leading)
            }
        }
        .disabled(!model.canPickFont)
        .help(model.canPickFont ? "Choose a font" : "Font: \(object.text?.family ?? "") (a font picker is coming)")
        .accessibilityIdentifier("format.font")
    }

    /// "Manrope" from `"Manrope", system-ui, sans-serif`.
    static func primaryFamily(_ css: String) -> String {
        let first = css.split(separator: ",").first.map(String.init) ?? css
        let name = first.trimmingCharacters(in: CharacterSet(charactersIn: " \"'"))
        return name.isEmpty ? "Font" : name
    }
}

extension NSColor {
    /// "#rrggbb" (a leading # optional), nil for anything else.
    convenience init?(cssHex: String) {
        var s = cssHex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
    }

    /// "#rrggbb" in sRGB.
    var cssHex: String {
        let c = usingColorSpace(.sRGB) ?? self
        let v = [c.redComponent, c.greenComponent, c.blueComponent].map { Int(($0 * 255).rounded()).clamped(to: 0...255) }
        return String(format: "#%02x%02x%02x", v[0], v[1], v[2])
    }
}

private extension Comparable {
    func clamped(to r: ClosedRange<Self>) -> Self { min(max(self, r.lowerBound), r.upperBound) }
}
