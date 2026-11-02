import Foundation

/// The state behind Present and Rehearse (PLAN 5.5). The app relays the audience film's
/// `{t, playing}` here; this decides what the presenter window shows and what each key does.
/// Plain Swift so it can be tested without windows or web views.
public struct PresenterState: Equatable, Sendable {
    public enum Mode: Equatable, Sendable { case present, rehearse }
    public enum Phase: Equatable, Sendable { case idle, running(Mode), ended }

    /// Keys that mean something while presenting, in both windows.
    public enum Key: Equatable, Sendable { case space, right, left, enter, escape }

    /// What the app must do to the film (and windows) in response.
    public enum Effect: Equatable, Sendable {
        case seek(Double)
        case next
        case previous
        case playThrough
        case close
    }

    public private(set) var phase: Phase = .idle
    public private(set) var timeline: HoldTimeline
    /// The talk length the clock counts down from (the film's duration unless set).
    public var target: Double
    public private(set) var t: Double = 0
    public private(set) var playing = false
    /// When the talk clock started; nil until the first advance in Present mode.
    public private(set) var clockStart: Date?
    public private(set) var endedAt: Date?

    public init(holds: [Hold], duration: Double, target: Double? = nil) {
        timeline = HoldTimeline(holds: holds, duration: duration)
        self.target = target ?? duration
    }

    public var isRunning: Bool { if case .running = phase { true } else { false } }
    public var mode: Mode? { if case .running(let m) = phase { m } else { nil } }

    // MARK: Inputs

    /// Starts presenting at film time `at`. Rehearse starts the clock at once and plays through.
    public mutating func start(_ mode: Mode, at: Double, now: Date) -> [Effect] {
        phase = .running(mode)
        t = at
        playing = false
        endedAt = nil
        clockStart = nil
        var fx: [Effect] = [.seek(at)]
        if mode == .rehearse {
            clockStart = now
            fx.append(.playThrough)
        }
        return fx
    }

    /// A key pressed in either window. Returns nil when the key is not ours (let it through).
    public mutating func press(_ key: Key, now: Date) -> [Effect]? {
        guard isRunning else { return nil }
        switch key {
        case .space, .right: startClock(now); return [.next]
        case .left: return [.previous]
        case .enter: startClock(now); return [.playThrough]
        case .escape: return end(now: now)
        }
    }

    /// Ends presenting (Esc, the menu item, or a closed window).
    public mutating func end(now: Date) -> [Effect] {
        guard isRunning else { return [] }
        phase = .ended
        endedAt = now
        playing = false
        return [.close]
    }

    /// The audience film's state, relayed by the app after every render.
    public mutating func update(t: Double, playing: Bool) {
        self.t = t
        self.playing = playing
    }

    /// A rebuilt film while presenting keeps the clock and position.
    public mutating func replaceHolds(_ holds: [Hold], duration: Double) {
        let keepTarget = target == timeline.duration
        timeline = HoldTimeline(holds: holds, duration: duration)
        if keepTarget { target = duration }
    }

    private mutating func startClock(_ now: Date) { if clockStart == nil { clockStart = now } }

    // MARK: What the presenter window shows

    /// The hold the speaker is talking to: while playing, the hold being played toward;
    /// while holding, the hold reached (talk.js presenter semantics).
    public var currentHold: Hold? {
        playing ? timeline.next(after: t) : timeline.current(at: t)
    }

    public var notes: String { currentHold?.notes ?? "" }

    /// The hold after the current one ("End" when there is none).
    public var nextHold: Hold? {
        guard let cur = currentHold, let i = timeline.holds.firstIndex(of: cur) else {
            return timeline.next(after: t)
        }
        return i + 1 < timeline.holds.count ? timeline.holds[i + 1] : nil
    }

    public var nextLabel: String { nextHold.map { $0.label.isEmpty ? "Hold \($0.index)" : $0.label } ?? "End" }

    public var positionLabel: String {
        "hold \((timeline.position(at: t) ?? -1) + 1) / \(timeline.holds.count) · \(HoldTimeline.format(t))"
    }

    public func elapsed(now: Date) -> TimeInterval {
        guard let s = clockStart else { return 0 }
        return max(0, (endedAt ?? now).timeIntervalSince(s))
    }

    /// Negative once the talk runs over.
    public func remaining(now: Date) -> TimeInterval { target - elapsed(now: now) }

    /// "-0:12" when over time.
    public static func formatSigned(_ s: TimeInterval) -> String {
        s < 0 ? "-" + HoldTimeline.format(-s + 0.999) : HoldTimeline.format(s)
    }

    /// Maps the engine's key names (`KeyboardEvent.key`) to presenter keys.
    public static func key(forDOMKey k: String) -> Key? {
        switch k {
        case " ": .space
        case "ArrowRight", "PageDown": .right
        case "ArrowLeft", "PageUp": .left
        case "Enter": .enter
        case "Escape": .escape
        default: nil
        }
    }
}
