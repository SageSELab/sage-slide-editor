import AppKit
import SageTalkCore
import SwiftUI

/// File ▸ Publish… (PLAN 5.6): the public single file, its warnings, and the "Stage on website"
/// step for each configured site repository. Staging only writes into the working tree and
/// shows the diff; "Commit in that repo" is the only thing that commits, and nothing pushes.
struct PublishSheet: View {
    @Bindable var model: TalkWindowModel
    var dismiss: () -> Void = {}

    private var pub: PublishModel { model.publishing }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    publishSection
                    if let r = pub.result {
                        resultSection(r)
                        Divider()
                        stageSection
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack {
                Label("SAGE Talk never pushes. After committing, push each repository yourself.", systemImage: "arrow.up.circle")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("publish.done")
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .frame(width: 660, height: 760)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Publish").font(.title2.bold())
            Text(pub.talkTitle.isEmpty ? (model.talk?.displayName ?? "") : pub.talkTitle)
                .font(.callout).foregroundStyle(.secondary).lineLimit(2)
        }
    }

    // MARK: Publish

    private var publishSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("File name").frame(width: 80, alignment: .leading)
                TextField("slug", text: Binding(get: { pub.slug }, set: { pub.slug = $0 }))
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())
                    .frame(width: 280)
                    .onSubmit { Task { await pub.publish() } }
                    .accessibilityIdentifier("publish.slug")
                Text(".html").foregroundStyle(.secondary).font(.body.monospaced())
                Spacer()
                Button {
                    Task { await pub.publish() }
                } label: {
                    if pub.phase == .running { ProgressView().controlSize(.small) } else { Text(pub.result == nil ? "Publish" : "Publish Again") }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!pub.canPublish)
                .accessibilityIdentifier("publish.publish")
            }
            if let problem = pub.slugProblem {
                Text(problem).font(.caption).foregroundStyle(.red)
            }
            Text("Writes \(pub.outputPath) in the talk folder: private chapters and backups are cut, the end card is added, speaker notes are removed, and every asset is inlined.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if case .failed(let msg) = pub.phase {
                Label(msg, systemImage: "xmark.octagon.fill").foregroundStyle(.red).font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func resultSection(_ r: PublishProtocol.PublishResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("Published").font(.headline)
                Text("\(PublishModel.megabytes(r.bytes)) · \(r.holds) holds · \(PublishModel.duration(r.duration))")
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                Text(r.path).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle)
                    .textSelection(.enabled)
                Spacer(minLength: 8)
                Button("Reveal in Finder") { model.reveal(r.path) }.accessibilityIdentifier("publish.reveal")
                Button("Open in Browser") { model.openInBrowser(r.path) }.accessibilityIdentifier("publish.open")
            }
            warnings(r.warnings)
        }
    }

    @ViewBuilder private func warnings(_ list: [SidecarProtocol.Diagnostic]) -> some View {
        if list.isEmpty {
            Label("No private labels or speaker notes found in the public file.", systemImage: "lock.shield")
                .font(.callout).foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Label("\(list.count) warning\(list.count == 1 ? "" : "s"): check before you put this on the web", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange).font(.callout.bold())
                ForEach(Array(list.enumerated()), id: \.offset) { _, d in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(d.message).font(.callout).fixedSize(horizontal: false, vertical: true)
                        Text([d.code, d.file].compactMap { $0 }.joined(separator: " · ")).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    .padding(.leading, 22)
                }
            }
            .accessibilityIdentifier("publish.warnings")
        }
    }

    // MARK: Stage on website

    private var stageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Stage on website").font(.headline)
            Text("Copies the file to public/talks/\(pub.slug).html in each site's repository, lists the talk in src/content/talks.yaml, and links the slides from the paper in publications.yaml. Nothing is committed until you click Commit.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("Paper").frame(width: 80, alignment: .leading)
                TextField("publications.yaml id or exact title (optional)", text: Binding(get: { pub.paperEntry }, set: { pub.paperEntry = $0 }))
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("publish.paper")
            }
            ForEach(PublishProtocol.Site.allCases) { site in siteBox(site) }
        }
    }

    private func siteBox(_ site: PublishProtocol.Site) -> some View {
        let st = pub.stage(for: site)
        let repo = pub.settings.repo(site)
        return GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if let repo {
                        Text(repo).font(.caption.monospaced()).lineLimit(1).truncationMode(.head).foregroundStyle(.secondary)
                    } else {
                        Text("No repository set. Choose it in Settings (⌘,).").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button {
                        Task { await pub.stageOnSite(site) }
                    } label: {
                        if st.phase == .running && st.commit == nil && st.result == nil { ProgressView().controlSize(.small) } else { Text(st.result == nil ? "Stage" : "Stage Again") }
                    }
                    .disabled(!pub.canStage(site))
                    .accessibilityIdentifier("publish.stage.\(site.rawValue)")
                }
                if case .failed(let msg) = st.phase {
                    Label(msg, systemImage: "xmark.octagon.fill").foregroundStyle(.red).font(.callout).fixedSize(horizontal: false, vertical: true)
                }
                if let r = st.result { staged(site, r, st) }
            }
            .padding(4)
        } label: {
            Text(site.title).font(.subheadline.bold())
        }
    }

    @ViewBuilder private func staged(_ site: PublishProtocol.Site, _ r: PublishProtocol.StageResult, _ st: PublishModel.SiteStage) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(r.files) { f in
                HStack(spacing: 6) {
                    Text(f.status.rawValue).font(.caption2.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(f.status == .added ? Color.green : f.status == .modified ? Color.orange : Color.gray, in: RoundedRectangle(cornerRadius: 3))
                        .frame(width: 70, alignment: .leading)
                    Text(f.path).font(.caption.monospaced())
                }
            }
            ForEach(r.notes, id: \.self) { n in
                Label(n, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        if r.diff.isEmpty {
            Text("Nothing to change: the site already has this version.").font(.caption).foregroundStyle(.secondary)
        } else {
            ScrollView([.vertical, .horizontal]) {
                DiffText(diff: r.diff)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 150)
            .background(Color(nsColor: .textBackgroundColor), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.3)))
            .accessibilityIdentifier("publish.diff.\(site.rawValue)")
        }
        if let c = st.commit {
            VStack(alignment: .leading, spacing: 4) {
                Label("Committed \(String(c.commit.prefix(7)))", systemImage: "checkmark.seal.fill").foregroundStyle(.green).font(.callout.bold())
                Text(PublishModel.pushHint(repo: r.repo)).font(.caption).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        } else if !r.changed.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                TextField("Commit message", text: Binding(get: { st.message }, set: { pub.setCommitMessage($0, for: site) }))
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                Button("Commit in that repo") { Task { await pub.commit(site) } }
                    .disabled(!pub.canCommit(site))
                    .help("Runs git commit in \(r.repo) for the \(r.changed.count) files above. It does not push.")
                    .accessibilityIdentifier("publish.commit.\(site.rawValue)")
            }
        }
    }
}

/// A unified diff with added and removed lines tinted.
struct DiffText: View {
    let diff: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                Text(line.isEmpty ? " " : String(line))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(color(line))
                    .fixedSize()
            }
        }
    }
    private func color(_ l: Substring) -> Color {
        if l.hasPrefix("+++") || l.hasPrefix("---") || l.hasPrefix("diff ") || l.hasPrefix("index ") { return .secondary }
        if l.hasPrefix("+") { return .green }
        if l.hasPrefix("-") { return .red }
        if l.hasPrefix("@@") { return .purple }
        return .primary
    }
}

/// File ▸ Export ▸ PNGs / PDF: progress while the sidecar renders, then where the files went.
struct ExportSheet: View {
    @Bindable var model: TalkWindowModel
    var dismiss: () -> Void = {}

    var body: some View {
        let e = model.publishing.export
        VStack(alignment: .leading, spacing: 14) {
            Text(e?.kind == .pdf ? "Export PDF of Holds" : "Export PNGs of Holds").font(.title3.bold())
            if let e {
                switch e.phase {
                case .running, .idle:
                    ProgressView(value: e.fraction).accessibilityIdentifier("export.progress")
                    Text(e.label).font(.callout).foregroundStyle(.secondary)
                case .done:
                    Label(e.label, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                    if let r = e.result {
                        Text(r.kind == .pdf ? (r.files.first ?? r.dir) : r.dir).font(.caption.monospaced()).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        if !r.errors.isEmpty {
                            Label("\(r.errors.count) page error\(r.errors.count == 1 ? "" : "s") while rendering: \(r.errors[0])", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption).foregroundStyle(.orange)
                        }
                    }
                case .failed(let msg):
                    Label(msg, systemImage: "xmark.octagon.fill").foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack {
                Spacer()
                if let r = e?.result {
                    Button("Reveal in Finder") { model.reveal(r.kind == .pdf ? (r.files.first ?? r.dir) : (r.files.first ?? r.dir)) }
                    if r.kind == .pdf, let f = r.files.first { Button("Open") { NSWorkspace.shared.open(URL(fileURLWithPath: f)) } }
                }
                Button(model.publishing.exporting ? "Hide" : "Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
