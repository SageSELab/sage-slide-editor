import Foundation

/// JSON-RPC 2.0 messages exchanged with the Node sidecar as newline-delimited JSON over stdio.
/// The schema is shared with packages/sidecar via fixtures in tests/rpc (PLAN 12.5).
public enum JSONValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}

public struct RPCError: Codable, Equatable, Error, Sendable {
    public var code: Int
    public var message: String
    public var data: JSONValue?
    public init(code: Int, message: String, data: JSONValue? = nil) {
        self.code = code; self.message = message; self.data = data
    }
}

/// One line on the wire. A request has `id` and `method`; a notification has `method` only;
/// a response has `id` and either `result` or `error`.
public struct RPCMessage: Codable, Equatable, Sendable {
    public var jsonrpc: String = "2.0"
    public var id: Int?
    public var method: String?
    public var params: JSONValue?
    public var result: JSONValue?
    public var error: RPCError?

    public static func request(id: Int, method: String, params: JSONValue? = nil) -> RPCMessage {
        RPCMessage(id: id, method: method, params: params)
    }
    public static func notification(_ method: String, params: JSONValue? = nil) -> RPCMessage {
        RPCMessage(method: method, params: params)
    }

    public var isResponse: Bool { id != nil && method == nil }

    private enum CodingKeys: String, CodingKey { case jsonrpc, id, method, params, result, error }

    /// Like the synthesized encoder, except that an error response whose request id could not be
    /// read (parse error, invalid request) keeps the `"id": null` JSON-RPC requires.
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(jsonrpc, forKey: .jsonrpc)
        if let id { try c.encode(id, forKey: .id) } else if error != nil, method == nil { try c.encodeNil(forKey: .id) }
        try c.encodeIfPresent(method, forKey: .method)
        try c.encodeIfPresent(params, forKey: .params)
        try c.encodeIfPresent(result, forKey: .result)
        try c.encodeIfPresent(error, forKey: .error)
    }
}

/// Splits a byte stream into complete NDJSON lines, tolerating chunks that end mid-line
/// and multi-byte UTF-8 sequences split across chunks.
public struct NDJSONFramer: Sendable {
    private var buffer = Data()
    public init() {}

    public mutating func feed(_ chunk: Data) -> [Data] {
        buffer.append(chunk)
        var lines: [Data] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            let line = buffer[buffer.startIndex..<nl]
            buffer.removeSubrange(buffer.startIndex...nl)
            let trimmed = line.last == 0x0D ? line.dropLast() : line
            if !trimmed.isEmpty { lines.append(Data(trimmed)) }
        }
        return lines
    }

    public static func encode(_ message: RPCMessage) throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var d = try enc.encode(message)
        d.append(0x0A)
        return d
    }
}
