import Foundation
import Observation

// The app's side of editing (PLAN 2 autosave rule, 12.6, 13 risk 5): every edit goes to the
// sidecar at once (talk.edit), and its inverse goes on an undo stack the app owns. Undo sends
// the inverse back (talk.revert), whose own inverse becomes the redo. The stack holds only the
// human's edits: any external change (a terminal, Claude) clears it, and the sidecar refuses an
// inverse whose files changed anyway (EditConflict), which also clears it.

/// What applies edits: the sidecar client, or a fake in tests.
public protocol EditService: Sendable {
    func edit(_ op: EditOp) async throws -> SidecarProtocol.EditResult
    func revert(_ inverse: SidecarProtocol.Inverse) async throws -> SidecarProtocol.EditResult
}

extension SidecarClient: EditService {}

public struct UndoEntry: Equatable, Sendable {
    public var title: String
    public var inverse: SidecarProtocol.Inverse
    public init(title: String, inverse: SidecarProtocol.Inverse) { self.title = title; self.inverse = inverse }
}

@MainActor @Observable
public final class EditSession {
    public private(set) var undoStack: [UndoEntry] = []
    public private(set) var redoStack: [UndoEntry] = []
    /// An edit, undo or redo is in flight.
    public private(set) var busy = false
    /// The last failure, for the status line (cleared by the next success).
    public private(set) var lastError: String?
    /// Counts applied edits, undos and redos (tests, self-test).
    public private(set) var applied = 0

    @ObservationIgnored public var service: (any EditService)?
    /// Called on the main actor after every successful edit, undo or redo.
    @ObservationIgnored public var onApplied: (SidecarProtocol.EditResult) -> Void = { _ in }
    @ObservationIgnored private var tail: Task<Void, Never>?

    public init(service: (any EditService)? = nil) { self.service = service }

    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }
    public var undoTitle: String { undoStack.last.map { "Undo \($0.title)" } ?? "Undo" }
    public var redoTitle: String { redoStack.last.map { "Redo \($0.title)" } ?? "Redo" }

    /// Applies one edit; on success its inverse goes on the undo stack and the redo stack empties.
    @discardableResult
    public func perform(_ op: EditOp) async -> SidecarProtocol.EditResult? {
        await serially { [self] in
            guard let service else { lastError = "No talk is open for editing."; return nil }
            do {
                let r = try await service.edit(op)
                if !r.inverse.isEmpty {
                    undoStack.append(UndoEntry(title: op.title, inverse: r.inverse))
                    redoStack.removeAll()
                }
                succeeded(r)
                return r
            } catch {
                lastError = Self.describe(error)
                return nil
            }
        }
    }

    /// Runs an edit made through another method that returns an EditResult (theme.apply,
    /// fonts.add), in line with the other edits; its inverse goes on the undo stack as `title`.
    /// Returns the method's whole result; throws what it threw (lastError is set too).
    public func performOther<R: Sendable>(_ title: String, _ work: @escaping @Sendable () async throws -> R,
                                          edit: @escaping @Sendable (R) -> SidecarProtocol.EditResult) async throws -> R {
        let outcome: Result<R, Error> = await serially { [self] in
            do {
                let r = try await work()
                let e = edit(r)
                if !e.inverse.isEmpty {
                    undoStack.append(UndoEntry(title: title, inverse: e.inverse))
                    redoStack.removeAll()
                }
                succeeded(e)
                return .success(r)
            } catch {
                lastError = Self.describe(error)
                return .failure(error)
            }
        }
        return try outcome.get()
    }

    @discardableResult
    public func undo() async -> SidecarProtocol.EditResult? { await step(undo: true) }

    @discardableResult
    public func redo() async -> SidecarProtocol.EditResult? { await step(undo: false) }

    /// Someone else changed the talk: the human's history no longer applies.
    public func externalChange() {
        undoStack.removeAll()
        redoStack.removeAll()
    }

    /// Forgets everything (a talk was opened or closed).
    public func reset() {
        externalChange()
        lastError = nil
    }

    private func step(undo: Bool) async -> SidecarProtocol.EditResult? {
        await serially { [self] in
            guard let service, let entry = undo ? undoStack.last : redoStack.last else { return nil }
            do {
                let r = try await service.revert(entry.inverse)
                if undo {
                    undoStack.removeLast()
                    redoStack.append(UndoEntry(title: entry.title, inverse: r.inverse))
                } else {
                    redoStack.removeLast()
                    undoStack.append(UndoEntry(title: entry.title, inverse: r.inverse))
                }
                succeeded(r)
                return r
            } catch {
                if Self.isConflict(error) {
                    externalChange()
                    lastError = "The talk changed outside the app since that edit, so it cannot be \(undo ? "undone" : "redone"). Undo history cleared."
                } else {
                    lastError = Self.describe(error)
                }
                return nil
            }
        }
    }

    private func succeeded(_ r: SidecarProtocol.EditResult) {
        lastError = nil
        applied += 1
        onApplied(r)
    }

    /// Runs edits one at a time in the order they were asked for.
    private func serially<T: Sendable>(_ work: @escaping @MainActor () async -> T) async -> T {
        let prev = tail
        let task = Task { @MainActor in
            _ = await prev?.value
            busy = true
            defer { busy = false }
            return await work()
        }
        tail = Task { _ = await task.value }
        return await task.value
    }

    public static func isConflict(_ error: Error) -> Bool {
        if case SidecarError.remote(let e) = error { return e.code == SidecarProtocol.ErrorCode.editConflict }
        return false
    }

    public static func describe(_ error: Error) -> String {
        if case SidecarError.remote(let e) = error {
            return e.code == SidecarProtocol.ErrorCode.editFailed ? "Cannot edit: \(e.message)" : e.message
        }
        return (error as? LocalizedError)?.errorDescription ?? "\(error)"
    }
}
