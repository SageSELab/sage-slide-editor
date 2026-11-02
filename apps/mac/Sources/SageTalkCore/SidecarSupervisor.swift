import Foundation

// The app's owner of the sidecar process (PLAN 2, 6.1): launches it through SidecarClient,
// forwards its notifications, restarts it once if it crashes (re-opening the talk), and shuts it
// down when the app quits.

/// When to restart a sidecar that exited on its own.
public struct RestartPolicy: Equatable, Sendable {
    /// Automatic restarts allowed over the supervisor's lifetime. One by default: a sidecar that
    /// crashes twice has a real problem, and a crash loop would hide it.
    public var maxRestarts: Int

    public init(maxRestarts: Int = 1) { self.maxRestarts = maxRestarts }

    public func shouldRestart(after term: SidecarTermination, restartsSoFar: Int) -> Bool {
        !term.expected && restartsSoFar < maxRestarts
    }
}

public enum SupervisorEvent: Equatable, Sendable {
    case notification(method: String, params: JSONValue?)
    /// The sidecar exited unexpectedly.
    case crashed(SidecarTermination, willRestart: Bool)
    /// A restart succeeded; carries the re-opened talk, if one was open.
    case restarted(SidecarProtocol.OpenResult?)
    /// The sidecar is gone for good (restart budget spent, or the restart failed).
    case failed(String)
}

public actor SidecarSupervisor {
    public nonisolated let client: SidecarClient
    public nonisolated let events: AsyncStream<SupervisorEvent>
    private let sink: AsyncStream<SupervisorEvent>.Continuation
    private let policy: RestartPolicy
    private var restarts = 0
    private var shuttingDown = false
    private var forwarding: Task<Void, Never>?

    public init(client: SidecarClient, policy: RestartPolicy = RestartPolicy()) {
        self.client = client
        self.policy = policy
        (events, sink) = AsyncStream<SupervisorEvent>.makeStream()
    }

    public init(configuration: SidecarConfiguration, policy: RestartPolicy = RestartPolicy()) {
        self.init(client: SidecarClient(configuration: configuration), policy: policy)
    }

    deinit { sink.finish() }

    public var restartCount: Int { restarts }

    /// Launches the sidecar (no-op when it is running) and starts watching it.
    public func start() async throws {
        if forwarding == nil {
            let stream = client.events
            forwarding = Task { [weak self] in
                for await e in stream { await self?.handle(e) }
            }
        }
        try await client.start()
    }

    public func open(_ talk: URL) async throws -> SidecarProtocol.OpenResult {
        try await start()
        return try await client.open(talk)
    }

    /// Stops the sidecar for good (app quit). Waits up to a few seconds.
    public func shutdown() async {
        shuttingDown = true
        await client.stop(grace: .seconds(2))
        forwarding?.cancel()
        sink.finish()
    }

    private func handle(_ e: SidecarEvent) async {
        switch e {
        case .started: break
        case .notification(let method, let params):
            sink.yield(.notification(method: method, params: params))
        case .terminated(let term):
            guard !shuttingDown, !term.expected else { return }
            let again = policy.shouldRestart(after: term, restartsSoFar: restarts)
            sink.yield(.crashed(term, willRestart: again))
            guard again else {
                sink.yield(.failed(SidecarError.terminated(term).localizedDescription))
                return
            }
            restarts += 1
            do { sink.yield(.restarted(try await client.restart())) }
            catch { sink.yield(.failed("The sidecar could not be restarted: \(error.localizedDescription)")) }
        }
    }
}

/// Finds the sidecar: the one bundled in a packaged app, else the repository whose
/// `packages/sidecar` the development app runs.
///
/// Repository, in order: `SAGE_REPO` in the environment; `Contents/Resources/sage-repo-path`, written by
/// `apps/mac/scripts/bundle.sh`; then the folders above the executable (for `swift run`).
/// `node` comes from `SAGE_NODE`, `Contents/Resources/sage-node-path` (also baked in by
/// bundle.sh, since an app launched from Finder has a minimal PATH), then PATH and the usual
/// install locations.
public enum SidecarLocator {
    public static let repoPathResource = "sage-repo-path"
    public static let nodePathResource = "sage-node-path"

    public static func isRepo(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.appendingPathComponent("packages/sidecar/src/main.ts").path)
    }

    public static func repoRoot(environment: [String: String], resources: URL?, executable: URL?) -> URL? {
        var candidates: [URL] = []
        if let env = environment["SAGE_REPO"], !env.isEmpty { candidates.append(URL(fileURLWithPath: env)) }
        if let baked = read(resources, repoPathResource) { candidates.append(URL(fileURLWithPath: baked)) }
        if var dir = executable?.deletingLastPathComponent() {
            for _ in 0..<8 {
                candidates.append(dir)
                dir = dir.deletingLastPathComponent()
            }
        }
        return candidates.first(where: isRepo)?.standardizedFileURL
    }

    public static func node(environment: [String: String], resources: URL?) -> URL? {
        let fm = FileManager.default
        for p in [environment["SAGE_NODE"], read(resources, nodePathResource)].compactMap({ $0 })
        where fm.isExecutableFile(atPath: p) { return URL(fileURLWithPath: p) }
        return SidecarConfiguration.findNode(environment: environment)
    }

    /// True when the app should run its own bundled sidecar: it has one, and `SAGE_REPO` does
    /// not name a repository (an explicit SAGE_REPO lets a developer run a packaged app against
    /// a checkout).
    public static func usesBundle(environment: [String: String] = ProcessInfo.processInfo.environment,
                                  resources: URL? = Bundle.main.resourceURL) -> Bool {
        if let env = environment["SAGE_REPO"], !env.isEmpty, isRepo(URL(fileURLWithPath: env)) { return false }
        return SidecarConfiguration.Bundled.present(in: resources)
    }

    /// The sidecar configuration: bundled in a packaged app (see `usesBundle`), else development,
    /// or a message saying what is missing.
    public static func configuration(environment: [String: String] = ProcessInfo.processInfo.environment,
                                     resources: URL? = Bundle.main.resourceURL,
                                     executable: URL? = Bundle.main.executableURL) -> Result<SidecarConfiguration, LocatorError> {
        if usesBundle(environment: environment, resources: resources), let resources {
            return .success(.bundled(resources: resources))
        }
        guard let repo = repoRoot(environment: environment, resources: resources, executable: executable) else {
            return .failure(.noRepo)
        }
        guard let node = node(environment: environment, resources: resources) else { return .failure(.noNode) }
        return .success(.development(repoRoot: repo, node: node))
    }

    public enum LocatorError: Error, Equatable, LocalizedError {
        case noRepo, noNode
        public var errorDescription: String? {
            switch self {
            case .noRepo: "The sage-slide-editor repository was not found. Set SAGE_REPO, or rebuild the app with scripts/bundle.sh."
            case .noNode: "node was not found. Set SAGE_NODE, or rebuild the app with scripts/bundle.sh."
            }
        }
    }

    private static func read(_ resources: URL?, _ name: String) -> String? {
        guard let u = resources?.appendingPathComponent(name),
              let s = try? String(contentsOf: u, encoding: .utf8) else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
