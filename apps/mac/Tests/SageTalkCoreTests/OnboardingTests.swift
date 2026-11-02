import Foundation
import Testing
@testable import SageTalkCore

/// The onboarding sheet's steps, against a fake sidecar.
@MainActor @Suite struct OnboardingTests {
    typealias S = SetupProtocol

    final class FakeService: SetupService, @unchecked Sendable {
        var result: S.CheckResult
        var fail: Error?
        var install: S.InstallResult?
        var authAsked = 0
        init(_ result: S.CheckResult) { self.result = result }
        func check(auth: Bool) async throws -> S.CheckResult {
            if let fail { throw fail }
            if auth { authAsked += 1; return result }
            var r = result; r.auth = nil; return r
        }
        func installBrowser(progress: @escaping @Sendable (S.ProgressParams) -> Void) async throws -> S.InstallResult {
            for f in [0.0, 0.5, 1.0] { progress(S.ProgressParams(fraction: f, message: "Downloading 90 MiB")) }
            return install ?? S.InstallResult(ok: false, message: "no", browser: result.browser)
        }
        func close() async {}
    }

    static let shell = S.BrowserStatus(state: .missing, path: "/as/ms-playwright/chromium_headless_shell-1248", canInstall: true)
    static func result(auth: S.AuthStatus, browser: S.BrowserStatus = S.BrowserStatus(state: .chrome, path: "/Applications/Google Chrome.app", canInstall: false),
                       problems: [String] = []) -> S.CheckResult {
        S.CheckResult(mode: .bundled, version: "v0.6.0", node: "v24.22.2", nodePath: "/bin/sh", problems: problems,
                      claudeBinary: "/x/claude", talkc: "/x/talkc", browser: browser, auth: auth)
    }

    /// /bin/sh stands in for node: the model only checks that the executable exists.
    func model(_ svc: FakeService) -> OnboardingModel {
        var config = SidecarConfiguration(executable: URL(fileURLWithPath: "/bin/sh"))
        config.mode = .bundled
        return OnboardingModel(locate: { .success(config) }, makeService: { _ in svc })
    }

    @Test func everythingFine() async {
        let svc = FakeService(Self.result(auth: S.AuthStatus(state: .login, account: "k@x.io", organization: "Lab", plan: "Claude Max")))
        let m = model(svc)
        await m.run()
        #expect(m.steps.map(\.status) == [.ok, .ok, .ok, .ok])
        #expect(m.allGood && m.mode == .bundled && svc.authAsked == 1)
        #expect(m.steps[0].detail == "Node v24.22.2 (bundled with the app)")
        #expect(m.steps[1].detail.hasPrefix("Bundled sidecar v0.6.0, started in "))
        #expect(m.steps[2].detail == "Signed in as k@x.io, Lab (Claude Max).")
        #expect(m.steps[3].detail.hasPrefix("Google Chrome"))
        #expect(!m.canInstallBrowser)
    }

    @Test func notSignedInAndProblemsAreWarnings() async {
        let svc = FakeService(Self.result(auth: S.AuthStatus(state: .none), problems: ["talkc is missing from /x/bin"]))
        let m = model(svc)
        await m.run()
        #expect(m.steps.map(\.status) == [.ok, .warning, .warning, .ok])
        #expect(m.steps[1].detail == "Started, but: talkc is missing from /x/bin")
        #expect(m.steps[2].detail.contains("/login"))
        #expect(!m.allGood)
    }

    @Test func missingBrowserIsOfferedAndInstalled() async {
        let svc = FakeService(Self.result(auth: S.AuthStatus(state: .apiKey, source: "ANTHROPIC_API_KEY"), browser: Self.shell))
        let m = model(svc)
        await m.run()
        #expect(m.steps[2] == OnboardingStep(kind: .claude, status: .ok, title: "Claude", detail: "Using an API key from ANTHROPIC_API_KEY."))
        #expect(m.steps[3].status == .warning && m.canInstallBrowser)
        svc.install = S.InstallResult(ok: true, browser: S.BrowserStatus(state: .installed, path: Self.shell.path, canInstall: false))
        await m.installBrowser()
        #expect(m.steps[3].status == .ok && m.steps[3].detail.hasPrefix("Chromium (downloaded)"))
        #expect(!m.canInstallBrowser && !m.installing && m.installFraction == nil)
        #expect(m.allGood)
    }

    @Test func aFailedInstallSaysWhy() async {
        let svc = FakeService(Self.result(auth: S.AuthStatus(state: .login), browser: Self.shell))
        let m = model(svc)
        await m.run()
        svc.install = S.InstallResult(ok: false, message: "The download failed (exit 1): offline", browser: Self.shell)
        await m.installBrowser()
        #expect(m.steps[3] == OnboardingStep(kind: .browser, status: .failed, title: "Render browser", detail: "The download failed (exit 1): offline"))
        #expect(m.canInstallBrowser)
    }

    @Test func aSidecarThatDoesNotStart() async {
        let svc = FakeService(Self.result(auth: S.AuthStatus(state: .login)))
        svc.fail = SidecarError.launchFailed("boom")
        let m = model(svc)
        await m.run()
        #expect(m.steps.map(\.status) == [.warning, .failed, .failed, .failed])
        #expect(m.steps[1].detail.contains("boom"))
    }

    @Test func noSidecarFound() async {
        let m = OnboardingModel(locate: { .failure(.noRepo) }, makeService: { _ in FakeService(Self.result(auth: S.AuthStatus(state: .login))) })
        await m.run()
        #expect(m.steps.map(\.status) == [.failed, .failed, .failed, .failed])
        #expect(m.steps[0].detail == SidecarLocator.LocatorError.noRepo.localizedDescription)
    }

    @Test func authAndBrowserWording() {
        #expect(OnboardingModel.authStep(S.AuthStatus(state: .external, provider: "bedrock")) == (.ok, "Using bedrock."))
        #expect(OnboardingModel.authStep(S.AuthStatus(state: .unknown, message: "x")) == (.warning, "x"))
        #expect(OnboardingModel.browserStep(S.BrowserStatus(state: .missing, canInstall: false)).0 == .warning)
        #expect(OnboardingModel.loginCaveat.contains("ask Anthropic"))
    }
}
