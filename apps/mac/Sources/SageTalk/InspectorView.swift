import SageTalkCore
import SwiftUI

/// The inspector (PLAN 5.4): Object, Beat and Chapter tabs. Every change is one talk.edit,
/// written at once; the canvas reloads at the same time with the same selection.
struct InspectorView: View {
    @Bindable var model: TalkWindowModel
    @State private var tab: Tab = .object

    enum Tab: String, CaseIterable { case object = "Object", beat = "Beat", chapter = "Chapter" }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden().controlSize(.large)
            .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 10)
            .accessibilityIdentifier("inspector.tabs")
            Divider()
            ScrollView {
                Group {
                    switch tab {
                    case .object: ObjectInspector(model: model)
                    case .beat: BeatInspector(model: model)
                    case .chapter: ChapterInspector(model: model)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(nsColor: .windowBackgroundColor))
            if let e = model.edits.lastError {
                Divider()
                Label(e, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("inspector.error")
            }
        }
        .onChange(of: model.selection?.id) { _, id in if id != nil { tab = .object } }
    }
}

// MARK: - Object

private struct ObjectInspector: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        if !model.canEdit {
            EmptyHint("Read-only talk", systemImage: "lock", "Editing needs a beat-format talk (talk.json).")
        } else if let o = model.selection {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 8) {
                    Text(CanvasObject.describe(o.id)).font(.system(.body, design: .monospaced).weight(.medium)).textSelection(.enabled)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Text(o.tag).font(.caption.monospaced().weight(.medium)).foregroundStyle(.secondary)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(.quaternary))
                }
                InspectorSection("Arrange", systemImage: "arrow.up.and.down.and.arrow.left.and.right") {
                    Row("Position") {
                        NumberField("X", o.left, id: "x") { model.setStyle(o.id, .px(left: $0, top: o.top)) }
                        NumberField("Y", o.top, id: "y") { model.setStyle(o.id, .px(left: o.left, top: $0)) }
                    }.disabled(!o.movable)
                    Row("Size") {
                        NumberField("W", o.width, id: "w") { model.setStyle(o.id, .px(width: $0)) }
                        NumberField("H", o.height, id: "h") { model.setStyle(o.id, .px(height: $0)) }
                    }.disabled(!o.movable)
                    if !o.movable { Hint("Not positioned (no position:absolute), so it moves with its container.") }
                }
                InspectorSection("Text", systemImage: "textformat") {
                    if o.editable {
                        Row("Style") {
                            TextStyleToggles(model: model)
                            TextColorWell(model: model)
                        }
                    }
                    Row("Size") { NumberField("px", o.fontSize, id: "font") { model.setStyle(o.id, .px(fontSize: $0)) } }
                    if o.editable {
                        Row("Align") { AlignmentPicker(model: model, object: o) }
                        Row("Font") { FontButton(model: model, object: o) }
                    }
                    if o.editable, let html = o.html {
                        TextCommitField(title: "Content", value: html, axis: .vertical, id: "text") { model.apply(.setText(id: o.id, html: $0)) }
                        Hint("Inline tags (<b>, <span class=…>) are kept. Click the selected text on the canvas, or just type, to edit it in place; select words to make only them bold or coloured.")
                    }
                }
                if o.tag == "img" {
                    InspectorSection("Image", systemImage: "photo") {
                        TextCommitField(title: "Source", value: o.src ?? "", id: "src") { model.apply(.setAttr(id: o.id, name: "src", value: .string($0))) }
                    }
                }
            }
        } else {
            EmptyHint("Nothing selected", systemImage: "cursorarrow.click.2",
                      "Pause the film and click an object on the canvas, or press Tab to cycle through them. Drag to move, use the handles to resize, click selected text to type in it.")
        }
    }
}

// MARK: - Beat

private struct BeatInspector: View {
    @Bindable var model: TalkWindowModel
    @State private var stretch = "1.25"

    var body: some View {
        if let cur = model.currentBeat {
            VStack(alignment: .leading, spacing: 18) {
                InspectorSection("Beat", systemImage: "rectangle.stack", detail: cur.ref) {
                    TextCommitField(title: "Label", value: cur.beat.label, id: "beat-label") {
                        model.apply(.setBeat(ref: cur.ref, props: BeatProps(label: $0)))
                    }
                }
                InspectorSection("Timing", systemImage: "timer") {
                    holdRow(cur.ref)
                    Divider()
                    Row("Stretch") {
                        TextField("factor", text: $stretch).frame(width: 56).multilineTextAlignment(.trailing)
                            .textFieldStyle(.roundedBorder).accessibilityIdentifier("inspector.stretch")
                        Text("×").foregroundStyle(.secondary)
                        Button("Apply") {
                            if let f = InspectorFormat.parse(stretch), f > 0 { model.apply(.stretchBeat(ref: cur.ref, factor: f)) }
                        }
                    }
                    Hint("Scales the beat's literal times, durations and its hold. Computed times and helper calls are left alone.")
                }
                InspectorSection("Speaker Notes", systemImage: "text.bubble") {
                    NotesEditor(model: model, ref: cur.ref, notes: cur.beat.notes ?? "")
                }
                InspectorSection("Visibility", systemImage: "eye") {
                    Toggle("Backup beat", isOn: Binding(get: { cur.beat.backup == true }, set: { on in
                        model.apply(.setBeat(ref: cur.ref, props: BeatProps(backup: on ? .set(true) : .remove)))
                    })).toggleStyle(.switch).controlSize(.small).accessibilityIdentifier("inspector.backup")
                    Toggle("Private (whole chapter)", isOn: Binding(get: { cur.chapter.private == true }, set: { on in
                        model.apply(.setChapter(chapter: cur.chapter.id, props: ChapterProps(private: on ? .set(true) : .remove)))
                    })).toggleStyle(.switch).controlSize(.small).accessibilityIdentifier("inspector.private")
                }
            }
        } else {
            EmptyHint("No beat here", systemImage: "rectangle.stack",
                      model.canEdit ? "Move the canvas to a hold to edit its beat." : "Editing needs a beat-format talk (talk.json).")
        }
    }

    @ViewBuilder private func holdRow(_ ref: String) -> some View {
        if let h = model.currentRelativeHold {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    FieldLabel("Hold")
                    Spacer()
                    Text(h.auto ? "Auto" : "Explicit").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(.quaternary))
                }
                HStack(spacing: 4) {
                    ForEach([-0.5, -0.1], id: \.self) { d in nudge(ref, h.value, d) }
                    NumberField("s", h.value, id: "hold") { model.apply(.setHold(ref: ref, hold: max(0, $0))) }
                    ForEach([0.1, 0.5], id: \.self) { d in nudge(ref, h.value, d) }
                    if !h.auto {
                        Button("Auto") { model.apply(.setHold(ref: ref, hold: nil)) }.help("Remove the explicit hold")
                    }
                }
                Hint("Seconds after the beat starts (the previous hold).")
            }
        }
    }

    private func nudge(_ ref: String, _ value: Double, _ d: Double) -> some View {
        Button(d > 0 ? "+\(InspectorFormat.number(d))" : InspectorFormat.number(d)) {
            model.apply(.setHold(ref: ref, hold: InspectorFormat.nudged(value, by: d)))
        }
        .controlSize(.small)
        .accessibilityIdentifier("inspector.hold\(d > 0 ? "+" : "")\(InspectorFormat.number(d))")
    }
}

/// Speaker notes: saved a second after typing stops, or when the beat changes.
private struct NotesEditor: View {
    @Bindable var model: TalkWindowModel
    let ref: String
    let notes: String
    @State private var draft = ""
    @State private var draftRef = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextEditor(text: $draft)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(6)
                .frame(minHeight: 140)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color(nsColor: .textBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator))
                .focused($focused)
                .accessibilityIdentifier("inspector.notes")
            Text(InspectorFormat.notesSummary(draft)).font(.caption).monospacedDigit().foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .onAppear { draft = notes; draftRef = ref }
        .onChange(of: ref) { old, new in
            save(old)
            draft = notes; draftRef = new
        }
        .onChange(of: notes) { _, n in if !focused { draft = n } }
        .task(id: draft) {
            try? await Task.sleep(for: .seconds(1))
            if !Task.isCancelled { save(draftRef) }
        }
    }

    private func save(_ forRef: String) {
        guard forRef == draftRef, let cur = model.spine?.locate(forRef), draft != (cur.beat.notes ?? "") else { return }
        model.apply(.setNotes(ref: forRef, notes: draft.isEmpty ? nil : draft))
    }
}

// MARK: - Chapter

private struct ChapterInspector: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        if let ch = model.currentBeat?.chapter {
            VStack(alignment: .leading, spacing: 18) {
                InspectorSection("Chapter", systemImage: "book.pages", detail: ch.id) {
                    TextCommitField(title: "Label", value: ch.label, id: "chapter-label") {
                        model.apply(.setChapter(chapter: ch.id, props: ChapterProps(label: $0)))
                    }
                }
                InspectorSection("Appearance", systemImage: "circle.lefthalf.filled") {
                    Toggle("Dark passage", isOn: Binding(get: { ch.dark == true }, set: { on in
                        model.apply(.setChapter(chapter: ch.id, props: ChapterProps(dark: on ? .set(true) : .remove)))
                    })).toggleStyle(.switch).controlSize(.small).accessibilityIdentifier("inspector.dark")
                    Toggle("Private (left out of the public build)", isOn: Binding(get: { ch.private == true }, set: { on in
                        model.apply(.setChapter(chapter: ch.id, props: ChapterProps(private: on ? .set(true) : .remove)))
                    })).toggleStyle(.switch).controlSize(.small)
                }
                InspectorSection("Info", systemImage: "info.circle") {
                    if let scene = ch.scene { Row("Scene") { Text(scene).font(.callout.monospaced()).textSelection(.enabled) } }
                    Row("Beats") { Text("\(ch.beats.count)").font(.callout).monospacedDigit() }
                }
            }
        } else {
            EmptyHint("No chapter here", systemImage: "book.pages",
                      model.canEdit ? "Move the canvas to a hold to edit its chapter." : "Editing needs a beat-format talk (talk.json).")
        }
    }
}

// MARK: - Controls

private struct Hint: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
}

/// A titled group: a readable header (icon, title, optional detail such as the beat id) over a
/// rounded card holding the section's rows.
private struct InspectorSection<Content: View>: View {
    let title: String
    let systemImage: String
    var detail: String?
    @ViewBuilder let content: Content
    init(_ title: String, systemImage: String, detail: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.systemImage = systemImage; self.detail = detail; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: systemImage).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                Spacer(minLength: 8)
                if let detail {
                    Text(detail).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            .padding(.horizontal, 2)
            VStack(alignment: .leading, spacing: 10) { content }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color(nsColor: .controlBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.primary.opacity(0.08)))
        }
    }
}

/// A row with a fixed-width label column, so fields line up across a section.
private struct Row<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content
    init(_ label: String, @ViewBuilder content: () -> Content) { self.label = label; self.content = content() }
    var body: some View {
        HStack(spacing: 8) {
            FieldLabel(label).frame(width: 58, alignment: .leading)
            content
            Spacer(minLength: 0)
        }
    }
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.callout.weight(.medium)).foregroundStyle(.primary.opacity(0.85)) }
}

/// The empty state of a tab: an icon, a title and a short explanation, centred.
private struct EmptyHint<Actions: View>: View {
    let title: String
    let systemImage: String
    let message: String
    @ViewBuilder let actions: Actions
    init(_ title: String, systemImage: String, _ message: String, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        self.title = title; self.systemImage = systemImage; self.message = message; self.actions = actions()
    }
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: systemImage).font(.system(size: 28, weight: .light)).foregroundStyle(.tertiary)
            Text(title).font(.headline)
            Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            actions
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 36).padding(.horizontal, 8)
    }
}

/// A number field that commits on Return or when it loses focus, and follows the model.
private struct NumberField: View {
    let label: String
    let value: Double
    let id: String
    let commit: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    init(_ label: String, _ value: Double, id: String, commit: @escaping (Double) -> Void) {
        self.label = label; self.value = value; self.id = id; self.commit = commit
    }

    var body: some View {
        HStack(spacing: 3) {
            TextField(label, text: $text)
                .textFieldStyle(.roundedBorder)
                .frame(width: 64)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .focused($focused)
                .onSubmit(send)
                .accessibilityIdentifier("inspector.\(id)")
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .onAppear { text = InspectorFormat.number(value) }
        .onChange(of: value) { _, v in text = InspectorFormat.number(v) }
        .onChange(of: focused) { _, f in if !f { send() } }
    }

    private func send() {
        guard let v = InspectorFormat.parse(text) else { text = InspectorFormat.number(value); return }
        if abs(v - value) > 1e-9 { commit(v) }
    }
}

/// A text field that commits on Return or when it loses focus.
private struct TextCommitField: View {
    let title: String
    let value: String
    var axis: Axis = .horizontal
    let id: String
    let commit: (String) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            FieldLabel(title)
            TextField(title, text: $text, axis: axis)
                .textFieldStyle(.roundedBorder)
                .lineLimit(axis == .vertical ? 2...6 : 1...1)
                .focused($focused)
                .onSubmit(send)
                .accessibilityIdentifier("inspector.\(id)")
        }
        .onAppear { text = value }
        .onChange(of: value) { _, v in text = v }
        .onChange(of: focused) { _, f in if !f { send() } }
    }

    private func send() { if text != value { commit(text) } }
}
