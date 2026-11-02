import Foundation
import SageTalkCore

// The onboarding sheet's side of the window model (Phase 6): shown on the first launch, and
// from SAGE Talk ▸ Setup Assistant…
extension TalkWindowModel {
    /// Shows the sheet and starts its checks.
    func presentOnboarding() {
        let m = onboarding ?? OnboardingModel()
        onboarding = m
        showOnboarding = true
        Task { await m.run() }
    }

    /// First launch on this Mac (never in self-test mode).
    func presentOnboardingIfNeeded(defaults: UserDefaults = .standard) {
        guard SelfTest.outDir == nil, !defaults.bool(forKey: OnboardingModel.completedKey) else { return }
        presentOnboarding()
    }

    func finishOnboarding(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: OnboardingModel.completedKey)
        showOnboarding = false
        let m = onboarding
        Task { await m?.close() }
    }

    /// Opens a folder or talk.json handed to the app by Finder (document types in Info.plist).
    func openDocument(_ url: URL) {
        open(url.lastPathComponent == "talk.json" ? url.deletingLastPathComponent() : url)
    }
}
