import Foundation

// AppKit-free models behind the inspector, the canvas bridge and the navigator's beat menu
// (PLAN 5.2, 5.4): the spine as the inspector reads it, the canvas overlay's messages, field
// formatting, and beat operations as talk.edit ops.

// MARK: - The spine (talk.json) as the inspector reads it

public struct SpineSnapshot: Codable, Equatable, Sendable {
    public struct Beat: Codable, Equatable, Sendable {
        public var id: String
        public var label: String
        public var notes: String?
        public var hold: Double?
        public var backup: Bool?
        public var dark: Bool?
    }
    public struct Chapter: Codable, Equatable, Sendable {
        public var id: String
        public var label: String
        public var scene: String?
        public var motion: String?
        public var dark: Bool?
        public var `private`: Bool?
        public var backup: Bool?
        public var beats: [Beat]
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            label = try c.decodeIfPresent(String.self, forKey: .label) ?? id
            scene = try c.decodeIfPresent(String.self, forKey: .scene)
            motion = try c.decodeIfPresent(String.self, forKey: .motion)
            dark = try c.decodeIfPresent(Bool.self, forKey: .dark)
            `private` = try c.decodeIfPresent(Bool.self, forKey: .private)
            backup = try c.decodeIfPresent(Bool.self, forKey: .backup)
            beats = try c.decodeIfPresent([Beat].self, forKey: .beats) ?? []
        }
    }

    public var chapters: [Chapter]

    public static func load(_ talkRoot: URL) -> SpineSnapshot? {
        guard let data = try? Data(contentsOf: talkRoot.appendingPathComponent("talk.json")) else { return nil }
        return try? JSONDecoder().decode(SpineSnapshot.self, from: data)
    }

    /// A beat by `chapter.beat` ref, with its chapter and position.
    public func locate(_ ref: String) -> (chapter: Chapter, index: Int, beat: Beat)? {
        let parts = ref.split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2, let ch = chapters.first(where: { $0.id == parts[0] }),
              let i = ch.beats.firstIndex(where: { $0.id == parts[1] }) else { return nil }
        return (ch, i, ch.beats[i])
    }

    public func chapter(_ id: String) -> Chapter? { chapters.first(where: { $0.id == id }) }

    /// Every beat ref, in talk order.
    public var refs: [String] { chapters.flatMap { c in c.beats.map { "\(c.id).\($0.id)" } } }

    /// Beats whose spine entry is new or differs between two snapshots.
    public static func changedBeats(from old: SpineSnapshot?, to new: SpineSnapshot) -> Set<String> {
        guard let old else { return [] }
        var before: [String: Beat] = [:]
        for c in old.chapters { for b in c.beats { before["\(c.id).\(b.id)"] = b } }
        var out: Set<String> = []
        for c in new.chapters { for b in c.beats where before["\(c.id).\(b.id)"] != b { out.insert("\(c.id).\(b.id)") } }
        return out
    }

    /// Beats whose chapter owns one of `paths` (its scene or motion file).
    public func beats(touching paths: [String]) -> Set<String> {
        var out: Set<String> = []
        for c in chapters {
            let files = [c.scene, c.motion ?? "beats/\(c.id).js"].compactMap { $0 }
            if paths.contains(where: files.contains) { for b in c.beats { out.insert("\(c.id).\(b.id)") } }
        }
        return out
    }
}

// MARK: - Canvas overlay messages (packages/engine/src/canvas.js)

/// The selected object as the canvas reports it (stage px).
public struct CanvasObject: Codable, Equatable, Sendable {
    public var id: String
    public var tag: String
    public var left: Double
    public var top: Double
    public var width: Double
    public var height: Double
    public var fontSize: Double
    public var movable: Bool
    public var editable: Bool
    public var html: String?
    public var src: String?
    /// Where the element is in the canvas web view (points, top-left origin): the format bar floats there.
    public var rect: CanvasRect?
    /// Its computed text formatting.
    public var text: CanvasTextInfo?
    public init(id: String, tag: String = "div", left: Double = 0, top: Double = 0, width: Double = 0, height: Double = 0,
                fontSize: Double = 16, movable: Bool = true, editable: Bool = false, html: String? = nil, src: String? = nil,
                rect: CanvasRect? = nil, text: CanvasTextInfo? = nil) {
        self.id = id; self.tag = tag; self.left = left; self.top = top; self.width = width; self.height = height
        self.fontSize = fontSize; self.movable = movable; self.editable = editable; self.html = html; self.src = src
        self.rect = rect; self.text = text
    }

    /// How the inspector names an object: `#c1-eye`, or for an element without an id (an
    /// address, `g1>div.t`) the last step inside its named ancestor: `div.t in #g1`.
    public static func describe(_ id: String) -> String {
        let parts = id.split(separator: ">", omittingEmptySubsequences: false)
        guard parts.count > 1, let base = parts.first, let last = parts.last else { return "#\(id)" }
        return "\(last.split(separator: ":").first ?? last) in #\(base)"
    }
}

/// A box in the canvas web view's coordinates (CSS px = points, top-left origin).
public struct CanvasRect: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var w: Double
    public var h: Double
    public init(x: Double, y: Double, w: Double, h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
}

/// An element's computed text formatting, as the canvas reports it.
public struct CanvasTextInfo: Codable, Equatable, Sendable {
    public var bold: Bool
    public var italic: Bool
    public var underline: Bool
    /// "#rrggbb" (or the browser's CSS colour when it has transparency).
    public var color: String
    /// left, center, right or justify.
    public var align: String
    public var family: String
    public init(bold: Bool = false, italic: Bool = false, underline: Bool = false, color: String = "#000000", align: String = "left", family: String = "") {
        self.bold = bold; self.italic = italic; self.underline = underline; self.color = color; self.align = align; self.family = family
    }
}

/// The formatting at the text selection while the caret is in an element's text.
public struct CanvasTextState: Codable, Equatable, Sendable {
    public var id: String
    public var bold: Bool
    public var italic: Bool
    public var underline: Bool
    public var color: String
    /// A range is selected (format commands apply to it inline), not just a caret.
    public var range: Bool
    public init(id: String, bold: Bool = false, italic: Bool = false, underline: Bool = false, color: String = "", range: Bool = false) {
        self.id = id; self.bold = bold; self.italic = italic; self.underline = underline; self.color = color; self.range = range
    }
}

/// A format-bar command for SageCanvas.format(cmd, value).
public enum CanvasFormat: Equatable, Sendable {
    case bold, italic, underline
    case color(String)
    case align(String)
    case fontSize(Double)
    case fontFamily(String)

    public var command: String {
        switch self {
        case .bold: "bold"
        case .italic: "italic"
        case .underline: "underline"
        case .color: "color"
        case .align: "align"
        case .fontSize: "fontSize"
        case .fontFamily: "fontFamily"
        }
    }

    /// The command's value (a CSS string or a px number), or nil for the toggles.
    public var value: (any Sendable)? {
        switch self {
        case .bold, .italic, .underline: nil
        case .color(let s), .align(let s), .fontFamily(let s): s
        case .fontSize(let d): d
        }
    }
}

public enum CanvasMessage: Equatable, Sendable {
    case select(CanvasObject?)
    case move(id: String, left: Double, top: Double)
    case resize(id: String, left: Double, top: Double, width: Double, height: Double)
    case text(id: String, html: String)
    /// A format command for the whole element (already applied in the page).
    case style(id: String, style: StyleArgs)
    /// The caret went into #id's text (nil: left it).
    case editing(id: String?)
    case format(CanvasTextState)
    case rect(id: String, rect: CanvasRect)
    case refused(id: String, reason: String)
    /// The film started (true) or stopped (false) playing: the overlay stepped aside or came
    /// back. Sent at once, so the app does not wait for the film's own progress messages.
    case playing(Bool)

    /// Parses a `{kind: 'canvas', type, ...}` message body (nil for anything else).
    public static func parse(_ body: [String: Any]) -> CanvasMessage? {
        guard let type = body["type"] as? String else { return nil }
        func num(_ k: String) -> Double? { (body[k] as? NSNumber)?.doubleValue }
        let id = body["id"] as? String
        switch type {
        case "select":
            guard let id else { return .select(nil) }
            var clean = body
            clean.removeValue(forKey: "kind"); clean.removeValue(forKey: "type")
            for k in ["html", "src"] where clean[k] is NSNull { clean.removeValue(forKey: k) }
            guard let data = try? JSONSerialization.data(withJSONObject: clean),
                  let obj = try? JSONDecoder().decode(CanvasObject.self, from: data), obj.id == id else { return nil }
            return .select(obj)
        case "move":
            guard let id, let l = num("left"), let t = num("top") else { return nil }
            return .move(id: id, left: l, top: t)
        case "resize":
            guard let id, let l = num("left"), let t = num("top"), let w = num("width"), let h = num("height") else { return nil }
            return .resize(id: id, left: l, top: t, width: w, height: h)
        case "text":
            guard let id, let html = body["html"] as? String else { return nil }
            return .text(id: id, html: html)
        case "style":
            guard let id, let raw = body["style"] as? [String: Any], !raw.isEmpty,
                  let style: StyleArgs = decode(raw) else { return nil }
            return .style(id: id, style: style)
        case "editing":
            return .editing(id: id)
        case "format":
            guard id != nil, let state: CanvasTextState = decode(body.filter { $0.key != "kind" && $0.key != "type" }) else { return nil }
            return .format(state)
        case "rect":
            guard let id, let raw = body["rect"] as? [String: Any], let rect: CanvasRect = decode(raw) else { return nil }
            return .rect(id: id, rect: rect)
        case "refused":
            guard let id else { return nil }
            return .refused(id: id, reason: body["reason"] as? String ?? "")
        case "playing":
            guard let p = body["playing"] as? Bool else { return nil }
            return .playing(p)
        default: return nil
        }
    }

    private static func decode<T: Decodable>(_ dict: [String: Any]) -> T? {
        guard let data = try? JSONSerialization.data(withJSONObject: dict) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    /// The source edit a canvas change asks for.
    public var editOp: EditOp? {
        switch self {
        case .select, .refused, .editing, .format, .rect, .playing: nil
        case .move(let id, let l, let t): .setStyle(id: id, style: .px(left: l, top: t))
        case .resize(let id, let l, let t, let w, let h): .setStyle(id: id, style: .px(left: l, top: t, width: w, height: h))
        case .text(let id, let html): .setText(id: id, html: html)
        case .style(let id, let style): .setStyle(id: id, style: style)
        }
    }
}

// MARK: - Field formatting

public enum InspectorFormat {
    /// Whole numbers without decimals, others with up to two ("120", "120.5", "0.25").
    public static func number(_ v: Double) -> String {
        guard v.isFinite else { return "" }
        let r = (v * 100).rounded() / 100
        if r == r.rounded() { return String(Int(r)) }
        var s = String(format: "%.2f", r)
        while s.hasSuffix("0") { s.removeLast() }
        return s
    }

    /// Parses a number typed into a field: "120", " 120.5 ", "120px", "1.5s", "1,5" (nil otherwise).
    public static func parse(_ text: String) -> Double? {
        var s = text.trimmingCharacters(in: .whitespaces).lowercased()
        for unit in ["px", "s", "×", "x"] where s.hasSuffix(unit) { s = String(s.dropLast(unit.count)).trimmingCharacters(in: .whitespaces) }
        s = s.replacingOccurrences(of: ",", with: ".")
        guard let v = Double(s), v.isFinite else { return nil }
        return v
    }

    /// Hold seconds as shown in the inspector ("5.5 s").
    public static func seconds(_ v: Double) -> String { "\(number(v)) s" }

    /// Words in speaker notes (whitespace-separated runs that contain a letter or digit).
    public static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: { $0.isWhitespace }).filter { $0.contains(where: { $0.isLetter || $0.isNumber }) }.count
    }

    /// "142 words · about 1 min" at a speaking rate of 150 words a minute.
    public static func notesSummary(_ text: String) -> String {
        let n = wordCount(text)
        let words = n == 1 ? "1 word" : "\(n) words"
        guard n > 0 else { return words }
        let secs = Int((Double(n) / 150 * 60).rounded())
        return secs < 60 ? "\(words) · about \(secs) s" : "\(words) · about \(Int((Double(secs) / 60).rounded())) min"
    }

    /// A hold after a nudge, never negative, rounded to 0.01 s.
    public static func nudged(_ hold: Double, by delta: Double) -> Double {
        max(0, ((hold + delta) * 100).rounded() / 100)
    }

    /// Each beat's hold relative to its start (= the previous hold), from absolute hold times.
    public static func relativeHolds(_ holds: [Hold]) -> [Int: Double] {
        var out: [Int: Double] = [:]
        var prev = 0.0
        for h in holds.sorted(by: { $0.at < $1.at }) {
            out[h.index] = ((h.at - prev) * 1e6).rounded() / 1e6
            prev = h.at
        }
        return out
    }
}

// MARK: - Beat operations (navigator context menu)

public enum BeatOps {
    /// A beat id not used in the chapter: `base`, else `base-2`, `base-3`, ...
    public static func uniqueID(_ base: String, in chapter: SpineSnapshot.Chapter) -> String {
        let used = Set(chapter.beats.map(\.id))
        if !used.contains(base) { return base }
        var n = 2
        while used.contains("\(base)-\(n)") { n += 1 }
        return "\(base)-\(n)"
    }

    public static func insertAfter(_ ref: String, in spine: SpineSnapshot, hold: Double = 2) -> EditOp? {
        guard let (ch, i, _) = spine.locate(ref) else { return nil }
        return .insertBeat(chapter: ch.id, index: i + 1, beat: NewBeat(id: uniqueID("beat", in: ch), label: "New beat", hold: hold))
    }

    public static func duplicate(_ ref: String, in spine: SpineSnapshot) -> EditOp? {
        guard let (ch, _, b) = spine.locate(ref) else { return nil }
        return .duplicateBeat(ref: ref, newId: uniqueID(b.id, in: ch), label: "\(b.label) (copy)")
    }

    public static func delete(_ ref: String, in spine: SpineSnapshot) -> EditOp? {
        spine.locate(ref) == nil ? nil : .deleteBeat(ref: ref)
    }

    /// Up or down by one within the chapter; nil at the chapter's edge.
    public static func move(_ ref: String, by delta: Int, in spine: SpineSnapshot) -> EditOp? {
        guard let (ch, i, _) = spine.locate(ref) else { return nil }
        let j = i + delta
        guard j >= 0, j < ch.beats.count else { return nil }
        return .moveBeat(ref: ref, chapter: ch.id, index: j)
    }
}
