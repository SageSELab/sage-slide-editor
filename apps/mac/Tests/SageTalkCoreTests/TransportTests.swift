import Testing
@testable import SageTalkCore

@Suite struct TransportTests {
    let holds = [
        Hold(index: 1, at: 5, label: "Title"),
        Hold(index: 2, at: 13.5, label: "Fifteen"),
        Hold(index: 3, at: 36, label: "Exploded"),
        Hold(index: 4, at: 90, label: "Backup", backup: true),
    ]
    let chapters = [
        ChapterInfo(id: "line", label: "The line", at: 0),
        ChapterInfo(id: "phone", label: "Inside the phone", at: 13.6, dark: true),
    ]

    @Test func timelineMatchesTheEngine() {
        let tl = HoldTimeline(holds: holds, duration: 100)
        #expect(tl.position(at: 0) == nil)
        #expect(tl.position(at: 4.99) == 0)          // within the 20 ms tolerance
        #expect(tl.position(at: 13.5) == 1)
        #expect(tl.next(after: 13.5)?.index == 3)
        #expect(tl.next(after: 13.49)?.index == 3)   // 13.5 already counts as reached
        #expect(tl.next(after: 90) == nil)
        #expect(tl.previousTarget(from: 13.5) == 5)  // ← from a hold goes to the one before
        #expect(tl.previousTarget(from: 20) == 13.5) // ← mid-beat goes back to its start hold
        #expect(tl.previousTarget(from: 3) == 0)
    }

    @Test func formatsLikeTheEngineClock() {
        #expect(HoldTimeline.format(0) == "0:00")
        #expect(HoldTimeline.format(65.9) == "1:05")
        #expect(HoldTimeline.format(343) == "5:43")
        #expect(HoldTimeline.format(-3) == "0:00")
    }

    @Test func segmentsCoverTheFilm() {
        let m = TransportModel(holds: holds, chapters: chapters, duration: 100)
        #expect(m.segments.map(\.id) == ["line", "phone"])
        #expect(m.segments[0].x == 0)
        #expect(abs(m.segments[0].width - 0.136) < 1e-9)
        #expect(abs(m.segments[1].x + m.segments[1].width - 1) < 1e-9)
        #expect(m.segments[1].dark)
        #expect(m.ticks.map(\.x) == [0.05, 0.135, 0.36, 0.9])
        #expect(m.ticks.last?.backup == true)
    }

    @Test func noChaptersIsOneSegment() {
        let m = TransportModel(holds: [], chapters: [], duration: 10)
        #expect(m.segments.count == 1)
        #expect(m.segments[0].width == 1)
    }

    @Test func scrubberMapsBothWaysAndClamps() {
        let m = TransportModel(holds: holds, chapters: chapters, duration: 100)
        #expect(m.time(atFraction: 0.25) == 25)
        #expect(m.time(atFraction: 1.5) == 100)
        #expect(m.fraction(at: -1) == 0)
        #expect(m.fill(of: m.segments[0], at: 6.8) == 0.5)
        #expect(m.fill(of: m.segments[1], at: 6.8) == 0)
    }

    @Test func labels() {
        let m = TransportModel(holds: holds, chapters: chapters, duration: 343)
        #expect(m.timeLabel(at: 65) == "1:05 / 5:43")
        #expect(m.holdLabel(at: 0) == "0 / 4")
        #expect(m.holdLabel(at: 36) == "3 / 4")
    }
}
