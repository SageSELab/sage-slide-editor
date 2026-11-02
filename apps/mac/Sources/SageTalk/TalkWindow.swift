import SageTalkCore
import SwiftUI

struct TalkWindow: View {
    @Bindable var model: TalkWindowModel
    @State private var rightPane: RightPane = .inspector

    enum RightPane: String, CaseIterable { case inspector = "Inspector", claude = "Claude" }

    var body: some View {
        NavigationSplitView {
            navigator
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 360)
        } content: {
            canvas
                .navigationSplitViewColumnWidth(min: 560, ideal: 900)
        } detail: {
            VStack(spacing: 0) {
                Picker("", selection: $rightPane) {
                    ForEach(RightPane.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().padding(10)
                Divider()
                switch rightPane {
                case .inspector: InspectorView(model: model)
                case .claude: ClaudePane(chat: model.chat)
                }
            }
            // A permission request needs an answer: show it.
            .onChange(of: model.chat.pendingPermission?.id) { _, id in if id != nil { rightPane = .claude } }
            .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 480)
        }
        .navigationTitle(model.talk?.displayName ?? "SAGE Talk")
        .toolbar {
            ToolbarItemGroup {
                Button { model.prev() } label: { Label("Previous", systemImage: "backward.end.fill") }
                Button { model.next() } label: { Label("Next Hold", systemImage: "play.fill") }
            }
            ToolbarItem { EditModeButton(model: model) }
        }
    }

    @ViewBuilder private var navigator: some View {
        if model.holds.isEmpty {
            placeholder(model.talk == nil ? "No talk open" : "Opening…",
                        model.talk == nil ? "File ▸ Open Talk… (⌘O)" : (model.status ?? ""))
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
