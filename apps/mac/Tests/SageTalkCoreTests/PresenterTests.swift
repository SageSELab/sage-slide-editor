import Foundation
import Testing
@testable import SageTalkCore

@Suite struct PresenterStateTests {
    let holds = [
        Hold(index: 1, at: 5, label: "Title", notes: "Thank you."),
        Hold(index: 2, at: 13.5, label: "Fifteen years", notes: "One line."),
        Hold(index: 3, at: 20.5, label: "Measured", notes: "Benchmarks."),
    ]
    let t0 = Date(timeIntervalSinceReferenceDate: 1000)

    @Test func idleIgnoresKeys() {
        var s = PresenterState(holds: holds, duration: 21)
        #expect(s.press(.space, now: t0) == nil)
        #expect(s.end(now: t0).isEmpty)
    }

    @Test func presentStartsWithTheClockStoppedUntilTheFirstAdvance() {
        var s = PresenterState(holds: holds, duration: 21)
        #expect(s.start(.present, at: 0, now: t0) == [.seek(0)])
        #expect(s.mode == .present)
        #expect(s.elapsed(now: t0 + 30) == 0)
        #expect(s.press(.space, now: t0 + 10) == [.next])
        #expect(s.elapsed(now: t0 + 40) == 30)
        #expect(s.remaining(now: t0 + 40) == -9)
        // A second advance does not restart the clock.
        _ = s.press(.right, now: t0 + 20)
        #expect(s.clockStart == t0 + 10)
    }

    @Test func rehearseStartsTheClockAndPlaysThrough() {
        var s = PresenterState(holds: holds, duration: 21)
        #expect(s.start(.rehearse, at: 3, now: t0) == [.seek(3), .playThrough])
        #expect(s.elapsed(now: t0 + 5) == 5)
    }

    @Test func keysMapToFilmCommands() {
        var s = PresenterState(holds: holds, duration: 21)
        _ = s.start(.present, at: 0, now: t0)
        #expect(s.press(.left, now: t0) == [.previous])
        #expect(s.press(.enter, now: t0) == [.playThrough])
        #expect(s.clockStart == t0) // Enter also starts the talk
        #expect(s.press(.escape, now: t0 + 60) == [.close])
        #expect(s.phase == .ended)
        #expect(s.elapsed(now: t0 + 999) == 60) // the clock stops at the end
        #expect(s.press(.space, now: t0) == nil)
    }

    @Test func notesFollowTheHoldBeingTalkedTo() {
        var s = PresenterState(holds: holds, duration: 21)
        _ = s.start(.present, at: 0, now: t0)
        s.update(t: 0, playing: false)
        #expect(s.currentHold == nil)
        #expect(s.nextLabel == "Title")
        s.update(t: 2, playing: true)      // playing toward hold 1
        #expect(s.notes == "Thank you.")
        #expect(s.nextLabel == "Fifteen years")
        s.update(t: 5, playing: false)     // holding at hold 1
        #expect(s.notes == "Thank you.")
        #expect(s.positionLabel == "hold 1 / 3 · 0:05")
        s.update(t: 13.5, playing: false)
        #expect(s.notes == "One line.")
        s.update(t: 20.5, playing: false)
        #expect(s.nextHold == nil)
        #expect(s.nextLabel == "End")
    }

    @Test func targetDefaultsToTheDurationAndFollowsRebuilds() {
        var s = PresenterState(holds: holds, duration: 21)
        #expect(s.target == 21)
        s.replaceHolds(holds, duration: 30)
        #expect(s.target == 30)
        var fixed = PresenterState(holds: holds, duration: 21, target: 900)
        fixed.replaceHolds(holds, duration: 30)
        #expect(fixed.target == 900)
    }

    @Test func formatsAndKeyNames() {
        #expect(PresenterState.formatSigned(65) == "1:05")
        #expect(PresenterState.formatSigned(-9) == "-0:09")
        #expect(PresenterState.formatSigned(-0.5) == "-0:01")
        #expect(PresenterState.key(forDOMKey: " ") == .space)
        #expect(PresenterState.key(forDOMKey: "ArrowLeft") == .left)
        #expect(PresenterState.key(forDOMKey: "Escape") == .escape)
        #expect(PresenterState.key(forDOMKey: "x") == nil)
    }
}
