import SageTalkCore
import SwiftUI

/// A Google Fonts search picker (the Fontsource catalog through the sidecar): a search field,
/// a category filter, and the matching families. Reusable: the theme editor's font roles use
/// it, and a per-element font control can too (embed the pick with `FontEmbedder.embed`).
///
///     FontPicker(service: { model.themeService }) { info in ... }
struct FontPicker: View {
    @State private var picker: FontPickerModel
    var selectedID: String?
    var onPick: (ThemeProtocol.FontInfo) -> Void

    init(service: @escaping () -> (any ThemeService)?, selectedID: String? = nil, onPick: @escaping (ThemeProtocol.FontInfo) -> Void) {
        _picker = State(initialValue: FontPickerModel(service: service))
        self.selectedID = selectedID
        self.onPick = onPick
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Search Google Fonts", text: $picker.query)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("fontpicker.search")
                Picker("", selection: $picker.category) {
                    Text("All").tag(String?.none)
                    ForEach(FontPickerModel.categories, id: \.self) { Text($0.capitalized).tag(String?.some($0)) }
                }
                .labelsHidden().frame(width: 130)
            }
            if let e = picker.error { Text(e).font(.caption).foregroundStyle(.secondary) }
            List(picker.results) { f in
                Button { onPick(f) } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.family).font(.body.weight(f.id == selectedID ? .semibold : .regular))
                            Text("\(f.category) · \(f.weights.count) weights\(f.hasItalic ? " · italic" : "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if f.id == selectedID { Image(systemName: "checkmark").foregroundStyle(.tint) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .overlay { if picker.searching && picker.results.isEmpty { ProgressView() } }
            .frame(minHeight: 220)
            Text("Embedded into the talk as woff2 (OFL or Apache licensed), so it looks the same everywhere.")
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(12)
        .frame(width: 380, height: 380)
        .onAppear { picker.start() }
    }
}
