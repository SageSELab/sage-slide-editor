import SageTalkCore
import SwiftUI

/// The first-run sheet (Phase 6): runtime, sidecar, Claude sign-in and render browser checks,
/// the browser download with progress, and the third-party login caveat (PLAN 6.4). Shown once
/// per Mac, and again from SAGE Talk ▸ Setup Assistant…
struct OnboardingSheet: View {
    @Bindable var model: OnboardingModel
    var onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Welcome to SAGE Talk").font(.title2.bold())
                    Text("Checking what the editor and the Claude pane need on this Mac.")
                        .foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                ForEach(model.steps) { step in
                    StepRow(step: step)
                    if step.kind == .browser { browserControls }
                }
            }
            .padding(14)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 6) {
                Label("About signing in to Claude", systemImage: "info.circle").font(.headline)
                Text(OnboardingModel.loginCaveat)
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if model.checking { ProgressView().controlSize(.small) }
                Spacer()
                Button("Check Again") { Task { await model.run() } }
                    .disabled(model.checking || model.installing)
                Button("Done") { onDone() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.installing)
            }
        }
        .padding(22)
        .frame(width: 560)
        .accessibilityIdentifier("onboarding")
    }

    @ViewBuilder private var browserControls: some View {
        if model.installing {
            VStack(alignment: .leading, spacing: 4) {
                ProgressView(value: model.installFraction ?? 0)
                Text(model.installMessage ?? "").font(.caption).foregroundStyle(.secondary)
            }
            .padding(.leading, 30)
        } else if model.canInstallBrowser {
            Button("Download Chromium (about 100 MB)") { Task { await model.installBrowser() } }
                .padding(.leading, 30)
        }
    }
}

private struct StepRow: View {
    let step: OnboardingStep

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            icon.frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title).font(.body.weight(.semibold))
                if !step.detail.isEmpty {
                    Text(step.detail).font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
        }
        .accessibilityIdentifier("onboarding.\(step.kind.rawValue)")
    }

    @ViewBuilder private var icon: some View {
        switch step.status {
        case .pending: Image(systemName: "circle").foregroundStyle(.tertiary)
        case .running: ProgressView().controlSize(.small)
        case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .warning: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        case .failed: Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
        }
    }
}
