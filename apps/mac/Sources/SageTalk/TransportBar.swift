import SageTalkCore
import SwiftUI

/// Under the canvas (PLAN 5.1): previous, play to next hold, play through, a scrubber with
/// chapter segments and hold ticks, and the hold and time labels.
struct TransportBar: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        let m = model.transport
        HStack(spacing: 10) {
            Button { model.prev() } label: { Image(systemName: "backward.end.fill") }
                .help("Previous hold (←)").accessibilityIdentifier("transport.previous")
            Button { model.next() } label: { Image(systemName: model.playing ? "forward.end.fill" : "play.fill") }
                .help(model.playing ? "Skip to the hold (→)" : "Play to the next hold (Space, →)")
                .accessibilityIdentifier("transport.next")
            Button { model.through() } label: { Image(systemName: model.playing ? "pause.fill" : "forward.fill") }
                .help(model.playing ? "Pause (Return)" : "Play through (Return)")
                .accessibilityIdentifier("transport.through")
            Scrubber(model: m, t: model.t) { model.scrub(to: $0) }
                .frame(height: 28)
            Text(m.holdLabel(at: model.t))
                .monospacedDigit().foregroundStyle(.secondary)
                .frame(minWidth: 52, alignment: .trailing)
            Text(m.timeLabel(at: model.t))
                .monospacedDigit()
                .frame(minWidth: 84, alignment: .trailing)
                .accessibilityIdentifier("transport.time")
        }
        .buttonStyle(.borderless)
        .font(.callout)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(.bar)
        .disabled(model.holds.isEmpty)
    }
}

private struct Scrubber: View {
    let model: TransportModel
    let t: Double
    let seek: (Double) -> Void
    @State private var hovering = false
    @State private var dragging = false

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let track: CGFloat = hovering || dragging ? 8 : 6, knob: CGFloat = hovering || dragging ? 16 : 13
            ZStack(alignment: .topLeading) {
                ForEach(model.segments) { s in
                    let x = s.x * w, sw = max(s.width * w - 2, 1)
                    ZStack(alignment: .leading) {
                        Capsule().fill(s.dark ? Color.purple.opacity(0.28) : Color.secondary.opacity(0.22))
                        Capsule().fill(s.dark ? Color.purple : Color.accentColor)
                            .frame(width: sw * model.fill(of: s, at: t))
                    }
                    .frame(width: sw, height: track)
                    .offset(x: x, y: h / 2 - track / 2)
                }
                ForEach(model.ticks) { tick in
                    Rectangle()
                        .fill(tick.backup ? Color.orange.opacity(0.7) : Color.primary.opacity(0.45))
                        .frame(width: 1, height: track + 6)
                        .offset(x: tick.x * w - 0.5, y: h / 2 - (track + 6) / 2)
                }
                Circle()
                    .fill(.white)
                    .shadow(radius: 1.5)
                    .overlay(Circle().strokeBorder(Color.secondary.opacity(0.4), lineWidth: 0.5))
                    .frame(width: knob, height: knob)
                    .offset(x: model.fraction(at: t) * w - knob / 2, y: h / 2 - knob / 2)
            }
            // The children are placed with offsets, which do not size the stack: without this
            // frame the clickable area was only as wide as one chapter and half the bar's height.
            .frame(width: w, height: h, alignment: .topLeading)
            .contentShape(Rectangle())
            .animation(.easeOut(duration: 0.12), value: hovering || dragging)
            .onHover { hovering = $0 }
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in
                    dragging = true
                    seek(model.time(atFraction: min(max(v.location.x / max(w, 1), 0), 1)))
                }
                .onEnded { _ in dragging = false })
            .help(model.segments.first(where: { s in
                let f = model.fraction(at: t); return f >= s.x && f <= s.x + s.width
            })?.label ?? "")
        }
        .accessibilityElement()
        .accessibilityLabel("Scrubber")
        .accessibilityValue(model.timeLabel(at: t))
        .accessibilityIdentifier("transport.scrubber")
    }
}
