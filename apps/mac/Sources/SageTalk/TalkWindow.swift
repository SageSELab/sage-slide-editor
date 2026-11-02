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
                Button { model.prev() } label: { Label("Previous", systemImage: "backward.end.fill") }
                Button { model.next() } label: { Label("Next Hold", systemImage: "play.fill") }
            }
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
        ZStack {
            Color.black
            if model.talk != nil { FilmViewRepresentable(film: model.canvas) }
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
