import AppKit
import SageTalkCore
import SwiftUI
import UniformTypeIdentifiers

/// Format ▸ Themes…: the theme library as cards (light and dark swatches, font names), and
/// for the selected theme Apply, Edit, Duplicate, Export, Share and Delete. Save Current
/// Talk's Theme… and Import… add to the library.
struct ThemesView: View {
    @Bindable var themes: ThemesModel
    @State private var editing: ThemeLibrary.Entry?
    @State private var naming = false
    @State private var newName = ""
    @State private var confirmDelete: ThemeLibrary.Entry?

    static let themeType = UTType(TalkPackage.themeTypeIdentifier) ?? UTType(filenameExtension: TalkPackage.themeExtension, conformingTo: .package) ?? .package

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                header
                Divider()
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230, maximum: 300), spacing: 14)], spacing: 14) {
                        ForEach(themes.entries) { e in
                            ThemeCard(entry: e, selected: e.id == themes.selectedID, applied: e.id == themes.appliedID)
                                .onTapGesture { themes.selectedID = e.id }
                                .simultaneousGesture(TapGesture(count: 2).onEnded { Task { await themes.apply(e) } })
                                .contextMenu { menu(e) }
                        }
                    }
                    .padding(14)
                }
                footer
            }
            .frame(minWidth: 520)
            Divider()
            ThemeDetail(themes: themes, edit: { editing = $0 }, delete: { confirmDelete = $0 })
                .frame(width: 300)
        }
        .frame(minWidth: 840, minHeight: 520)
        .onAppear { themes.reload() }
        .sheet(item: $editing) { e in
            ThemeEditorView(themes: themes, entry: e) { editing = nil }
        }
        .alert("Save the talk's theme", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Save") { let n = newName; Task { await themes.saveCurrentTalk(named: n.isEmpty ? "My Theme" : n) } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The open talk's colors and fonts become a theme in your library.") }
        .confirmationDialog("Delete “\(confirmDelete?.theme.name ?? "")”?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } })) {
            Button("Move to Trash", role: .destructive) { if let e = confirmDelete { themes.delete(e) }; confirmDelete = nil }
        } message: { Text("Talks that use it keep their look; only the library entry goes.") }
    }

    private var header: some View {
        HStack {
            Text("Themes").font(.title2.weight(.semibold))
            Spacer()
            Button("Save Current Talk's Theme…") { newName = ""; naming = true }
                .disabled(!themes.canUseTalk || themes.busy)
                .help("Make a library theme from the open talk's colors and fonts")
            Button("Import…") { importPanel() }
        }
        .padding(12)
    }

    @ViewBuilder private var footer: some View {
        if themes.busy || themes.error != nil || themes.status != nil {
            Divider()
            HStack(spacing: 8) {
                if themes.busy { ProgressView().controlSize(.small) }
                if let e = themes.error {
                    Label(e, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                } else if let s = themes.status { Text(s).foregroundStyle(.secondary) }
                Spacer()
            }
            .font(.callout).padding(.horizontal, 12).padding(.vertical, 7)
            .accessibilityIdentifier("themes.status")
        }
    }

    @ViewBuilder private func menu(_ e: ThemeLibrary.Entry) -> some View {
        Button("Apply to Talk") { Task { await themes.apply(e) } }.disabled(!themes.canUseTalk)
        Button(e.builtin ? "Duplicate and Edit…" : "Edit…") { edit(e) }
        Button("Duplicate") { themes.duplicate(e) }
        Button("Export…") { ThemeDetail.exportPanel(themes, e) }
        Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([e.url]) }
        if !e.builtin { Divider(); Button("Delete…", role: .destructive) { confirmDelete = e } }
    }

    private func edit(_ e: ThemeLibrary.Entry) {
        if e.builtin { if let copy = themes.duplicate(e) { editing = copy } } else { editing = e }
    }

    private func importPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [Self.themeType]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.prompt = "Import"
        panel.message = "Choose SAGE themes (.talktheme) to add to your library."
        guard panel.runModal() == .OK else { return }
        for url in panel.urls { themes.importPackage(url) }
    }
}

// MARK: Card

struct ThemeCard: View {
    var entry: ThemeLibrary.Entry
    var selected = false
    var applied = false

    init(entry: ThemeLibrary.Entry, selected: Bool = false, applied: Bool = false) {
        self.entry = entry; self.selected = selected; self.applied = applied
        AppThemes.registerFonts(entry) // before the first draw, so the swatches use the theme's faces
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 0) {
                ThemeSwatch(theme: entry.theme, side: .light)
                ThemeSwatch(theme: entry.theme, side: .dark)
            }
            .frame(height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.separator))
            HStack {
                Text(entry.theme.name).font(.headline)
                if entry.builtin { Text("Built-in").font(.caption2).padding(.horizontal, 5).padding(.vertical, 1).background(.quaternary, in: Capsule()) }
                if applied { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).help("Applied to the talk") }
                Spacer()
            }
            Text(ThemeCard.fontsLine(entry.theme)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(selected ? Color.accentColor.opacity(0.14) : Color(nsColor: .controlBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(selected ? Color.accentColor : Color.clear, lineWidth: 2))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("themes.card.\(entry.id)")
    }

    static func fontsLine(_ t: ThemeProtocol.Theme) -> String {
        [t.fonts.display.family, t.fonts.body.family, t.fonts.mono.family].reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }.joined(separator: " · ")
    }
}

/// Half a card: the background, a heading in the display font, a line of text, the accents.
struct ThemeSwatch: View {
    var theme: ThemeProtocol.Theme
    var side: ThemeEditorDraft.Side

    var body: some View {
        let d = ThemeEditorDraft(theme)
        VStack(alignment: .leading, spacing: 4) {
            Text("Aa").font(.custom(theme.fonts.display.family, size: 26).weight(.bold)).foregroundStyle(Color(css: d.color(.ink, side)))
            Text(side == .light ? "Slides" : "Dark passage").font(.custom(theme.fonts.body.family, size: 11)).foregroundStyle(Color(css: d.color(.ink2, side)))
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                ForEach([ThemeEditorDraft.ColorRole.accent1, .accent2, .accent3], id: \.self) { r in
                    Circle().fill(Color(css: d.color(r, side))).frame(width: 11, height: 11)
                }
                Spacer()
                RoundedRectangle(cornerRadius: 2).fill(Color(css: d.color(.ink3, side))).frame(width: 26, height: 4)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(css: d.color(.bg, side)))
    }
}

extension Color {
    /// A CSS color (gray when it cannot be read: a theme may use any CSS color syntax).
    init(css: String) {
        let c = CSSColor(css: css) ?? CSSColor(red: 0.5, green: 0.5, blue: 0.5)
        self.init(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: c.alpha)
    }
}

// MARK: Detail

struct ThemeDetail: View {
    @Bindable var themes: ThemesModel
    var edit: (ThemeLibrary.Entry) -> Void
    var delete: (ThemeLibrary.Entry) -> Void

    var body: some View {
        if let e = themes.selected {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ThemeCard(entry: e)
                    if let d = e.theme.description { Text(d).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                    Grid(alignment: .leading, verticalSpacing: 4) {
                        row("Headings", e.theme.fonts.display)
                        row("Text", e.theme.fonts.body)
                        row("Code", e.theme.fonts.mono)
                    }
                    .font(.caption)
                    Button { Task { await themes.apply(e) } } label: { Label("Apply to Talk", systemImage: "paintbrush.fill").frame(maxWidth: .infinity) }
                        .buttonStyle(.borderedProminent).controlSize(.large)
                        .disabled(!themes.canUseTalk || themes.busy)
                        .accessibilityIdentifier("themes.apply")
                    if !themes.canUseTalk { Text("Open a talk to apply a theme.").font(.caption).foregroundStyle(.secondary) }
                    HStack {
                        Button(e.builtin ? "Duplicate and Edit…" : "Edit…") {
                            if e.builtin { if let c = themes.duplicate(e) { edit(c) } } else { edit(e) }
                        }
                        Button("Duplicate") { themes.duplicate(e) }
                    }
                    HStack {
                        Button("Export…") { Self.exportPanel(themes, e) }
                        ShareButton(url: e.url).frame(width: 80, height: 24)
                        if !e.builtin { Button("Delete…", role: .destructive) { delete(e) } }
                    }
                }
                .padding(14)
            }
        } else {
            Text("No theme selected").foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func row(_ title: String, _ f: ThemeProtocol.FontRole) -> some View {
        GridRow {
            Text(title).foregroundStyle(.secondary)
            Text(f.family + (f.source == .google ? "  (Google, embedded)" : f.source == .engine ? "  (built in)" : "  (system)"))
        }
    }

    static func exportPanel(_ themes: ThemesModel, _ e: ThemeLibrary.Entry) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [ThemesView.themeType]
        panel.nameFieldStringValue = "\(e.theme.name).\(TalkPackage.themeExtension)"
        panel.message = "Save “\(e.theme.name)” as a theme file to share."
        if panel.runModal() == .OK, let url = panel.url { themes.export(e, to: url) }
    }
}

/// The system Share menu (AirDrop, Mail, Messages...) for a theme package.
struct ShareButton: NSViewRepresentable {
    var url: URL
    func makeNSView(context: Context) -> NSButton {
        let b = NSButton(title: "Share", target: context.coordinator, action: #selector(Coordinator.share(_:)))
        b.image = NSImage(systemSymbolName: "square.and.arrow.up", accessibilityDescription: "Share")
        b.imagePosition = .imageLeading
        b.bezelStyle = .push
        return b
    }
    func updateNSView(_ b: NSButton, context: Context) { context.coordinator.url = url }
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    @MainActor final class Coordinator: NSObject {
        var url: URL
        init(url: URL) { self.url = url }
        @objc func share(_ sender: NSButton) {
            NSSharingServicePicker(items: [url]).show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
        }
    }
}
