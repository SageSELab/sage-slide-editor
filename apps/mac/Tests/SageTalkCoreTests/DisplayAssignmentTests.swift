import Testing
@testable import SageTalkCore

struct DisplayAssignmentTests {
    typealias D = DisplayAssignment
    let laptop = D.Display(id: 1, name: "Built-in Retina Display", isMain: true)
    let projector = D.Display(id: 7, name: "EPSON PJ", isMain: false)
    let monitor = D.Display(id: 9, name: "LG UltraFine", isMain: false)

    @Test func automaticPutsTheFilmOnTheExternalDisplay() {
        #expect(D.place([laptop], audience: nil, presenter: nil) == .init(audience: 0, presenter: 0))
        #expect(D.place([laptop], audience: nil, presenter: nil)?.shared == true)
        #expect(D.place([laptop, projector], audience: nil, presenter: nil) == .init(audience: 1, presenter: 0))
        #expect(D.place([], audience: nil, presenter: nil) == nil)
    }

    @Test func explicitChoicesWin() {
        let three = [laptop, projector, monitor]
        #expect(D.place(three, audience: .init(monitor), presenter: .init(projector)) == .init(audience: 2, presenter: 1))
        // Film on the laptop: the presenter moves to an external display.
        #expect(D.place(three, audience: .init(laptop), presenter: nil) == .init(audience: 0, presenter: 1))
        // Presenter on the projector: the film takes a display that is neither it nor the main one.
        #expect(D.place(three, audience: nil, presenter: .init(projector)) == .init(audience: 2, presenter: 1))
        // Both on one display is allowed (the presenter waits behind the film).
        #expect(D.place(three, audience: .init(projector), presenter: .init(projector))?.shared == true)
    }

    @Test func aMissingDisplayFallsBackToAutomatic() {
        #expect(D.place([laptop], audience: .init(projector), presenter: nil) == .init(audience: 0, presenter: 0))
        // Reconnected under a new id: found by name.
        let back = D.Display(id: 42, name: "EPSON PJ", isMain: false)
        #expect(D.place([laptop, monitor, back], audience: .init(projector), presenter: nil) == .init(audience: 2, presenter: 0))
        // Two displays with that name: ambiguous, so automatic.
        let twin = D.Display(id: 43, name: "EPSON PJ", isMain: false)
        #expect(D.find(.init(projector), in: [laptop, back, twin]) == nil)
    }

    @Test func swapExchangesTheDisplays() {
        let ds = [laptop, projector]
        let p = D.place(ds, audience: nil, presenter: nil)!
        let s = D.swapped(ds, p)
        #expect(D.place(ds, audience: s.audience, presenter: s.presenter) == .init(audience: 0, presenter: 1))
    }
}
