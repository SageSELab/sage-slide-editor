// protocol.ts — the sidecar's JSON-RPC 2.0 contract (PLAN 2, 12.5). Documented in docs/rpc.md.
//
// Wire: one JSON object per line (NDJSON) on stdin/stdout, UTF-8, '\n' terminated. stderr is
// free-form log text and never carries protocol messages. Ids are integers chosen by the
// requester; both sides may send requests (the Swift app today; the sidecar from Phase 4 on,
// for permission prompts and frame requests). Every result is a JSON object (never null), so
// a response always has an explicit `result` or `error` member after a round trip through
// Swift's Optional-based Codable.
//
// The same shapes are mirrored by the Codable structs in
// apps/mac/Sources/SageTalkCore/SidecarClient.swift, and both sides decode the fixtures in
// tests/rpc/*.json.

export const JSONRPC = '2.0' as const;
/** Bumped on any incompatible change; reported by app.ping. */
export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------------------

export type Id = number;

export interface RequestMessage<M extends string = string, P = unknown> {
  jsonrpc: typeof JSONRPC;
  id: Id;
  method: M;
  params?: P;
}
export interface NotificationMessage<M extends string = string, P = unknown> {
  jsonrpc: typeof JSONRPC;
  method: M;
  params?: P;
}
export interface SuccessResponse<R = unknown> {
  jsonrpc: typeof JSONRPC;
  id: Id;
  result: R;
}
export interface ErrorObject {
  code: number;
  message: string;
  data?: unknown;
}
export interface ErrorResponse {
  jsonrpc: typeof JSONRPC;
  /** null only when the request's id could not be read (parse error, invalid request). */
  id: Id | null;
  error: ErrorObject;
}
export type ResponseMessage<R = unknown> = SuccessResponse<R> | ErrorResponse;
export type Message = RequestMessage | NotificationMessage | ResponseMessage;

// ---------------------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------------------

/** Mirrors SageTalkCore.TalkFolder.Kind. */
export type TalkKind = 'beatFormat' | 'legacy';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  /** Stable machine code, e.g. 'build-failed', 'missing-file', 'hold-before-motion-end'. */
  code: string;
  message: string;
  /** Talk-relative POSIX path, when the diagnostic is about a file. */
  file?: string;
  /** 'chapter.beat', when the diagnostic is about a beat. */
  beat?: string;
}

/** A hold (checkpoint). Superset of SageTalkCore.Hold {index, at, label, backup}. */
export interface Hold {
  /** 1-based, in film order (matches the engine's ?cplist numbering). */
  index: number;
  /** Absolute film time in seconds. */
  at: number;
  label: string;
  backup: boolean;
  /** 'chapter.beat'. */
  beat: string;
  chapter: string;
  /** True when the hold was computed (auto-hold) rather than authored in talk.json. */
  auto: boolean;
}

export interface BuildResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Wall time of the build in milliseconds. */
  ms: number;
}

export interface LayoutResult {
  holds: Hold[];
  /** Film duration in seconds (last hold + 1). */
  duration: number;
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------------------
// Methods (app -> sidecar)
// ---------------------------------------------------------------------------------------

export interface OpenParams {
  /** Absolute path of the talk folder. */
  path: string;
  /** Start the folder watcher (default true). */
  watch?: boolean;
}
export interface OpenResult {
  kind: TalkKind;
  /** Canonical absolute path (symlinks resolved). */
  root: string;
  /** file:// URL of the page the canvas loads (build/index.html, or index.html for legacy). */
  filmURL: string;
  /** Present for beatFormat talks. */
  holds?: Hold[];
  /** The build run during open (beatFormat only). */
  build?: BuildResult;
}

export interface PingResult {
  pong: true;
  protocol: typeof PROTOCOL_VERSION;
  version: string;
  pid: number;
}

export interface WatchParams {
  enabled: boolean;
}
export interface WatchResult {
  watching: boolean;
}

/** Empty object result (talk.close, app.shutdown). */
export type Empty = Record<string, never>;

export interface Methods {
  'app.ping': { params: Empty | undefined; result: PingResult };
  /** Replies, then closes the talk and exits 0. Closing stdin has the same effect. */
  'app.shutdown': { params: Empty | undefined; result: Empty };
  /** Opens a talk folder; closes any talk already open in this sidecar. */
  'talk.open': { params: OpenParams; result: OpenResult };
  'talk.close': { params: Empty | undefined; result: Empty };
  /** Compiles build/index.html. A failed compile is ok:false, not an RPC error. */
  'talk.build': { params: Empty | undefined; result: BuildResult };
  'talk.layout': { params: Empty | undefined; result: LayoutResult };
  /** Turns the folder watcher on or off for the open talk. */
  'talk.watch': { params: WatchParams; result: WatchResult };
}
export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = Methods[M]['params'];
export type ResultOf<M extends MethodName> = Methods[M]['result'];

// ---------------------------------------------------------------------------------------
// Notifications (sidecar -> app)
// ---------------------------------------------------------------------------------------

export type ChangeSource = 'app' | 'external';

export interface ChangedParams {
  /** Talk-relative POSIX paths, sorted, deduplicated. build/, .sage/ and node_modules/ are never reported. */
  paths: string[];
  /** 'app' when every path matches a write the sidecar made itself (expected writes); else 'external'. */
  source: ChangeSource;
}

export type BuildTrigger = 'open' | 'request' | 'change';

export interface BuiltParams extends BuildResult {
  trigger: BuildTrigger;
  /** Fresh hold list after a successful build (beatFormat). */
  holds?: Hold[];
}

export interface Notifications {
  'talk.changed': ChangedParams;
  'talk.built': BuiltParams;
}
export type NotificationName = keyof Notifications;

// ---------------------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------------------

export const ErrorCode = {
  // JSON-RPC 2.0
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Sidecar (-32000 to -32099, implementation-defined server errors)
  NotATalk: -32000,
  NoTalkOpen: -32001,
  UnsupportedForKind: -32002,
  ShuttingDown: -32003,
  Timeout: -32004,
} as const;
export type ErrorCodeName = keyof typeof ErrorCode;

export class RpcError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
  toObject(): ErrorObject {
    return this.data === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, data: this.data };
  }
}

export const METHOD_NAMES: readonly MethodName[] = ['app.ping', 'app.shutdown', 'talk.open', 'talk.close', 'talk.build', 'talk.layout', 'talk.watch'];
export const NOTIFICATION_NAMES: readonly NotificationName[] = ['talk.changed', 'talk.built'];

// ---------------------------------------------------------------------------------------
// Runtime validation (hand-written; no schema dependency). Each returns a list of problems,
// empty when valid. Used by the dispatcher for params and by the fixture tests for everything.
// ---------------------------------------------------------------------------------------

type Problems = string[];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function keys(v: Record<string, unknown>, at: string, required: string[], optional: string[] = []): Problems {
  const p: Problems = [];
  for (const k of required) if (!(k in v)) p.push(`${at}: missing '${k}'`);
  for (const k of Object.keys(v)) if (!required.includes(k) && !optional.includes(k)) p.push(`${at}: unexpected '${k}'`);
  return p;
}
const want = (ok: boolean, msg: string): Problems => (ok ? [] : [msg]);

export function checkEmpty(v: unknown, at = 'params'): Problems {
  if (v === undefined) return [];
  if (!isObj(v)) return [`${at}: expected an object`];
  return keys(v, at, []);
}

export function checkDiagnostic(v: unknown, at: string): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  return [
    ...keys(v, at, ['severity', 'code', 'message'], ['file', 'beat']),
    ...want(v.severity === 'error' || v.severity === 'warning' || v.severity === 'info', `${at}.severity: bad value`),
    ...want(typeof v.code === 'string', `${at}.code: expected a string`),
    ...want(typeof v.message === 'string', `${at}.message: expected a string`),
    ...want(v.file === undefined || typeof v.file === 'string', `${at}.file: expected a string`),
    ...want(v.beat === undefined || typeof v.beat === 'string', `${at}.beat: expected a string`),
  ];
}

export function checkHold(v: unknown, at: string): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  return [
    ...keys(v, at, ['index', 'at', 'label', 'backup', 'beat', 'chapter', 'auto']),
    ...want(isInt(v.index) && v.index >= 1, `${at}.index: expected a positive integer`),
    ...want(typeof v.at === 'number' && v.at >= 0, `${at}.at: expected a non-negative number`),
    ...want(typeof v.label === 'string', `${at}.label: expected a string`),
    ...want(typeof v.backup === 'boolean', `${at}.backup: expected a boolean`),
    ...want(typeof v.beat === 'string', `${at}.beat: expected a string`),
    ...want(typeof v.chapter === 'string', `${at}.chapter: expected a string`),
    ...want(typeof v.auto === 'boolean', `${at}.auto: expected a boolean`),
  ];
}

const checkList = (v: unknown, at: string, item: (x: unknown, at: string) => Problems): Problems =>
  Array.isArray(v) ? v.flatMap((x, i) => item(x, `${at}[${i}]`)) : [`${at}: expected an array`];

function checkBuildFields(v: Record<string, unknown>, at: string): Problems {
  return [
    ...want(typeof v.ok === 'boolean', `${at}.ok: expected a boolean`),
    ...checkList(v.diagnostics, `${at}.diagnostics`, checkDiagnostic),
    ...want(typeof v.ms === 'number' && v.ms >= 0, `${at}.ms: expected a non-negative number`),
  ];
}
export function checkBuildResult(v: unknown, at = 'result'): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  return [...keys(v, at, ['ok', 'diagnostics', 'ms']), ...checkBuildFields(v, at)];
}

export const paramCheckers: { [M in MethodName]: (p: unknown) => Problems } = {
  'app.ping': (p) => checkEmpty(p),
  'app.shutdown': (p) => checkEmpty(p),
  'talk.close': (p) => checkEmpty(p),
  'talk.build': (p) => checkEmpty(p),
  'talk.layout': (p) => checkEmpty(p),
  'talk.open': (p) => {
    if (!isObj(p)) return ['params: expected an object'];
    return [
      ...keys(p, 'params', ['path'], ['watch']),
      ...want(typeof p.path === 'string' && p.path.length > 0, 'params.path: expected a non-empty string'),
      ...want(p.watch === undefined || typeof p.watch === 'boolean', 'params.watch: expected a boolean'),
    ];
  },
  'talk.watch': (p) => {
    if (!isObj(p)) return ['params: expected an object'];
    return [...keys(p, 'params', ['enabled']), ...want(typeof p.enabled === 'boolean', 'params.enabled: expected a boolean')];
  },
};

export const resultCheckers: { [M in MethodName]: (r: unknown) => Problems } = {
  'app.ping': (r) => {
    if (!isObj(r)) return ['result: expected an object'];
    return [
      ...keys(r, 'result', ['pong', 'protocol', 'version', 'pid']),
      ...want(r.pong === true, 'result.pong: expected true'),
      ...want(r.protocol === PROTOCOL_VERSION, `result.protocol: expected ${PROTOCOL_VERSION}`),
      ...want(typeof r.version === 'string', 'result.version: expected a string'),
      ...want(isInt(r.pid), 'result.pid: expected an integer'),
    ];
  },
  'app.shutdown': (r) => checkEmpty(r ?? null, 'result'),
  'talk.close': (r) => checkEmpty(r ?? null, 'result'),
  'talk.build': (r) => checkBuildResult(r),
  'talk.layout': (r) => {
    if (!isObj(r)) return ['result: expected an object'];
    return [
      ...keys(r, 'result', ['holds', 'duration', 'diagnostics']),
      ...checkList(r.holds, 'result.holds', checkHold),
      ...want(typeof r.duration === 'number', 'result.duration: expected a number'),
      ...checkList(r.diagnostics, 'result.diagnostics', checkDiagnostic),
    ];
  },
  'talk.open': (r) => {
    if (!isObj(r)) return ['result: expected an object'];
    return [
      ...keys(r, 'result', ['kind', 'root', 'filmURL'], ['holds', 'build']),
      ...want(r.kind === 'beatFormat' || r.kind === 'legacy', 'result.kind: bad value'),
      ...want(typeof r.root === 'string', 'result.root: expected a string'),
      ...want(typeof r.filmURL === 'string' && r.filmURL.startsWith('file://'), 'result.filmURL: expected a file:// URL'),
      ...(r.holds === undefined ? [] : checkList(r.holds, 'result.holds', checkHold)),
      ...(r.build === undefined ? [] : checkBuildResult(r.build, 'result.build')),
    ];
  },
  'talk.watch': (r) => {
    if (!isObj(r)) return ['result: expected an object'];
    return [...keys(r, 'result', ['watching']), ...want(typeof r.watching === 'boolean', 'result.watching: expected a boolean')];
  },
};

export const notificationCheckers: { [N in NotificationName]: (p: unknown) => Problems } = {
  'talk.changed': (p) => {
    if (!isObj(p)) return ['params: expected an object'];
    return [
      ...keys(p, 'params', ['paths', 'source']),
      ...checkList(p.paths, 'params.paths', (x, at) => want(typeof x === 'string' && !x.startsWith('/'), `${at}: expected a relative path`)),
      ...want(p.source === 'app' || p.source === 'external', 'params.source: bad value'),
    ];
  },
  'talk.built': (p) => {
    if (!isObj(p)) return ['params: expected an object'];
    return [
      ...keys(p, 'params', ['ok', 'diagnostics', 'ms', 'trigger'], ['holds']),
      ...checkBuildFields(p, 'params'),
      ...want(p.trigger === 'open' || p.trigger === 'request' || p.trigger === 'change', 'params.trigger: bad value'),
      ...(p.holds === undefined ? [] : checkList(p.holds, 'params.holds', checkHold)),
    ];
  },
};

export function checkErrorObject(v: unknown, at = 'error'): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  return [
    ...keys(v, at, ['code', 'message'], ['data']),
    ...want(isInt(v.code), `${at}.code: expected an integer`),
    ...want(typeof v.message === 'string', `${at}.message: expected a string`),
  ];
}

export type Classified =
  | { type: 'request'; msg: RequestMessage }
  | { type: 'notification'; msg: NotificationMessage }
  | { type: 'response'; msg: SuccessResponse }
  | { type: 'error'; msg: ErrorResponse };

/** Classifies one decoded line by envelope shape, or returns the reason it is not a message. */
export function classify(v: unknown): Classified | { type: 'invalid'; reason: string } {
  if (!isObj(v)) return { type: 'invalid', reason: 'not a JSON object' };
  if (v.jsonrpc !== JSONRPC) return { type: 'invalid', reason: "jsonrpc must be '2.0'" };
  const hasId = 'id' in v;
  if (typeof v.method === 'string') {
    if (!hasId) return { type: 'notification', msg: v as unknown as NotificationMessage };
    if (!isInt(v.id)) return { type: 'invalid', reason: 'id must be an integer' };
    return { type: 'request', msg: v as unknown as RequestMessage };
  }
  if ('method' in v) return { type: 'invalid', reason: 'method must be a string' };
  if (!hasId) return { type: 'invalid', reason: 'missing id' };
  if ('error' in v) {
    if (!(v.id === null || isInt(v.id))) return { type: 'invalid', reason: 'id must be an integer or null' };
    return { type: 'error', msg: v as unknown as ErrorResponse };
  }
  if ('result' in v) {
    if (!isInt(v.id)) return { type: 'invalid', reason: 'id must be an integer' };
    return { type: 'response', msg: v as unknown as SuccessResponse };
  }
  return { type: 'invalid', reason: 'neither a request, notification nor response' };
}
