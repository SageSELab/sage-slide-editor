// @sage/core — the sage-talk/1 format: schema, loader, layout, recorder, validator,
// compiler, and the source-edit API. See PLAN.md sections 3 and 4.
export { FORMAT_VERSION, SpineSchema, BeatSchema, ChapterSchema, PublicSchema, DEFAULT_HOLD_PAD, DEFAULT_TAIL, parseSpine } from './schema.ts';
export type { TalkSpine, ChapterSpec, BeatSpec, BeatInput, PublicSpec } from './schema.ts';
export { diag, formatDiagnostic, hasErrors, lineCol, type Diagnostic, type Severity } from './diagnostics.ts';
export { loadTalk, loadTalkFrom, diskHost, memoryHost, motionPath, talkFiles, SPINE_FILE } from './load.ts';
export type { LoadedTalk, SourceFile, FileHost, ChapterSources } from './load.ts';
export { layout, layoutChapters, beatHold, formatCplist, r6 } from './layout.ts';
export type { Layout, BeatLayout, ChapterLayout, Checkpoint, LastEnds, LayoutOptions } from './layout.ts';
export { recordTalk, lastEnds } from './record.ts';
export type { LibUsage, Recording, BeatRecording, MotionCall, CallLoc, CallKind, RecordedElement } from './record.ts';
export { validateTalk, sortDiagnostics, type ValidateOptions } from './validate.ts';
export { compileTalk, renderIndex, checkScript, ENGINE_FILES, DEFAULT_ENGINE_DIR, type CompileOptions, type CompileResult } from './compile.ts';
export { publishTalk, renderPublic, publicSpine, publicCut, PUBLIC_CSS, type PublishOptions, type PublishResult, type PublishCut } from './publish.ts';
export * from './edit.ts';
export { sceneElements, type SceneElement } from './html.ts';
export { parseJsonAst, JsonSyntaxError, type JsonNode } from './jsonast.ts';
export { main as talkc } from './cli.ts';
