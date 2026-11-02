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

export interface Methods extends EditMethods {
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

/** 'edit': the build talk.edit / talk.revert ran after writing (see the editing section). */
export type BuildTrigger = 'open' | 'request' | 'change' | 'edit';

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
  // Editing (see the editing section)
  EditFailed: -32010,
  EditConflict: -32011,
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

export const METHOD_NAMES: readonly MethodName[] = ['app.ping', 'app.shutdown', 'talk.open', 'talk.close', 'talk.build', 'talk.layout', 'talk.watch', 'talk.edit', 'talk.revert'];
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

// ---------------------------------------------------------------------------------------
// Editing (Phase 3): talk.edit, talk.revert. Types, op argument shapes and validators.
// The app keeps the undo stack; the sidecar only applies edits and inverses, and refuses an
// inverse whose files changed since it was issued (EditConflict).
// ---------------------------------------------------------------------------------------

/** A byte-range replacement in a talk file ([start, end) UTF-16 offsets, as @sage/core's Patch). */
export interface WirePatch { file: string; range: [number, number]; newText: string }

/** Undoes one edit. `digests`: sha256 (hex) of each touched file as the edit left it. */
export interface Inverse { patches: WirePatch[]; digests: Record<string, string> }

/** Inline-style properties: numbers are px, strings are CSS values, null removes. */
export interface StyleArgs { left?: number | string | null; top?: number | string | null; width?: number | string | null; height?: number | string | null; fontSize?: number | string | null }

/** talk.edit ops and their args. Element ops find the scene holding #id unless `scene` names it. */
export interface EditOps {
  setText: { id: string; html: string; scene?: string };
  setStyle: { id: string; style: StyleArgs; scene?: string };
  setAttr: { id: string; name: string; value: string | true | null; scene?: string };
  insertBeat: { chapter: string; index: number; beat: { id: string; label: string; notes?: string; hold?: number } };
  deleteBeat: { ref: string };
  duplicateBeat: { ref: string; newId: string; label?: string };
  moveBeat: { ref: string; chapter: string; index: number };
  setHold: { ref: string; hold: number | null };
  setNotes: { ref: string; notes: string | null };
  stretchBeat: { ref: string; factor: number };
  setBeat: { ref: string; props: { label?: string; backup?: boolean | null; dark?: boolean | null } };
  setChapter: { chapter: string; props: { label?: string; dark?: boolean | null; private?: boolean | null; backup?: boolean | null } };
}
export type EditOpName = keyof EditOps;
export const EDIT_OPS: readonly EditOpName[] = ['setText', 'setStyle', 'setAttr', 'insertBeat', 'deleteBeat', 'duplicateBeat', 'moveBeat', 'setHold', 'setNotes', 'stretchBeat', 'setBeat', 'setChapter'];

export type EditParams = { [K in EditOpName]: { op: K; args: EditOps[K] } }[EditOpName];

export interface StretchSkip { file: string; line: number; col: number; call: string; reason: string }

export interface EditResult {
  /** Apply with talk.revert to undo; empty patches when the edit changed nothing. */
  inverse: Inverse;
  /** Talk-relative paths written, sorted. */
  changed: string[];
  /** The rebuild after the write (skipped, ok:true and no diagnostics, when nothing changed). */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Fresh hold list after a successful rebuild. */
  holds?: Hold[];
  /** stretchBeat only: calls rewritten, and those left alone. */
  stretch?: { stretched: number; skipped: StretchSkip[] };
}

export interface EditMethods {
  /** Applies one source edit atomically (writes announced to the watcher, so source 'app'), then rebuilds. */
  'talk.edit': { params: EditParams; result: EditResult };
  /** Applies an inverse from a previous talk.edit/talk.revert result. EditConflict if a file changed since. */
  'talk.revert': { params: Inverse; result: EditResult };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => v === undefined || isStr(v);
const nullable = (ok: (v: unknown) => boolean) => (v: unknown) => v === null || ok(v);
const isBool = (v: unknown) => typeof v === 'boolean';

function checkArgsShape(a: unknown, at: string, spec: Record<string, [required: boolean, ok: (v: unknown) => boolean, what: string]>): Problems {
  if (!isObj(a)) return [`${at}: expected an object`];
  const req = Object.keys(spec).filter((k) => spec[k]![0]), opt = Object.keys(spec).filter((k) => !spec[k]![0]);
  const p = keys(a, at, req, opt);
  for (const [k, [, ok, what]] of Object.entries(spec)) if (k in a && !ok(a[k])) p.push(`${at}.${k}: expected ${what}`);
  return p;
}
const propsOf = (allowed: Record<string, (v: unknown) => boolean>) => (v: unknown) =>
  isObj(v) && Object.entries(v).every(([k, x]) => k in allowed && allowed[k]!(x));
const styleValue = (v: unknown) => v === null || isNum(v) || isStr(v);

const EDIT_ARGS: Record<EditOpName, Record<string, [boolean, (v: unknown) => boolean, string]>> = {
  setText: { id: [true, isStr, 'a string'], html: [true, isStr, 'a string'], scene: [false, isStr, 'a string'] },
  setStyle: { id: [true, isStr, 'a string'], style: [true, propsOf({ left: styleValue, top: styleValue, width: styleValue, height: styleValue, fontSize: styleValue }), 'left/top/width/height/fontSize as number, string or null'], scene: [false, isStr, 'a string'] },
  setAttr: { id: [true, isStr, 'a string'], name: [true, isStr, 'a string'], value: [true, (v) => v === null || v === true || isStr(v), 'a string, true or null'], scene: [false, isStr, 'a string'] },
  insertBeat: {
    chapter: [true, isStr, 'a string'], index: [true, (v) => isInt(v) && v >= 0, 'a non-negative integer'],
    beat: [true, (v) => isObj(v) && keys(v, 'beat', ['id', 'label'], ['notes', 'hold']).length === 0 && isStr(v.id) && isStr(v.label) && optStr(v.notes) && (v.hold === undefined || (isNum(v.hold) && v.hold >= 0)), '{id, label, notes?, hold?}'],
  },
  deleteBeat: { ref: [true, isStr, 'a string'] },
  duplicateBeat: { ref: [true, isStr, 'a string'], newId: [true, isStr, 'a string'], label: [false, isStr, 'a string'] },
  moveBeat: { ref: [true, isStr, 'a string'], chapter: [true, isStr, 'a string'], index: [true, (v) => isInt(v) && v >= 0, 'a non-negative integer'] },
  setHold: { ref: [true, isStr, 'a string'], hold: [true, nullable((v) => isNum(v) && v >= 0), 'a non-negative number or null'] },
  setNotes: { ref: [true, isStr, 'a string'], notes: [true, nullable(isStr), 'a string or null'] },
  stretchBeat: { ref: [true, isStr, 'a string'], factor: [true, (v) => isNum(v) && v > 0, 'a positive number'] },
  setBeat: { ref: [true, isStr, 'a string'], props: [true, propsOf({ label: isStr, backup: nullable(isBool), dark: nullable(isBool) }), '{label?, backup?, dark?}'] },
  setChapter: { chapter: [true, isStr, 'a string'], props: [true, propsOf({ label: isStr, dark: nullable(isBool), private: nullable(isBool), backup: nullable(isBool) }), '{label?, dark?, private?, backup?}'] },
};

export function checkPatch(v: unknown, at: string): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  const r = v.range;
  return [
    ...keys(v, at, ['file', 'range', 'newText']),
    ...want(isStr(v.file) && v.file.length > 0 && !v.file.startsWith('/'), `${at}.file: expected a relative path`),
    ...want(Array.isArray(r) && r.length === 2 && isInt(r[0]) && isInt(r[1]) && r[0] >= 0 && r[1] >= r[0], `${at}.range: expected [start, end] with 0 <= start <= end`),
    ...want(isStr(v.newText), `${at}.newText: expected a string`),
  ];
}

export function checkInverse(v: unknown, at: string): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  const d = v.digests;
  return [
    ...keys(v, at, ['patches', 'digests']),
    ...checkList(v.patches, `${at}.patches`, checkPatch),
    ...want(isObj(d) && Object.values(d).every((x) => isStr(x) && /^[0-9a-f]{64}$/.test(x)), `${at}.digests: expected {file: sha256 hex}`),
  ];
}

function checkEditResult(r: unknown): Problems {
  if (!isObj(r)) return ['result: expected an object'];
  const s = r.stretch;
  return [
    ...keys(r, 'result', ['inverse', 'changed', 'ok', 'diagnostics'], ['holds', 'stretch']),
    ...checkInverse(r.inverse, 'result.inverse'),
    ...checkList(r.changed, 'result.changed', (x, at) => want(isStr(x) && !x.startsWith('/'), `${at}: expected a relative path`)),
    ...want(typeof r.ok === 'boolean', 'result.ok: expected a boolean'),
    ...checkList(r.diagnostics, 'result.diagnostics', checkDiagnostic),
    ...(r.holds === undefined ? [] : checkList(r.holds, 'result.holds', checkHold)),
    ...(s === undefined ? [] : !isObj(s) ? ['result.stretch: expected an object'] : [
      ...keys(s, 'result.stretch', ['stretched', 'skipped']),
      ...want(isInt(s.stretched) && s.stretched >= 0, 'result.stretch.stretched: expected a non-negative integer'),
      ...checkList(s.skipped, 'result.stretch.skipped', (x, at) => isObj(x)
        ? [...keys(x, at, ['file', 'line', 'col', 'call', 'reason']), ...want(isStr(x.file) && isInt(x.line) && isInt(x.col) && isStr(x.call) && isStr(x.reason), `${at}: bad field types`)]
        : [`${at}: expected an object`]),
    ]),
  ];
}

export const editParamCheckers: { [M in keyof EditMethods]: (p: unknown) => Problems } = {
  'talk.edit': (p) => {
    if (!isObj(p)) return ['params: expected an object'];
    const problems = keys(p, 'params', ['op', 'args']);
    if (!EDIT_OPS.includes(p.op as EditOpName)) return [...problems, `params.op: expected one of ${EDIT_OPS.join(', ')}`];
    return [...problems, ...checkArgsShape(p.args, 'params.args', EDIT_ARGS[p.op as EditOpName])];
  },
  'talk.revert': (p) => checkInverse(p, 'params'),
};

export const editResultCheckers: { [M in keyof EditMethods]: (r: unknown) => Problems } = {
  'talk.edit': checkEditResult,
  'talk.revert': checkEditResult,
};

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
  ...editParamCheckers,
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
  ...editResultCheckers,
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
      ...want(p.trigger === 'open' || p.trigger === 'request' || p.trigger === 'change' || p.trigger === 'edit', 'params.trigger: bad value'),
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
