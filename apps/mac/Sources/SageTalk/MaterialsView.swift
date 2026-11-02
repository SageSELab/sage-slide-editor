import AppKit
import QuickLook
import SageTalkCore
import SwiftUI

/// The Materials tab of the navigator column (PLAN 7): the folders and files talk.json lists
/// under "materials", with Quick Look (Space, or the context menu) and drag into the Claude pane
/// to attach a file to the next message (the prompt then names its path).
struct MaterialsView: View {
    let entries: [Materials.Entry]
    /// Attach without dragging (context menu); nil hides the item.
    var attach: ((URL) -> Void)?
    @State private var selection: String?
    @State private var preview: URL?

    var body: some View {
        Group {
            if entries.isEmpty {
                VStack(spacing: 6) {
                    Text("No materials").font(.headline)
                    Text("List the paper, its PDF and the replication package under \"materials\" in talk.json (paths relative to the talk).")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity).padding()
            } else {
                List(selection: $selection) {
                    ForEach(entries) { entry in
                        Section { rows(entry) } header: { header(entry) }
                    }
                }
                .listStyle(.sidebar)
                .onKeyPress(.space) {
                    guard let s = selection else { return .ignored }
                    preview = URL(fileURLWithPath: s)
                    return .handled
                }
                .quickLookPreview($preview, in: allFiles)
            }
        }
        .accessibilityIdentifier("materials")
    }

    private var allFiles: [URL] {
        var out: [URL] = []
        func walk(_ items: [Materials.Item]) { for i in items { if i.isDirectory { walk(i.children ?? []) } else { out.append(i.url) } } }
        for e in entries { if e.exists && !e.isDirectory { out.append(e.url) } else { walk(e.items) } }
        return out
    }

    private func header(_ e: Materials.Entry) -> some View {
        HStack(spacing: 6) {
            Image(systemName: e.isDirectory ? "folder" : "doc")
            Text(e.key.capitalized).lineLimit(1)
            Spacer()
            Text(e.path).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
        }
        .font(.subheadline.weight(.semibold))
        .help(e.url.path)
    }

    @ViewBuilder private func rows(_ e: Materials.Entry) -> some View {
        if !e.exists {
            Label("Not found: \(e.path)", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.callout)
        } else if !e.isDirectory {
            MaterialRow(url: e.url, name: e.url.lastPathComponent, isDirectory: false, note: nil, attach: attach, preview: $preview)
                .tag(e.url.path)
        } else {
            OutlineGroup(e.items, children: \.outlineChildren) { item in
                MaterialRow(url: item.url, name: item.name, isDirectory: item.isDirectory,
                            note: item.isDirectory && item.omitted > 0 ? "+\(item.omitted)" : nil, attach: attach, preview: $preview)
                    .tag(item.id)
            }
            if e.omitted > 0 { Text("\(e.omitted) more not shown").font(.caption).foregroundStyle(.secondary) }
        }
    }
}

private struct MaterialRow: View {
    let url: URL
    let name: String
    let isDirectory: Bool
    let note: String?
    let attach: ((URL) -> Void)?
    @Binding var preview: URL?

    var body: some View {
        HStack(spacing: 6) {
            Image(nsImage: NSWorkspace.shared.icon(forFile: url.path)).resizable().frame(width: 16, height: 16)
            Text(name).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            if let note { Text(note).font(.caption2).foregroundStyle(.tertiary) }
        }
        .font(.callout)
        .contentShape(Rectangle())
        .draggable(url) { Label(name, systemImage: isDirectory ? "folder" : "doc").padding(4) }
        .contextMenu {
            if !isDirectory { Button("Quick Look") { preview = url } }
            if let attach { Button("Attach to Message") { attach(url) } }
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            Button("Open") { NSWorkspace.shared.open(url) }
        }
        .help(url.path)
        .accessibilityLabel(name)
    }
}
