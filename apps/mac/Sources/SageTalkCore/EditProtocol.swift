import Foundation

// Editing (Phase 3): talk.edit and talk.revert. Mirrors the "Editing" section of
// packages/sidecar/src/protocol.ts and docs/rpc.md. The app keeps the undo stack of inverses;
// the sidecar applies them and refuses one whose files changed since (EditConflict).

extension SidecarProtocol.Method {
    public static let edit = "talk.edit"
    public static let revert = "talk.revert"
}

extension SidecarProtocol.ErrorCode {
    public static let editFailed = -32010
    public static let editConflict = -32011
}

extension SidecarProtocol {
    /// A byte-range replacement ([start, end) UTF-16 offsets) in a talk file.
    public struct WirePatch: Codable, Equatable, Sendable {
        public var file: String
        public var range: [Int]
        public var newText: String
        public init(file: String, range: [Int], newText: String) { self.file = file; self.range = range; self.newText = newText }
    }

    /// Undoes one edit; `digests` are the sha256 of each touched file as the edit left it.
    public struct Inverse: Codable, Equatable, Sendable {
        public var patches: [WirePatch]
        public var digests: [String: String]
        public init(patches: [WirePatch] = [], digests: [String: String] = [:]) { self.patches = patches; self.digests = digests }
        public var isEmpty: Bool { patches.isEmpty }
    }

    public struct StretchSkip: Codable, Equatable, Sendable {
        public var file: String
        public var line: Int
        public var col: Int
        public var call: String
        public var reason: String
    }

    public struct StretchInfo: Codable, Equatable, Sendable {
        public var stretched: Int
        public var skipped: [StretchSkip]
    }

    public struct EditResult: Codable, Equatable, Sendable {
        public var inverse: Inverse
        public var changed: [String]
        public var ok: Bool
        public var diagnostics: [Diagnostic]
        public var holds: [WireHold]?
        public var stretch: StretchInfo?
        public init(inverse: Inverse, changed: [String], ok: Bool = true, diagnostics: [Diagnostic] = [],
                    holds: [WireHold]? = nil, stretch: StretchInfo? = nil) {
            self.inverse = inverse; self.changed = changed; self.ok = ok; self.diagnostics = diagnostics
            self.holds = holds; self.stretch = stretch
        }
    }
}

/// A value that may be set, explicitly removed (JSON null), or left out (Swift nil).
public enum Settable<Value: Codable & Equatable & Sendable>: Codable, Equatable, Sendable {
    case set(Value)
    case remove

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        self = c.decodeNil() ? .remove : .set(try c.decode(Value.self))
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .set(let v): try c.encode(v)
        case .remove: try c.encodeNil()
        }
    }
    public var value: Value? { if case .set(let v) = self { v } else { nil } }
}

/// A CSS value for setStyle: a px number or a raw CSS string.
public enum StyleValue: Codable, Equatable, Sendable {
    case px(Double)
    case css(String)
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { self = .px(d) } else { self = .css(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .px(let d): try c.encode(d)
        case .css(let s): try c.encode(s)
        }
    }
}

/// setAttr's value: a string, a bare attribute (true), or removal (null).
public enum AttrValue: Codable, Equatable, Sendable {
    case string(String)
    case bare
    case remove
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .remove }
        else if let b = try? c.decode(Bool.self), b { self = .bare }
        else { self = .string(try c.decode(String.self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .bare: try c.encode(true)
        case .remove: try c.encodeNil()
        }
    }
}

public struct StyleArgs: Codable, Equatable, Sendable {
    public var left: Settable<StyleValue>?
    public var top: Settable<StyleValue>?
    public var width: Settable<StyleValue>?
    public var height: Settable<StyleValue>?
    public var fontSize: Settable<StyleValue>?
    // Text formatting (format bar, inspector): CSS strings; fontWeight may also be a number.
    public var color: Settable<StyleValue>?
    public var textAlign: Settable<StyleValue>?
    public var fontWeight: Settable<StyleValue>?
    public var fontStyle: Settable<StyleValue>?
    public var fontFamily: Settable<StyleValue>?
    public var textDecoration: Settable<StyleValue>?
    public init(left: Settable<StyleValue>? = nil, top: Settable<StyleValue>? = nil, width: Settable<StyleValue>? = nil,
                height: Settable<StyleValue>? = nil, fontSize: Settable<StyleValue>? = nil,
                color: Settable<StyleValue>? = nil, textAlign: Settable<StyleValue>? = nil, fontWeight: Settable<StyleValue>? = nil,
                fontStyle: Settable<StyleValue>? = nil, fontFamily: Settable<StyleValue>? = nil, textDecoration: Settable<StyleValue>? = nil) {
        self.left = left; self.top = top; self.width = width; self.height = height; self.fontSize = fontSize
        self.color = color; self.textAlign = textAlign; self.fontWeight = fontWeight
        self.fontStyle = fontStyle; self.fontFamily = fontFamily; self.textDecoration = textDecoration
    }
    private enum CodingKeys: String, CodingKey { case left, top, width, height, fontSize, color, textAlign, fontWeight, fontStyle, fontFamily, textDecoration }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func v(_ k: CodingKeys) throws -> Settable<StyleValue>? { try c.decodeSettable(StyleValue.self, forKey: k) }
        self.init(left: try v(.left), top: try v(.top), width: try v(.width), height: try v(.height), fontSize: try v(.fontSize),
                  color: try v(.color), textAlign: try v(.textAlign), fontWeight: try v(.fontWeight),
                  fontStyle: try v(.fontStyle), fontFamily: try v(.fontFamily), textDecoration: try v(.textDecoration))
    }
    /// True when only text-formatting keys are set.
    public var isTextFormat: Bool {
        left == nil && top == nil && width == nil && height == nil && fontSize == nil &&
            (color != nil || textAlign != nil || fontWeight != nil || fontStyle != nil || fontFamily != nil || textDecoration != nil)
    }
    /// The undo menu's name for this style change.
    public var title: String {
        if width != nil || height != nil { return "Resize" }
        if fontSize != nil { return "Font Size" }
        if left != nil || top != nil { return "Move" }
        if fontFamily != nil { return "Font" }
        if color != nil { return "Text Color" }
        if textAlign != nil { return "Alignment" }
        if fontWeight != nil { return "Bold" }
        if fontStyle != nil { return "Italic" }
        if textDecoration != nil { return "Underline" }
        return "Style"
    }
    /// Pixel values; nil leaves a property alone.
    public static func px(left: Double? = nil, top: Double? = nil, width: Double? = nil, height: Double? = nil, fontSize: Double? = nil) -> StyleArgs {
        func v(_ d: Double?) -> Settable<StyleValue>? { d.map { .set(.px($0)) } }
        return StyleArgs(left: v(left), top: v(top), width: v(width), height: v(height), fontSize: v(fontSize))
    }
}

public struct NewBeat: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var notes: String?
    public var hold: Double?
    public init(id: String, label: String, notes: String? = nil, hold: Double? = nil) {
        self.id = id; self.label = label; self.notes = notes; self.hold = hold
    }
}

public struct BeatProps: Codable, Equatable, Sendable {
    public var label: String?
    public var backup: Settable<Bool>?
    public var dark: Settable<Bool>?
    public init(label: String? = nil, backup: Settable<Bool>? = nil, dark: Settable<Bool>? = nil) {
        self.label = label; self.backup = backup; self.dark = dark
    }
    private enum CodingKeys: String, CodingKey { case label, backup, dark }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(label: try c.decodeIfPresent(String.self, forKey: .label), backup: try c.decodeSettable(Bool.self, forKey: .backup),
                  dark: try c.decodeSettable(Bool.self, forKey: .dark))
    }
}

public struct ChapterProps: Codable, Equatable, Sendable {
    public var label: String?
    public var dark: Settable<Bool>?
    public var `private`: Settable<Bool>?
    public var backup: Settable<Bool>?
    public init(label: String? = nil, dark: Settable<Bool>? = nil, private: Settable<Bool>? = nil, backup: Settable<Bool>? = nil) {
        self.label = label; self.dark = dark; self.private = `private`; self.backup = backup
    }
    private enum CodingKeys: String, CodingKey { case label, dark, `private`, backup }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(label: try c.decodeIfPresent(String.self, forKey: .label), dark: try c.decodeSettable(Bool.self, forKey: .dark),
                  private: try c.decodeSettable(Bool.self, forKey: .private), backup: try c.decodeSettable(Bool.self, forKey: .backup))
    }
}

// Synthesized decoding turns an explicit null into nil (absent); this keeps it as `.remove`.
extension KeyedDecodingContainer {
    func decodeSettable<V>(_ type: V.Type, forKey key: Key) throws -> Settable<V>? {
        guard contains(key) else { return nil }
        return try decodeNil(forKey: key) ? .remove : .set(decode(V.self, forKey: key))
    }
}

/// One talk.edit operation (`{op, args}` on the wire).
public enum EditOp: Codable, Equatable, Sendable {
    case setText(id: String, html: String, scene: String? = nil)
    case setStyle(id: String, style: StyleArgs, scene: String? = nil)
    case setAttr(id: String, name: String, value: AttrValue, scene: String? = nil)
    case insertBeat(chapter: String, index: Int, beat: NewBeat)
    case deleteBeat(ref: String)
    case duplicateBeat(ref: String, newId: String, label: String? = nil)
    case moveBeat(ref: String, chapter: String, index: Int)
    case setHold(ref: String, hold: Double?)
    case setNotes(ref: String, notes: String?)
    case stretchBeat(ref: String, factor: Double)
    case setBeat(ref: String, props: BeatProps)
    case setChapter(chapter: String, props: ChapterProps)

    public var name: String {
        switch self {
        case .setText: "setText"
        case .setStyle: "setStyle"
        case .setAttr: "setAttr"
        case .insertBeat: "insertBeat"
        case .deleteBeat: "deleteBeat"
        case .duplicateBeat: "duplicateBeat"
        case .moveBeat: "moveBeat"
        case .setHold: "setHold"
        case .setNotes: "setNotes"
        case .stretchBeat: "stretchBeat"
        case .setBeat: "setBeat"
        case .setChapter: "setChapter"
        }
    }

    public static let allNames = ["setText", "setStyle", "setAttr", "insertBeat", "deleteBeat", "duplicateBeat", "moveBeat",
                                  "setHold", "setNotes", "stretchBeat", "setBeat", "setChapter"]

    private enum K: String, CodingKey { case op, args }
    private enum A: String, CodingKey {
        case id, html, scene, style, name, value, chapter, index, beat, ref, newId, label, hold, notes, factor, props
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let op = try c.decode(String.self, forKey: .op)
        let a = try c.nestedContainer(keyedBy: A.self, forKey: .args)
        switch op {
        case "setText": self = .setText(id: try a.decode(String.self, forKey: .id), html: try a.decode(String.self, forKey: .html), scene: try a.decodeIfPresent(String.self, forKey: .scene))
        case "setStyle": self = .setStyle(id: try a.decode(String.self, forKey: .id), style: try a.decode(StyleArgs.self, forKey: .style), scene: try a.decodeIfPresent(String.self, forKey: .scene))
        case "setAttr": self = .setAttr(id: try a.decode(String.self, forKey: .id), name: try a.decode(String.self, forKey: .name), value: try a.decode(AttrValue.self, forKey: .value), scene: try a.decodeIfPresent(String.self, forKey: .scene))
        case "insertBeat": self = .insertBeat(chapter: try a.decode(String.self, forKey: .chapter), index: try a.decode(Int.self, forKey: .index), beat: try a.decode(NewBeat.self, forKey: .beat))
        case "deleteBeat": self = .deleteBeat(ref: try a.decode(String.self, forKey: .ref))
        case "duplicateBeat": self = .duplicateBeat(ref: try a.decode(String.self, forKey: .ref), newId: try a.decode(String.self, forKey: .newId), label: try a.decodeIfPresent(String.self, forKey: .label))
        case "moveBeat": self = .moveBeat(ref: try a.decode(String.self, forKey: .ref), chapter: try a.decode(String.self, forKey: .chapter), index: try a.decode(Int.self, forKey: .index))
        case "setHold": self = .setHold(ref: try a.decode(String.self, forKey: .ref), hold: try a.decode(Double?.self, forKey: .hold))
        case "setNotes": self = .setNotes(ref: try a.decode(String.self, forKey: .ref), notes: try a.decode(String?.self, forKey: .notes))
        case "stretchBeat": self = .stretchBeat(ref: try a.decode(String.self, forKey: .ref), factor: try a.decode(Double.self, forKey: .factor))
        case "setBeat": self = .setBeat(ref: try a.decode(String.self, forKey: .ref), props: try a.decode(BeatProps.self, forKey: .props))
        case "setChapter": self = .setChapter(chapter: try a.decode(String.self, forKey: .chapter), props: try a.decode(ChapterProps.self, forKey: .props))
        default: throw DecodingError.dataCorruptedError(forKey: .op, in: c, debugDescription: "unknown edit op \(op)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(name, forKey: .op)
        var a = c.nestedContainer(keyedBy: A.self, forKey: .args)
        switch self {
        case .setText(let id, let html, let scene):
            try a.encode(id, forKey: .id); try a.encode(html, forKey: .html); try a.encodeIfPresent(scene, forKey: .scene)
        case .setStyle(let id, let style, let scene):
            try a.encode(id, forKey: .id); try a.encode(style, forKey: .style); try a.encodeIfPresent(scene, forKey: .scene)
        case .setAttr(let id, let name, let value, let scene):
            try a.encode(id, forKey: .id); try a.encode(name, forKey: .name); try a.encode(value, forKey: .value)
            try a.encodeIfPresent(scene, forKey: .scene)
        case .insertBeat(let chapter, let index, let beat):
            try a.encode(chapter, forKey: .chapter); try a.encode(index, forKey: .index); try a.encode(beat, forKey: .beat)
        case .deleteBeat(let ref):
            try a.encode(ref, forKey: .ref)
        case .duplicateBeat(let ref, let newId, let label):
            try a.encode(ref, forKey: .ref); try a.encode(newId, forKey: .newId); try a.encodeIfPresent(label, forKey: .label)
        case .moveBeat(let ref, let chapter, let index):
            try a.encode(ref, forKey: .ref); try a.encode(chapter, forKey: .chapter); try a.encode(index, forKey: .index)
        case .setHold(let ref, let hold):
            try a.encode(ref, forKey: .ref); try a.encode(hold, forKey: .hold)
        case .setNotes(let ref, let notes):
            try a.encode(ref, forKey: .ref); try a.encode(notes, forKey: .notes)
        case .stretchBeat(let ref, let factor):
            try a.encode(ref, forKey: .ref); try a.encode(factor, forKey: .factor)
        case .setBeat(let ref, let props):
            try a.encode(ref, forKey: .ref); try a.encode(props, forKey: .props)
        case .setChapter(let chapter, let props):
            try a.encode(chapter, forKey: .chapter); try a.encode(props, forKey: .props)
        }
    }

    /// The undo menu's name for this edit ("Undo Move", "Undo Set Hold").
    public var title: String {
        switch self {
        case .setText: "Edit Text"
        case .setStyle(_, let s, _): s.title
        case .setAttr(_, let name, _, _): name == "src" ? "Replace Image" : "Set Attribute"
        case .insertBeat: "Insert Beat"
        case .deleteBeat: "Delete Beat"
        case .duplicateBeat: "Duplicate Beat"
        case .moveBeat: "Move Beat"
        case .setHold: "Set Hold"
        case .setNotes: "Edit Notes"
        case .stretchBeat: "Stretch Beat"
        case .setBeat: "Beat Settings"
        case .setChapter: "Chapter Settings"
        }
    }
}

extension SidecarClient {
    /// talk.edit: applies one edit and rebuilds (the build can take a while on a large talk).
    public func edit(_ op: EditOp) async throws -> SidecarProtocol.EditResult {
        try await call(SidecarProtocol.Method.edit, op, timeout: .seconds(120))
    }

    /// talk.revert: applies an inverse; throws `.remote` with `editConflict` if a file changed since.
    public func revert(_ inverse: SidecarProtocol.Inverse) async throws -> SidecarProtocol.EditResult {
        try await call(SidecarProtocol.Method.revert, inverse, timeout: .seconds(120))
    }
}
