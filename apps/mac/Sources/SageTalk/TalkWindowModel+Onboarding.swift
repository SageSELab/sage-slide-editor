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

    /// Opens a .talk package, a talk folder or a talk.json handed to the app by Finder (double-click,
    /// Open With, a drop on the Dock icon; document types in Info.plist) or by the open panel.
    func openDocument(_ url: URL) {
        if url.pathExtension.lowercased() == TalkPackage.themeExtension { importTheme(url); return }
        open(url.lastPathComponent == "talk.json" ? url.deletingLastPathComponent() : url)
    }
}
