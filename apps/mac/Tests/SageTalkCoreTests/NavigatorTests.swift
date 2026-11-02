import Testing
@testable import SageTalkCore

@Suite struct NavigatorGroupingTests {
    let chapters = [
        ChapterInfo(id: "line", label: "The line", at: 0),
        ChapterInfo(id: "phone", label: "Inside the phone", at: 27.6),
        ChapterInfo(id: "omt", label: "One more thing", at: 240.9, dark: true),
        ChapterInfo(id: "backup", label: "Backup", at: 271.9, dark: true),
    ]

    @Test func groupsByChapterIdInChapterOrder() {
        let holds = [
            Hold(index: 1, at: 5, label: "Title", chapter: "line"),
            Hold(index: 2, at: 27.5, label: "Never", chapter: "line"),
            Hold(index: 3, at: 36, label: "Exploded", chapter: "phone"),
            Hold(index: 4, at: 250, label: "Claude", chapter: "omt"),
        ]
        let s = NavigatorGrouping.sections(holds: holds, chapters: chapters)
        #expect(s.map(\.id) == ["line", "phone", "omt"])
        #expect(s.map(\.title) == ["The line", "Inside the phone", "One more thing"])
        #expect(s.map { $0.holds.map(\.index) } == [[1, 2], [3], [4]])
        #expect(s.map(\.dark) == [false, false, true])
    }

    @Test func backupsGetTheirOwnFinalSection() {
        let holds = [
            Hold(index: 1, at: 5, label: "Title", chapter: "line"),
            Hold(index: 2, at: 280, label: "B1", backup: true, chapter: "backup"),
            Hold(index: 3, at: 290, label: "B2", backup: true, chapter: "backup"),
        ]
        let s = NavigatorGrouping.sections(holds: holds, chapters: chapters)
        #expect(s.map(\.id) == ["line", NavigatorSection.backupsID])
        #expect(s.last?.isBackup == true)
        #expect(s.last?.dark == true)
        #expect(s.last?.holds.map(\.label) == ["B1", "B2"])
    }

    @Test func legacyHoldsFallBackToChapterTimes() {
        // Legacy decks: no chapter ids on holds; markers sit 0.1 s after the previous hold.
        let legacy = chapters.map { ChapterInfo(id: "c\($0.at)", label: $0.label, at: $0.at) }
        let holds = [
            Hold(index: 1, at: 5, label: "Title"),
            Hold(index: 2, at: 27.5, label: "Never"),
            Hold(index: 3, at: 36, label: "Exploded"),
            Hold(index: 4, at: 300, label: "B", backup: true),
        ]
        let s = NavigatorGrouping.sections(holds: holds, chapters: legacy)
        #expect(s.map(\.title) == ["The line", "Inside the phone", "Backups"])
        #expect(s[0].holds.map(\.index) == [1, 2])
    }

    @Test func holdsWithoutChaptersFormOneSection() {
        let s = NavigatorGrouping.sections(holds: [Hold(index: 1, at: 1, label: "A"), Hold(index: 2, at: 2, label: "B")],
                                           chapters: [])
        #expect(s.count == 1)
        #expect(s[0].id == NavigatorSection.ungroupedID)
        #expect(s[0].holds.count == 2)
    }

    @Test func emptyChapterLabelsAreNumbered() {
        let s = NavigatorGrouping.sections(holds: [Hold(index: 1, at: 1, label: "A", chapter: "x")],
                                           chapters: [ChapterInfo(id: "x", label: "", at: 0)])
        #expect(s[0].title == "Chapter 1")
    }

    @Test func collapsedSectionsAreSkippedForKeyboardNavigation() {
        let holds = [
            Hold(index: 1, at: 5, label: "Title", chapter: "line"),
            Hold(index: 2, at: 36, label: "Exploded", chapter: "phone"),
            Hold(index: 3, at: 41, label: "Layout", chapter: "phone"),
        ]
        let s = NavigatorGrouping.sections(holds: holds, chapters: chapters)
        #expect(NavigatorGrouping.visibleHolds(s, collapsed: ["phone"]).map(\.index) == [1])
        #expect(NavigatorGrouping.section(containing: 3, in: s) == "phone")
    }
}
