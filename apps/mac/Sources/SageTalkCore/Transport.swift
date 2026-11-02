import Foundation

/// Hold arithmetic that matches talk.js exactly (`cpIndex`, `nextCp`, `fmt`), so the native
/// transport and presenter agree with the engine about which hold the film is on.
public struct HoldTimeline: Equatable, Sendable {
    /// The engine's tolerance: a hold counts as reached 20 ms early.
    public static let epsilon = 0.02

    public var holds: [Hold]
    public var duration: Double

    public init(holds: [Hold], duration: Double) {
        self.holds = holds.sorted { $0.at < $1.at }
        self.duration = duration
    }

    /// Position (0-based) of the hold at or before `t`; nil before the first hold.
    public func position(at t: Double) -> Int? {
        holds.lastIndex(where: { $0.at <= t + Self.epsilon })
    }

    public func current(at t: Double) -> Hold? { position(at: t).map { holds[$0] } }

    /// The first hold strictly after `t`.
    public func next(after t: Double) -> Hold? { holds.first(where: { $0.at > t + Self.epsilon }) }

    /// Where ← goes: the hold before the one just passed (talk.js `prev`), or 0.
    public func previousTarget(from t: Double) -> Double {
        position(at: t - 0.05).map { holds[$0].at } ?? 0
    }

    /// "m:ss", floored, like the engine's clock.
    public static func format(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.isFinite ? seconds.rounded(.down) : 0))
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }
}

/// What the transport bar under the canvas draws (PLAN 5.1): chapter segments and hold ticks on
/// a scrubber, and the time and hold labels.
public struct TransportModel: Equatable, Sendable {
    public struct Segment: Equatable, Sendable, Identifiable {
        public var id: String
        public var label: String
        public var start: Double
        public var end: Double
        public var dark: Bool
        /// Left edge and width as fractions of the duration.
        public var x: Double
        public var width: Double
    }

    public struct Tick: Equatable, Sendable, Identifiable {
        public var id: Int { hold }
        public var hold: Int
        public var x: Double
        public var backup: Bool
    }

    public var timeline: HoldTimeline
    public var segments: [Segment]
    public var ticks: [Tick]

    public var duration: Double { timeline.duration }

    public init(holds: [Hold], chapters: [ChapterInfo], duration: Double) {
        let d = max(duration, 0.001)
        timeline = HoldTimeline(holds: holds, duration: duration)
        let chs = chapters.sorted { $0.at < $1.at }
        let marks = chs.isEmpty ? [ChapterInfo(id: "all", label: "", at: 0)] : chs
        segments = marks.enumerated().map { i, c in
            let start = min(max(c.at, 0), d)
            let end = i + 1 < marks.count ? min(max(marks[i + 1].at, start), d) : d
            return Segment(id: c.id, label: c.label, start: start, end: end, dark: c.dark, x: start / d, width: (end - start) / d)
        }
        ticks = timeline.holds.map { Tick(hold: $0.index, x: min(max($0.at / d, 0), 1), backup: $0.backup) }
    }

    /// Scrubber fraction for a time, clamped to 0...1.
    public func fraction(at t: Double) -> Double { duration > 0 ? min(max(t / duration, 0), 1) : 0 }

    /// Time for a scrubber fraction, clamped to the film.
    public func time(atFraction f: Double) -> Double { min(max(f, 0), 1) * duration }

    /// Fill of a segment (0...1) at time t, as the engine's own chapter bar draws it.
    public func fill(of segment: Segment, at t: Double) -> Double {
        let len = segment.end - segment.start
        return len > 0 ? min(max((t - segment.start) / len, 0), 1) : (t >= segment.start ? 1 : 0)
    }

    /// "1:05 / 5:43"
    public func timeLabel(at t: Double) -> String {
        HoldTimeline.format(t) + " / " + HoldTimeline.format(duration)
    }

    /// "12 / 61" (0 before the first hold), like the engine's hold counter.
    public func holdLabel(at t: Double) -> String {
        "\((timeline.position(at: t) ?? -1) + 1) / \(timeline.holds.count)"
    }
}
