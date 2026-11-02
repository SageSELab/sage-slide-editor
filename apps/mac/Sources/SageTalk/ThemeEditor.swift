import AppKit
import SageTalkCore
import SwiftUI

/// Edits a user theme: name and description, a color well per role for the slides and the dark
/// passage, the three font roles (Google fonts through the font picker, or the built-in and
/// system faces), and the type scale. Save writes it through theme.save (fonts downloaded).
struct ThemeEditorView: View {
    @Bindable var themes: ThemesModel
    var entry: ThemeLibrary.Entry
    var done: () -> Void
    @State private var draft: ThemeEditorDraft
    @State private var pickingFont: ThemeEditorDraft.Role?
    @State private var saving = false

    init(themes: ThemesModel, entry: ThemeLibrary.Entry, done: @escaping () -> Void) {
        self.themes = themes; self.entry = entry; self.done = done
        _draft = State(initialValue: ThemeEditorDraft(entry.theme))
    }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Name", text: $draft.theme.name)
                    TextField("Description", text: Binding(get: { draft.theme.description ?? "" }, set: { draft.theme.description = $0.isEmpty ? nil : $0 }), axis: .vertical)
                        .lineLimit(2...3)
                }
                Section("Colors") {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow {
                            Text("")
                            Text("Slides").font(.caption).foregroundStyle(.secondary)
                            Text("Dark passage").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(ThemeEditorDraft.ColorRole.allCases) { role in
                            GridRow {
                                Text(role.title)
                                well(role, .light)
                                well(role, .dark)
                            }
                        }
                    }
                    HStack(spacing: 0) {
                        ThemeSwatch(theme: draft.theme, side: .light)
                        ThemeSwatch(theme: draft.theme, side: .dark)
                    }
                    .frame(height: 90).clipShape(RoundedRectangle(cornerRadius: 8))
                    ForEach(draft.contrastWarnings, id: \.self) { w in
                        Label(w, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                    }
                }
                Section("Fonts") {
                    ForEach(ThemeEditorDraft.Role.allCases) { role in fontRow(role) }
                }
                Section("Type") {
                    HStack {
                        size("Title", \.xl); size("Large", \.l); size("Medium", \.m); size("Small", \.s)
                    }
                    HStack {
                        size("Subtitle", \.sub); size("Caption", \.cap); size("Eyebrow", \.eyebrow)
                    }
                    Picker("Heading weight", selection: $draft.type.headingWeight) {
                        ForEach([400, 500, 600, 700, 800, 900], id: \.self) { Text("\($0)").tag($0) }
                    }
                    HStack {
                        Text("Heading tightness")
                        Slider(value: $draft.type.headingTracking, in: 0...1.5, step: 0.1)
                        Text(String(format: "%.1f", draft.type.headingTracking)).monospacedDigit().frame(width: 30)
                    }
                    Button("Reset to SAGE sizes") { draft.type = .standard }
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                if let e = themes.error { Text(e).font(.caption).foregroundStyle(.red).lineLimit(2) }
                Spacer()
                Button("Cancel", role: .cancel) { done() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Saving…" : "Save") {
                    saving = true
                    Task {
                        let ok = await themes.save(draft, over: entry) != nil
                        saving = false
                        if ok { done() }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(saving || draft.theme.name.trimmingCharacters(in: .whitespaces).isEmpty || !themes.canUseTalk)
                .help(themes.canUseTalk ? "Save the theme (downloads its fonts)" : "Open a talk to save themes")
            }
            .padding(12)
        }
        .frame(width: 560, height: 720)
    }

    private func well(_ role: ThemeEditorDraft.ColorRole, _ side: ThemeEditorDraft.Side) -> some View {
        ColorPicker("", selection: Binding(
            get: { Color(css: draft.color(role, side)) },
            set: { c in
                guard let ns = NSColor(c).usingColorSpace(.sRGB) else { return }
                draft.setColor(role, side, CSSColor(red: ns.redComponent, green: ns.greenComponent, blue: ns.blueComponent, alpha: ns.alphaComponent).css)
            }), supportsOpacity: role == .line || role == .panel)
        .labelsHidden()
        .help(draft.color(role, side))
    }

    private func fontRow(_ role: ThemeEditorDraft.Role) -> some View {
        let f = draft.font(role)
        return HStack {
            Text(role.title).frame(width: 80, alignment: .leading)
            Text(f.family).font(.custom(f.family, size: 15))
            Text(f.source == .google ? "Google · \((f.weights ?? []).map(String.init).joined(separator: ", "))" : f.source == .engine ? "built in" : "system")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
            Menu("Change") {
                Button("Google Font…") { pickingFont = role }
                Divider()
                ForEach(Self.presets(role), id: \.family) { p in Button(p.family) { draft.setFont(role, p) } }
            }
            .fixedSize()
            .popover(isPresented: Binding(get: { pickingFont == role }, set: { if !$0 { pickingFont = nil } })) {
                FontPicker(service: themes.service, selectedID: f.id) { info in
                    draft.setGoogleFont(role, info)
                    pickingFont = nil
                }
            }
        }
    }

    /// Faces that need no download: talk.css's Manrope and the Mac's system fonts.
    static func presets(_ role: ThemeEditorDraft.Role) -> [ThemeProtocol.FontRole] {
        switch role {
        case .display: [.init(family: "Manrope", fallback: "-apple-system, \"SF Pro Display\", system-ui, sans-serif", source: .engine),
                        .init(family: "SF Pro Display", fallback: "-apple-system, system-ui, sans-serif", source: .system)]
        case .body: [.init(family: "SF Pro Text", fallback: "-apple-system, system-ui, \"Segoe UI\", Roboto, sans-serif", source: .system),
                     .init(family: "Manrope", fallback: "-apple-system, system-ui, sans-serif", source: .engine)]
        case .mono: [.init(family: "Menlo", fallback: "ui-monospace, \"SF Mono\", Consolas, monospace", source: .system),
                     .init(family: "SF Mono", fallback: "Menlo, ui-monospace, monospace", source: .system)]
        }
    }

    private func size(_ title: String, _ key: WritableKeyPath<ThemeProtocol.TypeScale, Double>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("", value: Binding(get: { draft.type[keyPath: key] }, set: { draft.type[keyPath: key] = max(8, min(400, $0)) }), format: .number)
                .frame(width: 60)
        }
    }
}
