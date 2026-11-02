import SageTalkCore
import SwiftUI

/// The navigator's beat menu (PLAN 5.2): insert, duplicate, delete, move within the chapter.
struct BeatMenu: View {
    let model: TalkWindowModel
    let hold: Hold

    var body: some View {
        if let ref = hold.beat, let spine = model.spine, model.canEdit {
            Button("Insert Empty Beat After") { model.beatOp({ BeatOps.insertAfter($0, in: $1) }, hold) }
            Button("Duplicate Beat") { model.beatOp({ BeatOps.duplicate($0, in: $1) }, hold) }
            Divider()
            Button("Move Up") { model.beatOp({ BeatOps.move($0, by: -1, in: $1) }, hold) }
                .disabled(BeatOps.move(ref, by: -1, in: spine) == nil)
            Button("Move Down") { model.beatOp({ BeatOps.move($0, by: 1, in: $1) }, hold) }
                .disabled(BeatOps.move(ref, by: 1, in: spine) == nil)
            Divider()
            Button("Delete Beat", role: .destructive) { model.beatOp({ BeatOps.delete($0, in: $1) }, hold) }
        } else {
            Text(model.canEdit ? "This hold has no beat in talk.json" : "Read-only talk")
        }
    }
}

/// The toolbar's Edit toggle (⌘E in the Edit menu).
struct EditModeButton: View {
    @Bindable var model: TalkWindowModel

    var body: some View {
        Toggle(isOn: Binding(get: { model.editMode }, set: { model.setEditMode($0) })) {
            Label("Edit", systemImage: "cursorarrow.rays")
        }
        .toggleStyle(.button)
        .disabled(!model.canEdit)
        .help(model.editMode ? "Stop editing the canvas (⌘E)" : "Edit the canvas: select, move, resize, edit text (⌘E)")
        .accessibilityIdentifier("toolbar.edit-mode")
    }
}
