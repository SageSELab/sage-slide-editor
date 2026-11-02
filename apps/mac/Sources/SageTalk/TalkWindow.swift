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
                case .inspector: placeholder("Inspector", "Object, Beat, Chapter and Talk tabs arrive in Phase 3.")
                case .claude: placeholder("Claude", "The chat pane arrives in Phase 4.")
                }
            }
            .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 480)
        }
        .navigationTitle(model.talk?.displayName ?? "SAGE Talk")
        .toolbar {
            ToolbarItemGroup {
                Button { model.canvas.prev() } label: { Label("Previous", systemImage: "backward.end.fill") }
                Button { model.canvas.next() } label: { Label("Next Hold", systemImage: "play.fill") }
            }
        }
    }

    @ViewBuilder private var navigator: some View {
        if model.holds.isEmpty {
            placeholder("No talk open", "File ▸ Open Talk… (⌘O)")
        } else {
            List(selection: Binding(get: { model.selectedHold }, set: { model.select($0) })) {
                ForEach(model.holds) { h in
                    HStack(alignment: .firstTextBaseline) {
                        Text(h.backup ? "B" : "\(h.index)").monospacedDigit().foregroundStyle(.secondary).frame(width: 26, alignment: .trailing)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(h.label.isEmpty ? "Untitled" : h.label).lineLimit(1)
                            Text(String(format: "%.1f s", h.at)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .tag(h.id)
                }
            }
        }
    }

    @ViewBuilder private var canvas: some View {
        ZStack {
            Color.black
            if model.talk != nil { CanvasView(controller: model.canvas) }
            if let err = model.error { Text(err).foregroundStyle(.white).padding() }
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
