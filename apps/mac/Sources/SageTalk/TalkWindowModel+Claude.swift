import Foundation
import SageTalkCore

// The Claude pane's side of the window model (PLAN 6): claude.* notifications into the chat,
// the sidecar's app.ask / app.state / app.goto requests, and the canvas following the beat
// Claude last edited unless the user pinned it.
extension TalkWindowModel {
    /// Wires the chat to a (new) supervisor: commands out, app requests in.
    func connectClaude(_ sup: SidecarSupervisor) {
        let client = sup.client
        chat.commands = ClaudeChat.Commands(
            send: { text, attachments in _ = try await client.claudeSend(text, attachments: attachments) },
            interrupt: { _ = try await client.claudeInterrupt() },
            reset: { try await client.claudeReset() })
        chat.onEditedBeat = { [weak self] beat in self?.follow(beat: beat) }
        Task { [weak self] in
            await client.setRequestHandler { [weak self] method, params in
                guard let self else { throw RPCError(code: SidecarProtocol.ErrorCode.methodNotFound, message: "the window is gone") }
                return try await self.answerAppRequest(method, params)
            }
        }
    }

    /// Routes a claude.* notification to the chat; false for other methods.
    func handleClaudeNotification(_ method: String, _ params: JSONValue?) -> Bool {
        guard method.hasPrefix("claude.") else { return false }
        chat.apply(method: method, params: params)
        return true
    }

    func answerAppRequest(_ method: String, _ params: JSONValue?) async throws -> JSONValue {
        switch method {
        case ClaudeProtocol.AppRequest.ask:
            let p: ClaudeProtocol.AskParams = try decode(params, method)
            let decision = await chat.ask(p)
            return try JSONValue.encoding(ClaudeProtocol.AskResult(decision: decision))
        case ClaudeProtocol.AppRequest.state:
            return try JSONValue.encoding(claudeState)
        case ClaudeProtocol.AppRequest.goto:
            let p: ClaudeProtocol.GotoParams = try decode(params, method)
            if chat.followsClaude { canvas.seek(p.t) }
            return try JSONValue.encoding(ClaudeProtocol.GotoResult(t: chat.followsClaude ? p.t : t))
        default:
            throw RPCError(code: SidecarProtocol.ErrorCode.methodNotFound, message: "the app does not handle \(method)")
        }
    }

    /// What talk_state reports: where the canvas is and what is selected.
    var claudeState: ClaudeProtocol.StateResult {
        let h = HoldTimeline(holds: holds, duration: duration).current(at: t)
        return ClaudeProtocol.StateResult(t: t, playing: playing, hold: h?.index, beat: h?.beat, label: h?.label,
                                          selection: selection.map { [$0.id] } ?? [], pinned: !chat.followsClaude)
    }

    /// Moves the canvas to the hold of a beat Claude edited (the rebuild then reloads it there).
    func follow(beat: String) {
        guard chat.followsClaude, let h = holds.first(where: { $0.beat == beat }) else { return }
        selectedHold = h.id
        canvas.seek(h.at)
    }

    private func decode<T: Decodable>(_ params: JSONValue?, _ method: String) throws -> T {
        do { return try (params ?? .object([:])).decode(as: T.self) } catch {
            throw RPCError(code: SidecarProtocol.ErrorCode.invalidParams, message: "\(method): \(error)")
        }
    }
}
