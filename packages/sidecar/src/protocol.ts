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

import { parseTheme, type Theme } from '@sage/core';

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

export type ChangeSource = 'app' | 'external' | 'claude';

export interface ChangedParams {
  /** Talk-relative POSIX paths, sorted, deduplicated. build/, .sage/ and node_modules/ are never reported. */
  paths: string[];
  /** 'app' or 'claude' when every path matches a write the sidecar announced for that author (expected writes); else 'external'. */
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

/**
 * Inline-style properties: numbers are px (fontWeight: unitless), strings are CSS values, null
 * removes. The text keys (color ... textDecoration) take strings only, fontWeight also a number.
 */
export interface StyleArgs {
  left?: number | string | null; top?: number | string | null; width?: number | string | null; height?: number | string | null; fontSize?: number | string | null;
  color?: string | null; textAlign?: string | null; fontWeight?: number | string | null; fontStyle?: string | null; fontFamily?: string | null; textDecoration?: string | null;
}

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
const styleText = nullable((v) => isStr(v) && v.trim().length > 0);
const STYLE_PROPS = {
  left: styleValue, top: styleValue, width: styleValue, height: styleValue, fontSize: styleValue,
  color: styleText, textAlign: styleText, fontWeight: styleValue, fontStyle: styleText, fontFamily: styleText, textDecoration: styleText,
};

const EDIT_ARGS: Record<EditOpName, Record<string, [boolean, (v: unknown) => boolean, string]>> = {
  setText: { id: [true, isStr, 'a string'], html: [true, isStr, 'a string'], scene: [false, isStr, 'a string'] },
  setStyle: { id: [true, isStr, 'a string'], style: [true, propsOf(STYLE_PROPS), 'left/top/width/height/fontSize/fontWeight as number, string or null; color/textAlign/fontStyle/fontFamily/textDecoration as string or null'], scene: [false, isStr, 'a string'] },
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

export function checkEditResult(r: unknown): Problems {
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
      ...want(p.source === 'app' || p.source === 'external' || p.source === 'claude', 'params.source: bad value'),
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

// =======================================================================================
// Claude bridge (Phase 4, PLAN 6). Kept in its own section so other protocol additions merge
// cleanly. `claude.*` methods are app -> sidecar; `app.ask|state|goto` are sidecar -> app
// requests the Swift client answers through setRequestHandler. Fixtures: tests/rpc/claude/.
// =======================================================================================

export interface ClaudeSendParams {
  /** The user's message. */
  text: string;
  /** Absolute or talk-relative paths the user attached (from the Materials sidebar). */
  attachments?: string[];
  /**
   * Reasoning effort for this and later requests (the pane's footer control). The Agent SDK's
   * `effort` option; a running conversation switches with Query.applyFlagSettings. Absent: unchanged.
   */
  effort?: ClaudeEffort;
  /**
   * Model for this and later requests (the pane's model menu): a Claude model id such as
   * `claude-fable-5-1`. A running conversation switches with Query.setModel. Absent: unchanged.
   */
  model?: string;
}
/** The models the pane offers, most capable first (any `claude-` id is accepted). */
export const CLAUDE_MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export interface ClaudeSendResult {
  /** 1-based count of messages sent in this sidecar. */
  turn: number;
}
export interface ClaudeInterruptResult {
  /** False when nothing was running. */
  interrupted: boolean;
}

export interface ClaudeMethods {
  /** Queues a user message; replies at once. Output arrives as claude.* notifications. */
  'claude.send': { params: ClaudeSendParams; result: ClaudeSendResult };
  'claude.interrupt': { params: Empty | undefined; result: ClaudeInterruptResult };
  /** Ends the conversation and forgets .sage/session.json; the next send starts fresh. */
  'claude.reset': { params: Empty | undefined; result: Empty };
}
export type ClaudeMethodName = keyof ClaudeMethods;

export type ClaudeState = 'idle' | 'starting' | 'running' | 'error';

export interface ClaudeStatusParams {
  state: ClaudeState;
  sessionId?: string;
  model?: string;
  /** Human-readable detail: an error, a skipped materials folder, "resumed", "forked". */
  message?: string;
  /** True once the init message listed the bundled academic-talk-film skill. */
  skillLoaded?: boolean;
}

export interface ClaudeDeltaParams {
  /** Streamed assistant text (Markdown), appended to the current assistant message. */
  text: string;
}

export type ClaudeToolStatus = 'running' | 'done' | 'error' | 'denied';

export interface ClaudeToolParams {
  /** The tool_use id; later notifications for the same call reuse it. */
  id: string;
  /** Tool name with the app server's prefix removed (`talk_frame`, not `mcp__talk__talk_frame`). */
  name: string;
  /** One line: a talk-relative path, a command, a beat. */
  summary: string;
  status: ClaudeToolStatus;
  /** Expanded text for the row: the result or error, truncated. */
  detail?: string;
  /** Talk-relative path for file tools inside the talk. */
  path?: string;
  /** 'chapter.beat' the edit touched (Write/Edit in the talk) or the tool moved to. */
  beat?: string;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Context size after this request: input + cache read + cache creation of its last model call. */
  contextTokens: number;
}

export type ClaudeErrorKind = 'budget' | 'max_turns' | 'execution' | 'interrupted' | 'process';

export interface ClaudeResultParams {
  /** USD spent by this request. */
  cost: number;
  /** USD spent in this conversation since the sidecar started. */
  totalCost: number;
  usage: ClaudeUsage;
  sessionId: string;
  durationMs: number;
  turns: number;
  error?: { kind: ClaudeErrorKind; message: string };
}

export interface ClaudeNotifications {
  'claude.status': ClaudeStatusParams;
  'claude.delta': ClaudeDeltaParams;
  'claude.tool': ClaudeToolParams;
  'claude.result': ClaudeResultParams;
}
export type ClaudeNotificationName = keyof ClaudeNotifications;

/** sidecar -> app: the approval sheet behind canUseTool. */
export interface AskParams {
  tool: string;
  /** The SDK's prompt sentence, or one the bridge composes. */
  title: string;
  summary: string;
  /** Absolute path the tool would touch, when there is one. */
  path?: string;
  /** Why it is asking (outside the talk, a shell command, ...). */
  reason: string;
  /** What "Allow for this talk" would persist, e.g. "Bash: npx" or "Write in ../paper". */
  scope: string;
}
export type AskDecision = 'allow' | 'allowTalk' | 'deny';
export interface AskResult { decision: AskDecision }

export interface AppStateResult {
  /** Canvas time in seconds. */
  t: number;
  playing: boolean;
  /** The hold at or before t (1-based), its beat and label. */
  hold?: number;
  beat?: string;
  label?: string;
  /** Selected object ids on the canvas (Phase 3). */
  selection: string[];
  /** True when the user pinned the canvas (it does not follow Claude). */
  pinned: boolean;
}
export interface AppGotoParams { t: number; beat?: string }
export interface AppGotoResult { t: number }

export interface AppRequests {
  'app.ask': { params: AskParams; result: AskResult };
  'app.state': { params: Empty | undefined; result: AppStateResult };
  'app.goto': { params: AppGotoParams; result: AppGotoResult };
}
export type AppRequestName = keyof AppRequests;

export const CLAUDE_METHOD_NAMES: readonly ClaudeMethodName[] = ['claude.send', 'claude.interrupt', 'claude.reset'];
export const CLAUDE_NOTIFICATION_NAMES: readonly ClaudeNotificationName[] = ['claude.status', 'claude.delta', 'claude.tool', 'claude.result'];
export const APP_REQUEST_NAMES: readonly AppRequestName[] = ['app.ask', 'app.state', 'app.goto'];

const optStrAt = (v: Record<string, unknown>, k: string, at: string) => want(v[k] === undefined || typeof v[k] === 'string', `${at}.${k}: expected a string`);
const strs = (v: Record<string, unknown>, fields: string[], at: string) => fields.flatMap((f) => want(typeof v[f] === 'string', `${at}.${f}: expected a string`));
const oneOf = (v: unknown, values: readonly string[], at: string) => want(typeof v === 'string' && values.includes(v), `${at}: bad value`);

/** Runs `body` on an object after checking its keys, or reports that it is not an object. */
function shape(v: unknown, at: string, required: string[], optional: string[], body: (o: Record<string, unknown>) => Problems): Problems {
  if (!isObj(v)) return [`${at}: expected an object`];
  return [...keys(v, at, required, optional), ...body(v)];
}

export const claudeParamCheckers: { [M in ClaudeMethodName]: (p: unknown) => Problems } = {
  'claude.send': (p) => shape(p, 'params', ['text'], ['attachments', 'effort', 'model'], (v) => [
    ...want(typeof v.text === 'string' && v.text.trim().length > 0, 'params.text: expected a non-empty string'),
    ...(v.model === undefined ? [] : want(typeof v.model === 'string' && /^claude-[a-z0-9.-]+(\[1m\])?$/.test(v.model), 'params.model: expected a Claude model id (claude-...)')),
    ...(v.effort === undefined ? [] : oneOf(v.effort, CLAUDE_EFFORTS, 'params.effort')),
    ...(v.attachments === undefined ? [] : checkList(v.attachments, 'params.attachments', (x, at) => want(typeof x === 'string' && x.length > 0, `${at}: expected a path`))),
  ]),
  'claude.interrupt': (p) => checkEmpty(p),
  'claude.reset': (p) => checkEmpty(p),
};

export const claudeResultCheckers: { [M in ClaudeMethodName]: (r: unknown) => Problems } = {
  'claude.send': (r) => shape(r, 'result', ['turn'], [], (v) => want(isInt(v.turn) && v.turn >= 1, 'result.turn: expected a positive integer')),
  'claude.interrupt': (r) => shape(r, 'result', ['interrupted'], [], (v) => want(typeof v.interrupted === 'boolean', 'result.interrupted: expected a boolean')),
  'claude.reset': (r) => checkEmpty(r ?? null, 'result'),
};

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'contextTokens'];
const checkUsage = (u: unknown, at: string) =>
  shape(u, at, USAGE_FIELDS, [], (v) => USAGE_FIELDS.flatMap((f) => want(isInt(v[f]) && (v[f] as number) >= 0, `${at}.${f}: expected a non-negative integer`)));

export const claudeNotificationCheckers: { [N in ClaudeNotificationName]: (p: unknown) => Problems } = {
  'claude.status': (p) => shape(p, 'params', ['state'], ['sessionId', 'model', 'message', 'skillLoaded'], (v) => [
    ...oneOf(v.state, ['idle', 'starting', 'running', 'error'], 'params.state'),
    ...optStrAt(v, 'sessionId', 'params'), ...optStrAt(v, 'model', 'params'), ...optStrAt(v, 'message', 'params'),
    ...want(v.skillLoaded === undefined || typeof v.skillLoaded === 'boolean', 'params.skillLoaded: expected a boolean'),
  ]),
  'claude.delta': (p) => shape(p, 'params', ['text'], [], (v) => strs(v, ['text'], 'params')),
  'claude.tool': (p) => shape(p, 'params', ['id', 'name', 'summary', 'status'], ['detail', 'path', 'beat'], (v) => [
    ...want(typeof v.id === 'string' && v.id.length > 0, 'params.id: expected a non-empty string'),
    ...strs(v, ['name', 'summary'], 'params'),
    ...oneOf(v.status, ['running', 'done', 'error', 'denied'], 'params.status'),
    ...optStrAt(v, 'detail', 'params'), ...optStrAt(v, 'beat', 'params'),
    ...want(v.path === undefined || (typeof v.path === 'string' && !v.path.startsWith('/')), 'params.path: expected a relative path'),
  ]),
  'claude.result': (p) => shape(p, 'params', ['cost', 'totalCost', 'usage', 'sessionId', 'durationMs', 'turns'], ['error'], (v) => [
    ...want(isNum(v.cost) && v.cost >= 0, 'params.cost: expected a non-negative number'),
    ...want(isNum(v.totalCost) && v.totalCost >= 0, 'params.totalCost: expected a non-negative number'),
    ...checkUsage(v.usage, 'params.usage'),
    ...strs(v, ['sessionId'], 'params'),
    ...want(isNum(v.durationMs) && v.durationMs >= 0, 'params.durationMs: expected a non-negative number'),
    ...want(isInt(v.turns) && v.turns >= 0, 'params.turns: expected a non-negative integer'),
    ...(v.error === undefined ? [] : shape(v.error, 'params.error', ['kind', 'message'], [], (e) => [
      ...oneOf(e.kind, ['budget', 'max_turns', 'execution', 'interrupted', 'process'], 'params.error.kind'),
      ...strs(e, ['message'], 'params.error'),
    ])),
  ]),
};

export const appRequestParamCheckers: { [M in AppRequestName]: (p: unknown) => Problems } = {
  'app.ask': (p) => shape(p, 'params', ['tool', 'title', 'summary', 'reason', 'scope'], ['path'], (v) => [
    ...strs(v, ['tool', 'title', 'summary', 'reason', 'scope'], 'params'), ...optStrAt(v, 'path', 'params'),
  ]),
  'app.state': (p) => checkEmpty(p),
  'app.goto': (p) => shape(p, 'params', ['t'], ['beat'], (v) => [
    ...want(isNum(v.t) && v.t >= 0, 'params.t: expected a non-negative number'), ...optStrAt(v, 'beat', 'params'),
  ]),
};

export const appRequestResultCheckers: { [M in AppRequestName]: (r: unknown) => Problems } = {
  'app.ask': (r) => shape(r, 'result', ['decision'], [], (v) => oneOf(v.decision, ['allow', 'allowTalk', 'deny'], 'result.decision')),
  'app.state': (r) => shape(r, 'result', ['t', 'playing', 'selection', 'pinned'], ['hold', 'beat', 'label'], (v) => [
    ...want(isNum(v.t) && v.t >= 0, 'result.t: expected a non-negative number'),
    ...want(typeof v.playing === 'boolean', 'result.playing: expected a boolean'),
    ...want(typeof v.pinned === 'boolean', 'result.pinned: expected a boolean'),
    ...checkList(v.selection, 'result.selection', (x, at) => want(typeof x === 'string', `${at}: expected a string`)),
    ...want(v.hold === undefined || (isInt(v.hold) && v.hold >= 1), 'result.hold: expected a positive integer'),
    ...optStrAt(v, 'beat', 'result'), ...optStrAt(v, 'label', 'result'),
  ]),
  'app.goto': (r) => shape(r, 'result', ['t'], [], (v) => want(isNum(v.t) && v.t >= 0, 'result.t: expected a non-negative number')),
};

// =======================================================================================
// Publish and export (Phase 5, PLAN 5.6). Its own section, like Claude's, so other protocol
// additions merge cleanly. Fixtures: tests/rpc/publish/, checked by publish-protocol.test.ts
// and PublishProtocolTests.swift. Implementation: src/publish/.
// =======================================================================================

export interface PublishParams {
  /** Output file name without .html (letters, digits, . _ -). Default: the talk folder's name, slugified. */
  slug?: string;
}
export interface PublishResult {
  /** Absolute path of the public file (<talk>/build/public/<slug>.html). */
  path: string;
  bytes: number;
  /** Holds in the public film (private chapters out, end card in). */
  holds: number;
  /** Public film duration in seconds. */
  duration: number;
  /** Non-fatal problems; `publish-private-text` / `publish-private-leak` flag private labels or notes that would ship. */
  warnings: Diagnostic[];
}

export type ExportKind = 'png' | 'pdf';
export interface ExportParams {
  kind: ExportKind;
  /** 'all' (default) or 1-based hold numbers of the full film (backups included). */
  holds?: 'all' | number[];
  /** Also render each hold `around` seconds before and after (frames sorted by time). */
  around?: number;
}
export interface ExportResult {
  kind: ExportKind;
  /** Absolute folder written: <talk>/build/export/png for PNGs, <talk>/build/export for the PDF. */
  dir: string;
  /** Absolute paths written: one PNG per frame, or the one PDF. */
  files: string[];
  /** Frames rendered (= PNG files = PDF pages). */
  frames: number;
  /** Frame size: 1920x1080 px, which is also the PDF page size in points. */
  width: number;
  height: number;
  ms: number;
  /** Uncaught page errors while rendering. */
  errors: string[];
}
export interface ExportProgressParams { kind: ExportKind; done: number; total: number }

export type SiteName = 'personal' | 'lab';
export interface SiteStageParams {
  site: SiteName;
  /** Absolute path of the site repository's working tree (from the app's settings). */
  repo: string;
  /** The published file's slug: <talk>/build/public/<slug>.html goes to public/talks/<slug>.html. */
  slug: string;
  /** The publication to link the slides from: its `id` in publications.yaml, or its exact title. */
  paperEntry?: string;
}
export type SiteFileStatus = 'added' | 'modified' | 'unchanged';
export interface SiteFile { path: string; status: SiteFileStatus }
export interface SiteStageResult {
  site: SiteName;
  /** The repository's top level, symlinks resolved. */
  repo: string;
  /** The page's path on the site (/talks/<slug>.html). */
  url: string;
  /** Every file stage looked at, repo-relative. Commit the ones not 'unchanged'. */
  files: SiteFile[];
  /** The YAML files' diff plus a stat line for the HTML file. Empty when nothing changed. */
  diff: string;
  /** What was skipped and why (an auto-generated YAML file, a paper that was not found). */
  notes: string[];
}
export interface SiteCommitParams {
  repo: string;
  /** Repo-relative paths to commit (only these; other staged changes stay staged). */
  paths: string[];
  message: string;
}
export interface SiteCommitResult {
  /** The new commit's full hash. */
  commit: string;
  /** One line per committed file plus the subject. */
  summary: string;
}

/** QR codes for the title and end card (publishing.md): each URL given becomes assets/qr-<name>.svg. */
export interface QrParams { paper?: string; slides?: string; package?: string }
export interface QrResult {
  /** Talk-relative paths written (assets/qr-paper.svg, ...), in the order paper, slides, package. */
  files: string[];
}

export interface PublishMethods {
  /** Writes the public single file (talkc publish). PublishFailed (data.diagnostics) when it cannot. */
  'talk.publish': { params: PublishParams | undefined; result: PublishResult };
  /** Rebuilds, then renders holds to PNGs or a PDF; talk.exportProgress after each frame. */
  'talk.export': { params: ExportParams; result: ExportResult };
  /** Copies the published file into a site repo and edits its YAML; never commits. */
  'site.stage': { params: SiteStageParams; result: SiteStageResult };
  /** Commits the given paths in a site repo (the user clicked Commit). Never pushes. */
  'site.commit': { params: SiteCommitParams; result: SiteCommitResult };
  /** Writes SVG QR codes into the talk's assets/ (as app writes). */
  'talk.qr': { params: QrParams; result: QrResult };
}
export type PublishMethodName = keyof PublishMethods;
export interface PublishNotifications { 'talk.exportProgress': ExportProgressParams }
export type PublishNotificationName = keyof PublishNotifications;

export const PUBLISH_METHOD_NAMES: readonly PublishMethodName[] = ['talk.publish', 'talk.export', 'site.stage', 'site.commit', 'talk.qr'];
export const QR_NAMES = ['paper', 'slides', 'package'] as const;
const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/[^\s]+$/.test(v) && v.length <= 2000;
export const PUBLISH_NOTIFICATION_NAMES: readonly PublishNotificationName[] = ['talk.exportProgress'];

export const PublishErrorCode = {
  /** talk.publish / talk.export: the build or the public cut failed. data.diagnostics. */
  PublishFailed: -32020,
  /** site.stage: build/public/<slug>.html does not exist yet. */
  NotPublished: -32021,
  /** site.*: not a repository's top level, a version-control command failed, a YAML file does not parse. */
  SiteFailed: -32022,
} as const;

export const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const isSlug = (v: unknown) => typeof v === 'string' && SLUG_RE.test(v) && !v.includes('..') && v.length <= 120;
const absPath = (v: unknown) => typeof v === 'string' && v.startsWith('/');
const relPath = (v: unknown) => typeof v === 'string' && v.length > 0 && !v.startsWith('/') && !v.split('/').includes('..');
const KINDS = ['png', 'pdf'] as const, SITES = ['personal', 'lab'] as const, FILE_STATUS = ['added', 'modified', 'unchanged'] as const;
const strList = (v: unknown, at: string) => checkList(v, at, (x, a) => want(typeof x === 'string', `${a}: expected a string`));

export const publishParamCheckers: { [M in PublishMethodName]: (p: unknown) => Problems } = {
  'talk.publish': (p) => (p === undefined ? [] : shape(p, 'params', [], ['slug'], (v) => want(v.slug === undefined || isSlug(v.slug), 'params.slug: expected letters, digits, . _ -'))),
  'talk.export': (p) => shape(p, 'params', ['kind'], ['holds', 'around'], (v) => [
    ...oneOf(v.kind, KINDS, 'params.kind'),
    ...want(v.holds === undefined || v.holds === 'all' || (Array.isArray(v.holds) && v.holds.length > 0 && v.holds.every((h) => isInt(h) && h >= 1)), "params.holds: expected 'all' or a non-empty list of hold numbers"),
    ...want(v.around === undefined || (isNum(v.around) && v.around > 0 && v.around <= 10), 'params.around: expected seconds in (0, 10]'),
  ]),
  'site.stage': (p) => shape(p, 'params', ['site', 'repo', 'slug'], ['paperEntry'], (v) => [
    ...oneOf(v.site, SITES, 'params.site'),
    ...want(absPath(v.repo), 'params.repo: expected an absolute path'),
    ...want(isSlug(v.slug), 'params.slug: expected letters, digits, . _ -'),
    ...want(v.paperEntry === undefined || (typeof v.paperEntry === 'string' && v.paperEntry.trim().length > 0), 'params.paperEntry: expected a non-empty string'),
  ]),
  'talk.qr': (p) => shape(p, 'params', [], [...QR_NAMES], (v) => [
    ...want(QR_NAMES.some((k) => v[k] !== undefined), 'params: expected at least one of paper, slides, package'),
    ...QR_NAMES.flatMap((k) => want(v[k] === undefined || isUrl(v[k]), `params.${k}: expected an http(s) URL`)),
  ]),
  'site.commit': (p) => shape(p, 'params', ['repo', 'paths', 'message'], [], (v) => [
    ...want(absPath(v.repo), 'params.repo: expected an absolute path'),
    ...want(Array.isArray(v.paths) && v.paths.length > 0 && v.paths.every(relPath), 'params.paths: expected repo-relative paths'),
    ...want(typeof v.message === 'string' && v.message.trim().length > 0, 'params.message: expected a non-empty string'),
  ]),
};

export const publishResultCheckers: { [M in PublishMethodName]: (r: unknown) => Problems } = {
  'talk.publish': (r) => shape(r, 'result', ['path', 'bytes', 'holds', 'duration', 'warnings'], [], (v) => [
    ...want(absPath(v.path) && String(v.path).endsWith('.html'), 'result.path: expected an absolute .html path'),
    ...want(isInt(v.bytes) && v.bytes > 0, 'result.bytes: expected a positive integer'),
    ...want(isInt(v.holds) && v.holds >= 0, 'result.holds: expected a non-negative integer'),
    ...want(isNum(v.duration) && v.duration >= 0, 'result.duration: expected a non-negative number'),
    ...checkList(v.warnings, 'result.warnings', checkDiagnostic),
  ]),
  'talk.export': (r) => shape(r, 'result', ['kind', 'dir', 'files', 'frames', 'width', 'height', 'ms', 'errors'], [], (v) => [
    ...oneOf(v.kind, KINDS, 'result.kind'),
    ...want(absPath(v.dir), 'result.dir: expected an absolute path'),
    ...checkList(v.files, 'result.files', (x, at) => want(absPath(x), `${at}: expected an absolute path`)),
    ...want(isInt(v.frames) && v.frames >= 1, 'result.frames: expected a positive integer'),
    ...want(isInt(v.width) && isInt(v.height), 'result.width/height: expected integers'),
    ...want(isNum(v.ms) && v.ms >= 0, 'result.ms: expected a non-negative number'),
    ...strList(v.errors, 'result.errors'),
  ]),
  'site.stage': (r) => shape(r, 'result', ['site', 'repo', 'url', 'files', 'diff', 'notes'], [], (v) => [
    ...oneOf(v.site, SITES, 'result.site'),
    ...want(absPath(v.repo), 'result.repo: expected an absolute path'),
    ...want(typeof v.url === 'string' && v.url.startsWith('/'), 'result.url: expected a site path'),
    ...checkList(v.files, 'result.files', (x, at) => shape(x, at, ['path', 'status'], [], (f) => [
      ...want(relPath(f.path), `${at}.path: expected a repo-relative path`), ...oneOf(f.status, FILE_STATUS, `${at}.status`),
    ])),
    ...strs(v, ['diff'], 'result'),
    ...strList(v.notes, 'result.notes'),
  ]),
  'talk.qr': (r) => shape(r, 'result', ['files'], [], (v) => [
    ...checkList(v.files, 'result.files', (x, at) => want(typeof x === 'string' && /^assets\/qr-(paper|slides|package)\.svg$/.test(x), `${at}: expected assets/qr-<name>.svg`)),
  ]),
  'site.commit': (r) => shape(r, 'result', ['commit', 'summary'], [], (v) => [
    ...want(typeof v.commit === 'string' && /^[0-9a-f]{40,64}$/.test(v.commit), 'result.commit: expected a commit hash'),
    ...strs(v, ['summary'], 'result'),
  ]),
};

export const publishNotificationCheckers: { [N in PublishNotificationName]: (p: unknown) => Problems } = {
  'talk.exportProgress': (p) => shape(p, 'params', ['kind', 'done', 'total'], [], (v) => [
    ...oneOf(v.kind, KINDS, 'params.kind'),
    ...want(isInt(v.done) && isInt(v.total) && v.done >= 0 && v.total >= 1 && v.done <= v.total, 'params.done/total: expected 0 <= done <= total, total >= 1'),
  ]),
};

// =======================================================================================
// Setup (Phase 6, docs/packaging.md): the onboarding sheet's checks and the render browser
// download. `setup.*` methods skip the request queue and need no open talk. Fixtures:
// tests/rpc/setup/, checked by setup.test.ts and SetupProtocolTests.swift.
// =======================================================================================

export type RuntimeModeName = 'bundled' | 'development';
export type AuthState = 'login' | 'apiKey' | 'external' | 'none' | 'unknown';
export type BrowserStateName = 'chrome' | 'installed' | 'missing';

export interface AuthStatus {
  /** login: a Claude login (claude.ai or Console); apiKey: an API key; external: Bedrock, Vertex and the like. */
  state: AuthState;
  /** The account's email, when logged in. */
  account?: string;
  organization?: string;
  /** Subscription, e.g. "Claude Max". */
  plan?: string;
  /** Where the key or token comes from (ANTHROPIC_API_KEY, apiKeyHelper, ...). */
  source?: string;
  provider?: string;
  message?: string;
}

export interface BrowserStatus {
  state: BrowserStateName;
  /** The browser binary, or the folder a download goes to. */
  path?: string;
  /** True when setup.installBrowser can fetch it. */
  canInstall: boolean;
}

export interface SetupCheckParams {
  /** Also ask the Claude CLI for the account (a few seconds; never a model call). */
  auth?: boolean;
}

export interface SetupCheckResult {
  mode: RuntimeModeName;
  /** The app build (`git describe`), or 'development'. */
  version: string;
  /** process.version of the node running the sidecar, and its path. */
  node: string;
  nodePath: string;
  /** Missing engine, plugin or talkc files, as sentences. Empty when complete. */
  problems: string[];
  /** The Agent SDK's native claude binary; absent when not installed. */
  claudeBinary?: string;
  /** The talkc Claude runs (bin/talkc in the app; core's cli.ts in development). */
  talkc: string;
  browser: BrowserStatus;
  auth?: AuthStatus;
}

export interface SetupInstallResult {
  ok: boolean;
  message?: string;
  browser: BrowserStatus;
}

export interface SetupProgressParams {
  task: 'browser';
  /** 0...1 */
  fraction: number;
  message: string;
}

export interface SetupMethods {
  'setup.check': { params: SetupCheckParams | undefined; result: SetupCheckResult };
  /** Downloads Playwright's headless Chromium into Application Support; progress as setup.progress. */
  'setup.installBrowser': { params: Empty | undefined; result: SetupInstallResult };
}
export type SetupMethodName = keyof SetupMethods;
export interface SetupNotifications { 'setup.progress': SetupProgressParams }
export type SetupNotificationName = keyof SetupNotifications;

export const SETUP_METHOD_NAMES: readonly SetupMethodName[] = ['setup.check', 'setup.installBrowser'];
export const SETUP_NOTIFICATION_NAMES: readonly SetupNotificationName[] = ['setup.progress'];

const checkBrowserStatus = (b: unknown, at: string) => shape(b, at, ['state', 'canInstall'], ['path'], (v) => [
  ...oneOf(v.state, ['chrome', 'installed', 'missing'], `${at}.state`),
  ...want(typeof v.canInstall === 'boolean', `${at}.canInstall: expected a boolean`),
  ...optStrAt(v, 'path', at),
]);
const AUTH_OPTIONAL = ['account', 'organization', 'plan', 'source', 'provider', 'message'];
const checkAuthStatus = (a: unknown, at: string) => shape(a, at, ['state'], AUTH_OPTIONAL, (v) => [
  ...oneOf(v.state, ['login', 'apiKey', 'external', 'none', 'unknown'], `${at}.state`),
  ...AUTH_OPTIONAL.flatMap((k) => optStrAt(v, k, at)),
]);

export const setupParamCheckers: { [M in SetupMethodName]: (p: unknown) => Problems } = {
  'setup.check': (p) => (p === undefined ? [] : shape(p, 'params', [], ['auth'], (v) => want(v.auth === undefined || typeof v.auth === 'boolean', 'params.auth: expected a boolean'))),
  'setup.installBrowser': (p) => checkEmpty(p),
};

export const setupResultCheckers: { [M in SetupMethodName]: (r: unknown) => Problems } = {
  'setup.check': (r) => shape(r, 'result', ['mode', 'version', 'node', 'nodePath', 'problems', 'talkc', 'browser'], ['claudeBinary', 'auth'], (v) => [
    ...oneOf(v.mode, ['bundled', 'development'], 'result.mode'),
    ...strs(v, ['version', 'node', 'nodePath', 'talkc'], 'result'),
    ...checkList(v.problems, 'result.problems', (x, at) => want(typeof x === 'string', `${at}: expected a string`)),
    ...optStrAt(v, 'claudeBinary', 'result'),
    ...checkBrowserStatus(v.browser, 'result.browser'),
    ...(v.auth === undefined ? [] : checkAuthStatus(v.auth, 'result.auth')),
  ]),
  'setup.installBrowser': (r) => shape(r, 'result', ['ok', 'browser'], ['message'], (v) => [
    ...want(typeof v.ok === 'boolean', 'result.ok: expected a boolean'),
    ...optStrAt(v, 'message', 'result'),
    ...checkBrowserStatus(v.browser, 'result.browser'),
  ]),
};

export const setupNotificationCheckers: { [N in SetupNotificationName]: (p: unknown) => Problems } = {
  'setup.progress': (p) => shape(p, 'params', ['task', 'fraction', 'message'], [], (v) => [
    ...oneOf(v.task, ['browser'], 'params.task'),
    ...want(isNum(v.fraction) && v.fraction >= 0 && v.fraction <= 1, 'params.fraction: expected a number in 0...1'),
    ...strs(v, ['message'], 'params'),
  ]),
};

// =======================================================================================
// Themes and fonts (docs/rpc.md "Themes and fonts"): sage-theme/1 packages (.talktheme
// folders), applying one to the open talk, and Google fonts embedded into assets/fonts.
// Fixtures: tests/rpc/themes/, checked by themes-protocol.test.ts and ThemeProtocolTests.swift.
// theme.validate, theme.save and fonts.search need no open talk and skip the request queue.
// =======================================================================================

/** theme.json of a .talktheme (sage-theme/1; the schema is @sage/core's ThemeSchema). */
export type ThemeDoc = Theme;

export interface ThemeValidateParams {
  /** An absolute path to a .talktheme folder, or ... */
  path?: string;
  /** ... a theme.json object. Exactly one of the two. */
  theme?: unknown;
}
export interface ThemeValidateResult {
  ok: boolean;
  /** `field.path: message`, empty when ok. */
  problems: string[];
  /** The parsed theme (when its theme.json is valid). */
  theme?: ThemeDoc;
  /** Font files the package should hold and does not (path only); they are downloaded on save or apply. */
  missingFonts: string[];
}

export interface ThemeSaveParams {
  /** Absolute path ending in .talktheme; created or replaced. */
  path: string;
  theme: unknown;
}
export interface ThemeSaveResult {
  path: string;
  theme: ThemeDoc;
  /** Package-relative font files (fonts/<file>.woff2). */
  fonts: string[];
}

export interface ThemeApplyParams {
  /** Absolute path of a .talktheme folder. */
  path: string;
}
export interface ThemeApplyResult {
  theme: ThemeDoc;
  /** Talk-relative font files the theme embeds (assets/fonts/...). */
  fonts: string[];
  /** As talk.edit: talk.revert with edit.inverse restores the theme.css that was there. */
  edit: EditResult;
}

export interface ThemeExtractParams {
  /** Write the talk's theme there as a .talktheme (absolute, ending in .talktheme). Absent: only return it. */
  path?: string;
  id?: string;
  name?: string;
  description?: string;
}
export interface ThemeExtractResult {
  theme: ThemeDoc;
  path?: string;
  fonts: string[];
}

export interface FontInfoWire {
  id: string;
  family: string;
  category: string;
  weights: number[];
  styles: string[];
  subsets: string[];
  defSubset: string;
  variable: boolean;
  license: string;
}
export interface FontsSearchParams {
  /** Family name or part of it; empty: a suggested list. */
  query: string;
  category?: string;
  /** Default 40, at most 200. */
  limit?: number;
}
export interface FontsSearchResult {
  fonts: FontInfoWire[];
  /** Where the catalog came from: the cache, the network, or a stale cache (offline). */
  catalog: 'cache' | 'network' | 'stale';
}

export interface FontsAddParams {
  /** Fontsource id from fonts.search. */
  id: string;
  /** Default: 400 and 700 where the font has them. */
  weights?: number[];
  /** Default ['normal']. */
  styles?: ('normal' | 'italic')[];
  /** Default latin. */
  subset?: string;
}
export interface FontsAddResult {
  family: string;
  /** The CSS font-family value to use: the family quoted, then a fallback for its category. */
  fontFamily: string;
  /** Talk-relative files (assets/fonts/...). */
  files: string[];
  edit: EditResult;
}

export interface EmbeddedFont { family: string; id: string; subset: string; weights: number[]; styles: string[]; files: string[] }
export interface FontsListResult { fonts: EmbeddedFont[] }

export interface ThemeMethods {
  'theme.validate': { params: ThemeValidateParams; result: ThemeValidateResult };
  /** Writes a .talktheme (theme.json, generated theme.css, fonts/ downloaded as needed). */
  'theme.save': { params: ThemeSaveParams; result: ThemeSaveResult };
  /** Restyles the open talk: fonts into assets/fonts, the theme blocks into theme.css, then rebuilds. */
  'theme.apply': { params: ThemeApplyParams; result: ThemeApplyResult };
  /** The open talk's current theme; with path, saved as a .talktheme. */
  'theme.extract': { params: ThemeExtractParams | undefined; result: ThemeExtractResult };
  'fonts.search': { params: FontsSearchParams; result: FontsSearchResult };
  /** Downloads a Google font into assets/fonts and adds its @font-face rules (the fonts block). */
  'fonts.add': { params: FontsAddParams; result: FontsAddResult };
  'fonts.list': { params: Empty | undefined; result: FontsListResult };
}
export type ThemeMethodName = keyof ThemeMethods;
export const THEME_METHOD_NAMES: readonly ThemeMethodName[] = ['theme.validate', 'theme.save', 'theme.apply', 'theme.extract', 'fonts.search', 'fonts.add', 'fonts.list'];
/** These need no open talk and skip the request queue. */
export const THEME_CONCURRENT: readonly ThemeMethodName[] = ['theme.validate', 'theme.save', 'fonts.search'];

export const ThemeErrorCode = {
  /** theme.save / theme.apply: the theme does not validate. data.problems. */
  ThemeInvalid: -32030,
  /** A font could not be found, embedded (license) or downloaded. data.code: unknown-font, license, variant, network, not-woff2. */
  FontFailed: -32031,
} as const;

const themePath = (v: unknown) => absPath(v) && String(v).endsWith('.talktheme') && !String(v).split('/').includes('..');
const isWeight = (w: unknown) => isInt(w) && w >= 100 && w <= 900 && w % 100 === 0;
const FONT_STYLES = ['normal', 'italic'];
const checkThemeDoc = (v: unknown, at: string): Problems => parseTheme(v).problems.map((p) => `${at}.${p}`);
const checkFontInfo = (x: unknown, at: string) => shape(x, at, ['id', 'family', 'category', 'weights', 'styles', 'subsets', 'defSubset', 'variable', 'license'], [], (f) => [
  ...strs(f, ['id', 'family', 'category', 'defSubset', 'license'], at),
  ...checkList(f.weights, `${at}.weights`, (w, a) => want(isInt(w), `${a}: expected an integer`)),
  ...strList(f.styles, `${at}.styles`), ...strList(f.subsets, `${at}.subsets`),
  ...want(typeof f.variable === 'boolean', `${at}.variable: expected a boolean`),
]);
const fontFiles = (v: unknown, at: string, prefix: string) => checkList(v, at, (x, a) => want(typeof x === 'string' && x.startsWith(prefix) && x.endsWith('.woff2') && !x.includes('..'), `${a}: expected ${prefix}<file>.woff2`));

export const themeParamCheckers: { [M in ThemeMethodName]: (p: unknown) => Problems } = {
  'theme.validate': (p) => shape(p, 'params', [], ['path', 'theme'], (v) => [
    ...want((v.path === undefined) !== (v.theme === undefined), 'params: expected exactly one of path, theme'),
    ...want(v.path === undefined || themePath(v.path), 'params.path: expected an absolute .talktheme path'),
  ]),
  'theme.save': (p) => shape(p, 'params', ['path', 'theme'], [], (v) => [
    ...want(themePath(v.path), 'params.path: expected an absolute .talktheme path'),
    ...want(isObj(v.theme), 'params.theme: expected an object'),
  ]),
  'theme.apply': (p) => shape(p, 'params', ['path'], [], (v) => want(themePath(v.path), 'params.path: expected an absolute .talktheme path')),
  'theme.extract': (p) => (p === undefined ? [] : shape(p, 'params', [], ['path', 'id', 'name', 'description'], (v) => [
    ...want(v.path === undefined || themePath(v.path), 'params.path: expected an absolute .talktheme path'),
    ...want(v.id === undefined || (typeof v.id === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(v.id)), 'params.id: expected lowercase letters, digits and -'),
    ...optStrAt(v, 'name', 'params'), ...optStrAt(v, 'description', 'params'),
  ])),
  'fonts.search': (p) => shape(p, 'params', ['query'], ['category', 'limit'], (v) => [
    ...want(typeof v.query === 'string' && v.query.length <= 200, 'params.query: expected a string'),
    ...optStrAt(v, 'category', 'params'),
    ...want(v.limit === undefined || (isInt(v.limit) && v.limit >= 1 && v.limit <= 200), 'params.limit: expected 1...200'),
  ]),
  'fonts.add': (p) => shape(p, 'params', ['id'], ['weights', 'styles', 'subset'], (v) => [
    ...want(typeof v.id === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(v.id), 'params.id: expected a Fontsource id'),
    ...want(v.weights === undefined || (Array.isArray(v.weights) && v.weights.length > 0 && v.weights.every(isWeight)), 'params.weights: expected weights 100...900'),
    ...want(v.styles === undefined || (Array.isArray(v.styles) && v.styles.length > 0 && v.styles.every((s) => FONT_STYLES.includes(s as string))), "params.styles: expected 'normal' and/or 'italic'"),
    ...want(v.subset === undefined || (typeof v.subset === 'string' && /^[a-z0-9-]+$/.test(v.subset)), 'params.subset: expected a subset name'),
  ]),
  'fonts.list': (p) => checkEmpty(p),
};

export const themeResultCheckers: { [M in ThemeMethodName]: (r: unknown) => Problems } = {
  'theme.validate': (r) => shape(r, 'result', ['ok', 'problems', 'missingFonts'], ['theme'], (v) => [
    ...want(typeof v.ok === 'boolean', 'result.ok: expected a boolean'),
    ...strList(v.problems, 'result.problems'),
    ...(v.theme === undefined ? [] : checkThemeDoc(v.theme, 'result.theme')),
    ...fontFiles(v.missingFonts, 'result.missingFonts', 'fonts/'),
  ]),
  'theme.save': (r) => shape(r, 'result', ['path', 'theme', 'fonts'], [], (v) => [
    ...want(themePath(v.path), 'result.path: expected an absolute .talktheme path'),
    ...checkThemeDoc(v.theme, 'result.theme'),
    ...fontFiles(v.fonts, 'result.fonts', 'fonts/'),
  ]),
  'theme.apply': (r) => shape(r, 'result', ['theme', 'fonts', 'edit'], [], (v) => [
    ...checkThemeDoc(v.theme, 'result.theme'),
    ...fontFiles(v.fonts, 'result.fonts', 'assets/fonts/'),
    ...checkEditResult(v.edit).map((p) => p.replace(/^result/, 'result.edit')),
  ]),
  'theme.extract': (r) => shape(r, 'result', ['theme', 'fonts'], ['path'], (v) => [
    ...checkThemeDoc(v.theme, 'result.theme'),
    ...want(v.path === undefined || themePath(v.path), 'result.path: expected an absolute .talktheme path'),
    ...fontFiles(v.fonts, 'result.fonts', 'fonts/'),
  ]),
  'fonts.search': (r) => shape(r, 'result', ['fonts', 'catalog'], [], (v) => [
    ...checkList(v.fonts, 'result.fonts', checkFontInfo),
    ...oneOf(v.catalog, ['cache', 'network', 'stale'], 'result.catalog'),
  ]),
  'fonts.add': (r) => shape(r, 'result', ['family', 'fontFamily', 'files', 'edit'], [], (v) => [
    ...strs(v, ['family', 'fontFamily'], 'result'),
    ...fontFiles(v.files, 'result.files', 'assets/fonts/'),
    ...checkEditResult(v.edit).map((p) => p.replace(/^result/, 'result.edit')),
  ]),
  'fonts.list': (r) => shape(r, 'result', ['fonts'], [], (v) => checkList(v.fonts, 'result.fonts', (x, at) => shape(x, at, ['family', 'id', 'subset', 'weights', 'styles', 'files'], [], (f) => [
    ...strs(f, ['family', 'id', 'subset'], at),
    ...checkList(f.weights, `${at}.weights`, (w, a) => want(isWeight(w), `${a}: expected a weight`)),
    ...strList(f.styles, `${at}.styles`),
    ...fontFiles(f.files, `${at}.files`, 'assets/fonts/'),
  ]))),
};
