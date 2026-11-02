import Foundation

/// A chapter as the engine reports it (`T.chapters`): beat-format talks carry `id` and `dark`,
/// legacy decks only `at` and `label`.
public struct ChapterInfo: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var at: Double
    public var dark: Bool
    public init(id: String, label: String, at: Double, dark: Bool = false) {
        self.id = id; self.label = label; self.at = at; self.dark = dark
    }
}

/// One collapsible group in the navigator (PLAN 5.2).
public struct NavigatorSection: Identifiable, Equatable, Sendable {
    public static let backupsID = "__backups"
    public static let ungroupedID = "__talk"

    public var id: String
    public var title: String
    public var dark: Bool
    public var isBackup: Bool
    public var holds: [Hold]
}

public enum NavigatorGrouping {
    /// Groups holds by chapter, in chapter order, with every backup hold moved to a final
    /// "Backups" section. A hold belongs to the chapter named by `hold.chapter` when that id is
    /// known, else to the last chapter starting at or before the hold (legacy decks). Chapters
    /// with no holds are left out.
    public static func sections(holds: [Hold], chapters: [ChapterInfo]) -> [NavigatorSection] {
        let byID = Dictionary(chapters.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let sorted = chapters.enumerated()
            .sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }
            .map(\.element)
        func chapter(of h: Hold) -> ChapterInfo? {
            if let id = h.chapter, let c = byID[id] { return c }
            return sorted.last(where: { $0.at <= h.at + 1e-6 }) ?? sorted.first
        }

        var order: [String] = []
        var groups: [String: NavigatorSection] = [:]
        var backups: [Hold] = []
        var backupsDark = false
        for h in holds.sorted(by: { $0.index < $1.index }) {
            let c = chapter(of: h)
            if h.backup {
                backups.append(h)
                backupsDark = backupsDark || (c?.dark ?? false)
                continue
            }
            let id = c?.id ?? h.chapter ?? NavigatorSection.ungroupedID
            if groups[id] == nil {
                order.append(id)
                let title = c.map { $0.label.isEmpty ? "Chapter \(order.count)" : $0.label } ?? h.chapter ?? "Talk"
                groups[id] = NavigatorSection(id: id, title: title, dark: c?.dark ?? false, isBackup: false, holds: [])
            }
            groups[id]!.holds.append(h)
        }
        var out = order.compactMap { groups[$0] }
        if !backups.isEmpty {
            out.append(NavigatorSection(id: NavigatorSection.backupsID, title: "Backups", dark: backupsDark,
                                        isBackup: true, holds: backups))
        }
        return out
    }

    /// Holds in navigator order with collapsed sections skipped (keyboard navigation).
    public static func visibleHolds(_ sections: [NavigatorSection], collapsed: Set<String>) -> [Hold] {
        sections.filter { !collapsed.contains($0.id) }.flatMap(\.holds)
    }

    /// The section holding `holdID`, for revealing the current hold in a collapsed chapter.
    public static func section(containing holdID: Hold.ID, in sections: [NavigatorSection]) -> NavigatorSection.ID? {
        sections.first(where: { $0.holds.contains(where: { $0.id == holdID }) })?.id
    }
}
