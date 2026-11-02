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
            .pickerStyle(.segmented).labelsHidden().padding(.horizontal, 10).padding(.bottom, 8)
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
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
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
            Hint("Editing needs a beat-format talk (talk.json).")
        } else if !model.editMode {
            VStack(alignment: .leading, spacing: 8) {
                Hint("Turn on Edit mode to select objects on the canvas.")
                Button("Edit Canvas (⌘E)") { model.setEditMode(true) }.accessibilityIdentifier("inspector.edit-mode")
            }
        } else if let o = model.selection {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("#\(o.id)").font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    Spacer()
                    Text("<\(o.tag)>").font(.caption.monospaced()).foregroundStyle(.secondary)
                }
                Section2("Position") {
                    NumberField("X", o.left, id: "x") { model.setStyle(o.id, .px(left: $0, top: o.top)) }
                    NumberField("Y", o.top, id: "y") { model.setStyle(o.id, .px(left: o.left, top: $0)) }
                }.disabled(!o.movable)
                Section2("Size") {
                    NumberField("W", o.width, id: "w") { model.setStyle(o.id, .px(width: $0)) }
                    NumberField("H", o.height, id: "h") { model.setStyle(o.id, .px(height: $0)) }
                }.disabled(!o.movable)
                if !o.movable { Hint("Not positioned (no position:absolute), so it moves with its container.") }
                Section2("Font size") {
                    NumberField("px", o.fontSize, id: "font") { model.setStyle(o.id, .px(fontSize: $0)) }
                }
                if o.editable, let html = o.html {
                    TextCommitField(title: "Text", value: html, axis: .vertical, id: "text") { model.apply(.setText(id: o.id, html: $0)) }
                    Hint("Inline tags (<b>, <span class=…>) are kept. Double-click the text on the canvas to edit it in place.")
                }
                if o.tag == "img" {
                    TextCommitField(title: "Image source", value: o.src ?? "", id: "src") { model.apply(.setAttr(id: o.id, name: "src", value: .string($0))) }
                }
            }
        } else {
            Hint("Click an object on the canvas, or press Tab to cycle through them. Drag to move, use the handles to resize, double-click text to edit it.")
        }
    }
}

// MARK: - Beat

private struct BeatInspector: View {
    @Bindable var model: TalkWindowModel
    @State private var stretch = "1.25"

    var body: some View {
        if let cur = model.currentBeat {
            VStack(alignment: .leading, spacing: 12) {
                Text(cur.ref).font(.caption.monospaced()).foregroundStyle(.secondary)
                TextCommitField(title: "Label", value: cur.beat.label, id: "beat-label") {
                    model.apply(.setBeat(ref: cur.ref, props: BeatProps(label: $0)))
                }
                NotesEditor(model: model, ref: cur.ref, notes: cur.beat.notes ?? "")
                holdRow(cur.ref)
                Section2("Stretch motion") {
                    TextField("factor", text: $stretch).frame(width: 60).accessibilityIdentifier("inspector.stretch")
                    Button("Apply") {
                        if let f = InspectorFormat.parse(stretch), f > 0 { model.apply(.stretchBeat(ref: cur.ref, factor: f)) }
                    }
                }
                Hint("Scales the beat's literal times, durations and its hold. Computed times and helper calls are left alone.")
                Toggle("Backup beat", isOn: Binding(get: { cur.beat.backup == true }, set: { on in
                    model.apply(.setBeat(ref: cur.ref, props: BeatProps(backup: on ? .set(true) : .remove)))
                })).accessibilityIdentifier("inspector.backup")
                Toggle("Private (whole chapter)", isOn: Binding(get: { cur.chapter.private == true }, set: { on in
                    model.apply(.setChapter(chapter: cur.chapter.id, props: ChapterProps(private: on ? .set(true) : .remove)))
                })).accessibilityIdentifier("inspector.private")
            }
        } else {
            Hint(model.canEdit ? "Move the canvas to a hold to edit its beat." : "Editing needs a beat-format talk (talk.json).")
        }
    }

    @ViewBuilder private func holdRow(_ ref: String) -> some View {
        if let h = model.currentRelativeHold {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Hold").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(h.auto ? "auto" : "explicit").font(.caption).foregroundStyle(.secondary)
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
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Notes").font(.subheadline.weight(.semibold))
                Spacer()
                Text(InspectorFormat.notesSummary(draft)).font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            TextEditor(text: $draft)
                .font(.callout)
                .frame(minHeight: 120)
                .focused($focused)
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(.separator))
                .accessibilityIdentifier("inspector.notes")
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
            VStack(alignment: .leading, spacing: 12) {
                Text(ch.id).font(.caption.monospaced()).foregroundStyle(.secondary)
                TextCommitField(title: "Label", value: ch.label, id: "chapter-label") {
                    model.apply(.setChapter(chapter: ch.id, props: ChapterProps(label: $0)))
                }
                Toggle("Dark", isOn: Binding(get: { ch.dark == true }, set: { on in
                    model.apply(.setChapter(chapter: ch.id, props: ChapterProps(dark: on ? .set(true) : .remove)))
                })).accessibilityIdentifier("inspector.dark")
                Toggle("Private", isOn: Binding(get: { ch.private == true }, set: { on in
                    model.apply(.setChapter(chapter: ch.id, props: ChapterProps(private: on ? .set(true) : .remove)))
                }))
                if let scene = ch.scene { LabeledContent("Scene", value: scene).font(.callout) }
                LabeledContent("Beats", value: "\(ch.beats.count)").font(.callout)
            }
        } else {
            Hint(model.canEdit ? "Move the canvas to a hold to edit its chapter." : "Editing needs a beat-format talk (talk.json).")
        }
    }
}

// MARK: - Controls

private struct Hint: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
}

private struct Section2<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold))
            HStack(spacing: 8) { content }
        }
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
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold))
            TextField(title, text: $text, axis: axis)
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
