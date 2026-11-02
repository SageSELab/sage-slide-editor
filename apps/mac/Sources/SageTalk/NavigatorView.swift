import SageTalkCore
import SwiftUI

/// Holds grouped by chapter with collapsible headers, dark chapters tinted, backups last, and a
/// thumbnail per hold (PLAN 5.2).
struct NavigatorView: View {
    @Bindable var model: TalkWindowModel

    static let darkTint = Color(red: 0.16, green: 0.13, blue: 0.30)

    var body: some View {
        ScrollViewReader { proxy in
            List(selection: Binding(get: { model.selectedHold }, set: { model.select($0) })) {
                ForEach(model.sections) { section in
                    Section(isExpanded: expanded(section.id)) {
                        ForEach(section.holds) { h in
                            HoldRow(hold: h, dark: section.dark, thumbnails: model.thumbnails)
                                .tag(h.id)
                                .id(h.id)
                                .listRowBackground(section.dark ? Self.darkTint.opacity(0.55) : nil)
                        }
                    } header: {
                        SectionHeader(section: section)
                    }
                }
            }
            .listStyle(.sidebar)
            .accessibilityIdentifier("navigator")
            .onChange(of: model.selectedHold) { _, id in
                guard let id else { return }
                if let s = NavigatorGrouping.section(containing: id, in: model.sections), model.collapsed.contains(s) { return }
                withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id) }
            }
        }
    }

    private func expanded(_ id: String) -> Binding<Bool> {
        Binding(get: { !model.collapsed.contains(id) },
                set: { open in if open { model.collapsed.remove(id) } else { model.collapsed.insert(id) } })
    }
}

private struct SectionHeader: View {
    let section: NavigatorSection
    var body: some View {
        HStack(spacing: 6) {
            if section.isBackup { Image(systemName: "tray.full") }
            else if section.dark { Image(systemName: "moon.fill").foregroundStyle(.purple) }
            Text(section.title).lineLimit(1)
            Spacer()
            Text("\(section.holds.count)").monospacedDigit().foregroundStyle(.secondary)
        }
        .font(.subheadline.weight(.semibold))
    }
}

private struct HoldRow: View {
    let hold: Hold
    let dark: Bool
    let thumbnails: ThumbnailStore

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            thumbnail
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(hold.backup ? "B" : "\(hold.index)")
                    .monospacedDigit().foregroundStyle(.secondary)
                Text(hold.label.isEmpty ? "Untitled" : hold.label).lineLimit(1)
                Spacer(minLength: 4)
                Text(HoldTimeline.format(hold.at)).font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            .font(.callout)
        }
        .padding(.vertical, 4)
        .onAppear { thumbnails.request(hold) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Hold \(hold.index), \(hold.label)")
    }

    @ViewBuilder private var thumbnail: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 4).fill(dark ? Color.black : Color(white: 0.92))
            if let img = thumbnails.image(for: hold) {
                Image(nsImage: img).resizable().interpolation(.high)
                    .opacity(thumbnails.isFresh(hold) ? 1 : 0.55)
            }
            if !thumbnails.isFresh(hold) { ProgressView().controlSize(.small) }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(.separator, lineWidth: 0.5))
    }
}
