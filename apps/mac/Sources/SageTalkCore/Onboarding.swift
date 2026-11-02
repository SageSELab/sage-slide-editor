import Foundation
import Observation

// The first-run onboarding sheet's model (Phase 6, docs/packaging.md): is the Node runtime
// there, does the sidecar start, is Claude signed in (asked without a model call), is there a
// render browser (offer the download). AppKit-free so the step logic is unit-tested; the sheet
// is OnboardingSheet.swift in the app.

public enum OnboardingStepKind: String, CaseIterable, Sendable { case runtime, sidecar, claude, browser }

public enum OnboardingStatus: String, Equatable, Sendable { case pending, running, ok, warning, failed }

public struct OnboardingStep: Identifiable, Equatable, Sendable {
    public var id: OnboardingStepKind { kind }
    public var kind: OnboardingStepKind
    public var status: OnboardingStatus
    public var title: String
    public var detail: String
    public init(kind: OnboardingStepKind, status: OnboardingStatus, title: String, detail: String) {
        self.kind = kind; self.status = status; self.title = title; self.detail = detail
    }
}

/// What the onboarding sheet needs from a sidecar.
public protocol SetupService: Sendable {
    func check(auth: Bool) async throws -> SetupProtocol.CheckResult
    func installBrowser(progress: @escaping @Sendable (SetupProtocol.ProgressParams) -> Void) async throws -> SetupProtocol.InstallResult
    func close() async
}

/// A short-lived sidecar for the checks, separate from any talk's.
public final class SidecarSetupService: SetupService, @unchecked Sendable {
    private let client: SidecarClient
    private let lock = NSLock()
    private var progress: (@Sendable (SetupProtocol.ProgressParams) -> Void)?
    private var forwarding: Task<Void, Never>?

    public init(configuration: SidecarConfiguration) {
        client = SidecarClient(configuration: configuration)
        let events = client.events
        // One reader for the client's event stream for the service's lifetime.
        forwarding = Task { [weak self] in
            for await e in events {
                guard case .notification(SetupProtocol.Notification.progress, let params) = e,
                      let p: SetupProtocol.ProgressParams = try? params?.decode() else { continue }
                self?.lock.withLock { self?.progress }?(p)
            }
        }
    }

    deinit { forwarding?.cancel() }

    public func check(auth: Bool) async throws -> SetupProtocol.CheckResult {
        try await client.start()
        return try await client.setupCheck(auth: auth)
    }

    public func installBrowser(progress: @escaping @Sendable (SetupProtocol.ProgressParams) -> Void) async throws -> SetupProtocol.InstallResult {
        try await client.start()
        lock.withLock { self.progress = progress }
        defer { lock.withLock { self.progress = nil } }
        return try await client.installBrowser()
    }

    public func close() async { await client.stop(grace: .seconds(2)) }
}

@MainActor @Observable
public final class OnboardingModel {
    public private(set) var steps: [OnboardingStep]
    public private(set) var checking = false
    public private(set) var installing = false
    public private(set) var installFraction: Double?
    public private(set) var installMessage: String?
    public private(set) var result: SetupProtocol.CheckResult?
    public private(set) var mode: SidecarMode?
    /// How long the sidecar took to answer its first check.
    public private(set) var startupMs: Int?

    /// Re-locates the sidecar for each run (the configuration may change after a fix).
    @ObservationIgnored public var locate: () -> Result<SidecarConfiguration, SidecarLocator.LocatorError>
    @ObservationIgnored public var makeService: (SidecarConfiguration) -> SetupService
    @ObservationIgnored private var service: SetupService?

    public init(locate: @escaping () -> Result<SidecarConfiguration, SidecarLocator.LocatorError> = { SidecarLocator.configuration() },
                makeService: @escaping (SidecarConfiguration) -> SetupService = { SidecarSetupService(configuration: $0) }) {
        self.locate = locate
        self.makeService = makeService
        steps = Self.pendingSteps
    }

    public static let pendingSteps: [OnboardingStep] = [
        OnboardingStep(kind: .runtime, status: .pending, title: "Node runtime", detail: ""),
        OnboardingStep(kind: .sidecar, status: .pending, title: "Sidecar", detail: ""),
        OnboardingStep(kind: .claude, status: .pending, title: "Claude", detail: ""),
        OnboardingStep(kind: .browser, status: .pending, title: "Render browser", detail: ""),
    ]

    public var allGood: Bool { steps.allSatisfy { $0.status == .ok } }
    public var canInstallBrowser: Bool { (result?.browser.canInstall ?? false) && !installing }

    /// Runs every check (the auth check takes a few seconds: it starts the Claude CLI, but sends
    /// it no message).
    public func run() async {
        guard !checking else { return }
        checking = true
        defer { checking = false }
        steps = Self.pendingSteps
        result = nil
        startupMs = nil
        await service?.close()
        service = nil

        let config: SidecarConfiguration
        switch locate() {
        case .failure(let e):
            set(.runtime, .failed, e.localizedDescription)
            for k in [OnboardingStepKind.sidecar, .claude, .browser] { set(k, .failed, "Needs the sidecar.") }
            return
        case .success(let c): config = c
        }
        mode = config.mode
        guard FileManager.default.isExecutableFile(atPath: config.executable.path) else {
            set(.runtime, .failed, "No executable Node at \(config.executable.path).")
            for k in [OnboardingStepKind.sidecar, .claude, .browser] { set(k, .failed, "Needs the Node runtime.") }
            return
        }
        set(.runtime, .running, config.executable.path)
        set(.sidecar, .running, "Starting…")
        let svc = makeService(config)
        service = svc
        let clock = ContinuousClock(), t0 = clock.now
        do {
            let quick = try await svc.check(auth: false)
            let ms = (clock.now - t0).components
            startupMs = Int(ms.seconds * 1000 + ms.attoseconds / 1_000_000_000_000_000)
            apply(quick)
            set(.claude, .running, "Asking the Claude CLI (no message is sent)…")
            let full = try await svc.check(auth: true)
            apply(full)
        } catch {
            set(.sidecar, .failed, "The sidecar did not start: \(error.localizedDescription)")
            for k in [OnboardingStepKind.claude, .browser] where step(k)?.status != .ok { set(k, .failed, "Needs the sidecar.") }
            if step(.runtime)?.status == .running { set(.runtime, .warning, config.executable.path) }
        }
    }

    /// Downloads the render browser with progress, then re-checks it.
    public func installBrowser() async {
        guard let svc = service, !installing else { return }
        installing = true
        installFraction = 0
        installMessage = "Starting the download"
        set(.browser, .running, "Downloading Chromium…")
        defer { installing = false }
        do {
            let r = try await svc.installBrowser { [weak self] p in
                Task { @MainActor [weak self] in
                    self?.installFraction = p.fraction
                    self?.installMessage = p.message
                }
            }
            if var res = result { res.browser = r.browser; result = res }
            let (status, detail) = Self.browserStep(r.browser)
            set(.browser, r.ok ? status : .failed, r.ok ? detail : (r.message ?? "The download failed."))
        } catch {
            set(.browser, .failed, "The download failed: \(error.localizedDescription)")
        }
        installFraction = nil
    }

    public func close() async {
        await service?.close()
        service = nil
    }

    private func apply(_ r: SetupProtocol.CheckResult) {
        result = r
        set(.runtime, .ok, "Node \(r.node) (\(r.mode == .bundled ? "bundled with the app" : "development"))")
        let started = startupMs.map { "started in \($0) ms" } ?? "running"
        if r.problems.isEmpty {
            set(.sidecar, .ok, "\(r.mode == .bundled ? "Bundled sidecar \(r.version)" : "Development sidecar (packages/sidecar)"), \(started)")
        } else {
            set(.sidecar, .warning, "Started, but: " + r.problems.joined(separator: "; "))
        }
        if let a = r.auth {
            let (status, detail) = Self.authStep(a)
            set(.claude, status, detail)
        }
        let (status, detail) = Self.browserStep(r.browser)
        set(.browser, status, detail)
    }

    public static func authStep(_ a: SetupProtocol.AuthStatus) -> (OnboardingStatus, String) {
        switch a.state {
        case .login:
            let who = [a.account, a.organization].compactMap { $0 }.joined(separator: ", ")
            return (.ok, "Signed in\(who.isEmpty ? "" : " as \(who)")\(a.plan.map { " (\($0))" } ?? "").")
        case .apiKey:
            return (.ok, "Using an API key\(a.source.map { " from \($0)" } ?? "").")
        case .external:
            return (.ok, a.message ?? "Using \(a.provider ?? "a cloud provider").")
        case .none:
            return (.warning, "Not signed in. Run `claude` in Terminal and use /login, or set ANTHROPIC_API_KEY for the app.")
        case .unknown:
            return (.warning, a.message ?? "The Claude CLI could not be asked.")
        }
    }

    public static func browserStep(_ b: SetupProtocol.BrowserStatus) -> (OnboardingStatus, String) {
        switch b.state {
        case .chrome: return (.ok, "Google Chrome renders frames for Claude and exports.")
        case .installed: return (.ok, "Chromium (downloaded) renders frames for Claude and exports.")
        case .missing:
            return (.warning, b.canInstall
                ? "Claude's frame previews and exports need a Chromium. Install Google Chrome, or download Chromium (about 100 MB) here."
                : "No Chromium found. In the repository run `pnpm --filter @sage/render exec playwright install chromium`.")
        }
    }

    private func step(_ k: OnboardingStepKind) -> OnboardingStep? { steps.first { $0.kind == k } }

    private func set(_ k: OnboardingStepKind, _ status: OnboardingStatus, _ detail: String) {
        guard let i = steps.firstIndex(where: { $0.kind == k }) else { return }
        steps[i].status = status
        steps[i].detail = detail
    }

    /// The caveat from PLAN 6.4, shown on the sheet.
    public static let loginCaveat = """
    SAGE Talk runs Claude through Anthropic's Agent SDK and reuses the Claude login on this Mac \
    (the one `claude` uses), or an API key. Anthropic's terms say third-party products may not \
    offer claude.ai login or subscription limits without approval: this is fine for your own \
    copy on your own Mac, but ask Anthropic before giving the app to anyone else, and use an \
    API key for shared or distributed builds.
    """

    /// Shown once per Mac (and again from the app menu).
    public static let completedKey = "onboardingCompleted.v1"
}
