import Foundation

/// Which screen the audience film and the presenter window go on (PLAN 5.5). Pure logic over a
/// list of displays so it is testable without hardware; PresentationController feeds it
/// NSScreen.screens and applies the result.
public enum DisplayAssignment {
    /// A connected display. `id` is the CGDirectDisplayID (stable while connected, and usually
    /// across reconnects); `name` the localized name, used when the id changed.
    public struct Display: Equatable, Sendable {
        public var id: UInt32
        public var name: String
        /// The display with the menu bar.
        public var isMain: Bool
        public init(id: UInt32, name: String, isMain: Bool) { self.id = id; self.name = name; self.isMain = isMain }
    }

    /// A remembered choice; nil means Automatic.
    public struct Choice: Codable, Equatable, Hashable, Sendable {
        public var id: UInt32
        public var name: String
        public init(id: UInt32, name: String) { self.id = id; self.name = name }
        public init(_ d: Display) { self.init(id: d.id, name: d.name) }
    }

    /// Where each window goes, as indices into the displays.
    public struct Placement: Equatable, Sendable {
        public var audience: Int
        public var presenter: Int
        /// Both on one display: the presenter waits behind the film (⌘` / Swap brings it up).
        public var shared: Bool { audience == presenter }
    }

    /// The display a choice names: the same id, else (reconnected under a new id) the only one
    /// with that name. Nil when it is not connected.
    public static func find(_ choice: Choice?, in displays: [Display]) -> Int? {
        guard let choice else { return nil }
        if let i = displays.firstIndex(where: { $0.id == choice.id }) { return i }
        let named = displays.indices.filter { displays[$0].name == choice.name }
        return named.count == 1 ? named[0] : nil
    }

    /// Automatic: the film on the first display without the menu bar (a projector), the
    /// presenter on the main one; with one display both share it. A chosen display that is not
    /// connected counts as Automatic. Choosing only one side puts the other on a different
    /// display when there is one.
    public static func place(_ displays: [Display], audience: Choice?, presenter: Choice?) -> Placement? {
        guard !displays.isEmpty else { return nil }
        let main = displays.firstIndex(where: \.isMain) ?? 0
        let other = { (i: Int) in displays.indices.first(where: { $0 != i && $0 != main }) ?? displays.indices.first(where: { $0 != i }) }
        let a = find(audience, in: displays), p = find(presenter, in: displays)
        switch (a, p) {
        case let (a?, p?): return Placement(audience: a, presenter: p)
        case let (a?, nil): return Placement(audience: a, presenter: a == main ? (other(a) ?? a) : main)
        case let (nil, p?): return Placement(audience: other(p) ?? p, presenter: p)
        case (nil, nil):
            let external = displays.indices.first(where: { $0 != main })
            return Placement(audience: external ?? main, presenter: main)
        }
    }

    /// The choices that swap the current placement (both made explicit).
    public static func swapped(_ displays: [Display], _ placement: Placement) -> (audience: Choice, presenter: Choice) {
        (Choice(displays[placement.presenter]), Choice(displays[placement.audience]))
    }
}
