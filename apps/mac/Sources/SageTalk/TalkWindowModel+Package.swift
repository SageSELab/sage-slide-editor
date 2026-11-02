import AppKit
import SageTalkCore
import UniformTypeIdentifiers

// `.talk` document packages (SageTalkCore/TalkPackage.swift, docs/packaging.md): the types the
// panels use, and the offer to convert a plain talk folder. The offer is a bar under the canvas
// (never an alert at open) and File ▸ Convert to .talk Package…; nothing converts on its own.
extension TalkWindowModel {
    /// io.sagelab.talk. Declared by the app's Info.plist; when this build is not registered with
    /// Launch Services (a development build), a dynamic type for the extension stands in.
    static var talkType: UTType {
        UTType(TalkPackage.typeIdentifier) ?? UTType(filenameExtension: TalkPackage.pathExtension, conformingTo: .package) ?? .package
    }

    static let dismissedOffersKey = "talkPackageOfferDismissed.v1"

    /// The open talk is a plain beat-format folder that could become a package.
    var canConvertToPackage: Bool { talk.map(TalkPackage.canConvert) ?? false }

    /// Show the conversion bar: convertible and not dismissed for this folder.
    var offersPackageConversion: Bool {
        guard canConvertToPackage, let talk else { return false }
        return !dismissedPackageOffers.contains(talk.root.path)
    }

    /// "Not Now" on the bar: never offered again for this folder (the menu item stays).
    func dismissPackageOffer(defaults: UserDefaults = .standard) {
        guard let talk else { return }
        dismissedPackageOffers.insert(talk.root.path)
        defaults.set(Array(dismissedPackageOffers).sorted(), forKey: Self.dismissedOffersKey)
    }

    static func loadDismissedOffers(defaults: UserDefaults = .standard) -> Set<String> {
        Set(defaults.stringArray(forKey: dismissedOffersKey) ?? [])
    }

    /// The confirmation's text: what happens, and the git consequence when there is one.
    static func conversionDetails(_ folder: URL) -> String {
        let dest = TalkPackage.target(for: folder).lastPathComponent
        var text = "The folder is renamed to “\(dest)” where it is. No file inside it changes: git, Dropbox, Claude "
            + "and talkc keep working with its files. Finder shows it as a single SAGE Talk document that opens "
            + "in SAGE Talk; Show Package Contents reveals the files."
        if let repo = TalkPackage.gitRepository(containing: folder) {
            text += "\n\nThis talk is inside the git repository “\(repo.lastPathComponent)” (\(repo.path)). git will see "
                + "the rename as every file moving to \(dest)/; commit the move when you are ready."
        }
        return text
    }

    /// File ▸ Convert to .talk Package… and the bar's button: confirm, rename, reopen.
    func convertToPackage() {
        guard let talk, TalkPackage.canConvert(talk) else { return }
        let dest = TalkPackage.target(for: talk.root)
        if FileManager.default.fileExists(atPath: dest.path) {
            error = TalkPackage.ConvertError.targetExists(dest.path).localizedDescription
            return
        }
        let alert = NSAlert()
        alert.messageText = "Convert “\(talk.root.lastPathComponent)” to a .talk package?"
        alert.informativeText = Self.conversionDetails(talk.root)
        alert.addButton(withTitle: "Convert")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let gen = openGeneration
        Task {
            // Let go of the old path first: the sidecar's watcher and the thumbnail renderer.
            try? await supervisor?.client.close()
            guard gen == openGeneration else { return }
            thumbnails.close()
            do {
                open(try TalkPackage.convert(talk.root))
            } catch {
                self.error = error.localizedDescription
                open(talk.root)
            }
        }
    }
}
