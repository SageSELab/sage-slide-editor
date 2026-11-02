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
                .frame(height: 22)
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

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .topLeading) {
                ForEach(model.segments) { s in
                    let x = s.x * w, sw = max(s.width * w - 2, 1)
                    ZStack(alignment: .leading) {
                        Capsule().fill(s.dark ? Color.purple.opacity(0.28) : Color.secondary.opacity(0.22))
                        Capsule().fill(s.dark ? Color.purple : Color.accentColor)
                            .frame(width: sw * model.fill(of: s, at: t))
                    }
                    .frame(width: sw, height: 6)
                    .offset(x: x, y: h / 2 - 3)
                    .help(s.label)
                }
                ForEach(model.ticks) { tick in
                    Rectangle()
                        .fill(tick.backup ? Color.orange.opacity(0.7) : Color.primary.opacity(0.45))
                        .frame(width: 1, height: 12)
                        .offset(x: tick.x * w - 0.5, y: h / 2 - 6)
                }
                Circle()
                    .fill(.white)
                    .shadow(radius: 1.5)
                    .overlay(Circle().strokeBorder(Color.secondary.opacity(0.4), lineWidth: 0.5))
                    .frame(width: 12, height: 12)
                    .offset(x: model.fraction(at: t) * w - 6, y: h / 2 - 6)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                seek(model.time(atFraction: v.location.x / max(w, 1)))
            })
        }
        .accessibilityElement()
        .accessibilityLabel("Scrubber")
        .accessibilityValue(model.timeLabel(at: t))
        .accessibilityIdentifier("transport.scrubber")
    }
}
