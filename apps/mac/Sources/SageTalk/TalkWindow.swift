import SageTalkCore
import SwiftUI

/// The navigator column's tabs: the holds, and the talk's materials (PLAN 5.2, 7).
enum NavigatorTab: String, CaseIterable { case beats = "Beats", materials = "Materials" }

/// The right column's tabs. Kept on the model so a permission prompt or the self-test can switch it.
enum RightPane: String, CaseIterable { case inspector = "Inspector", claude = "Claude" }

struct TalkWindow: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        NavigationSplitView {
            navigator
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 360)
        } content: {
            canvas
                .navigationSplitViewColumnWidth(min: 560, ideal: 900)
        } detail: {
            VStack(spacing: 0) {
                Picker("", selection: $model.rightPane) {
                    ForEach(RightPane.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().padding(10)
                Divider()
                switch model.rightPane {
                case .inspector: InspectorView(model: model)
                case .claude: ClaudePane(chat: model.chat)
                }
            }
            // A permission request needs an answer: show it.
            .onChange(of: model.chat.pendingPermission?.id) { _, id in if id != nil { model.rightPane = .claude } }
            .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 480)
        }
        .navigationTitle(model.talk?.displayName ?? "SAGE Talk")
        .sheet(isPresented: $model.showingPublish) { PublishSheet(model: model) { model.showingPublish = false } }
        .sheet(isPresented: $model.showingExport) { ExportSheet(model: model) { model.showingExport = false } }
        .sheet(isPresented: $model.showOnboarding) {
            if let o = model.onboarding { OnboardingSheet(model: o) { model.finishOnboarding() } }
        }
        .toolbar {
            ToolbarItemGroup {
                Button { model.prev() } label: { Label("Previous", systemImage: "backward.end.fill") }
                Button { model.next() } label: { Label("Next Hold", systemImage: "play.fill") }
            }
            ToolbarItem { EditModeButton(model: model) }
        }
    }

    @ViewBuilder private var navigator: some View {
        VStack(spacing: 0) {
            Picker("", selection: $model.navigatorTab) {
                ForEach(NavigatorTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().padding(.horizontal, 10).padding(.vertical, 6)
            .accessibilityIdentifier("navigator.tabs")
            switch model.navigatorTab {
            case .beats: beats
            case .materials: MaterialsView(entries: model.materials, attach: { model.chat.attach($0) })
            }
        }
    }

    @ViewBuilder private var beats: some View {
        if model.holds.isEmpty {
            placeholder(model.talk == nil ? "No talk open" : "Opening…",
                        model.talk == nil ? "File ▸ New Talk… (⌘N) or Open Talk… (⌘O)" : (model.status ?? ""))
        } else {
            NavigatorView(model: model)
        }
    }

    @ViewBuilder private var canvas: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                Color.black
                if model.talk != nil { FilmViewRepresentable(film: model.canvas) }
                if let err = model.error {
                    // A failed rebuild keeps the last good film visible underneath.
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(.red.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
                        .foregroundStyle(.white)
                        .padding(12)
                        .accessibilityIdentifier("canvas.error")
                }
            }
            TransportBar(model: model)
            if model.offersPackageConversion { PackageOfferBar(model: model) }
            if let status = model.status {
                Text(status)
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.bottom, 5)
                    .background(.bar)
                    .accessibilityIdentifier("canvas.status")
            }
        }
    }

    private func placeholder(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.headline)
            Text(detail).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding()
    }
}

/// The non-modal offer to turn a plain talk folder into a `.talk` package
/// (TalkWindowModel+Package.swift). Nothing happens until Convert is clicked and confirmed.
struct PackageOfferBar: View {
    let model: TalkWindowModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.badge.gearshape").foregroundStyle(.secondary)
            Text("This talk is a plain folder. As a .talk package, Finder shows it as one document that opens in SAGE Talk.")
                .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 8)
            Button("Convert to .talk Package…") { model.convertToPackage() }
                .controlSize(.small)
                .accessibilityIdentifier("package.convert")
            Button("Not Now") { model.dismissPackageOffer() }
                .controlSize(.small).buttonStyle(.borderless)
                .accessibilityIdentifier("package.dismiss")
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .accessibilityIdentifier("package.offer")
    }
}
