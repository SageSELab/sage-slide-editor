// sage-core.ts — CorePort on top of the real @sage/core (replaces the Phase 0 stub).
//
// Every call reloads the talk from disk: loading is cheap (a few ms for the ISSTA deck) and it
// guarantees layout, validate and compile see what the watcher just reported, with no cache to
// invalidate. `load` keeps the stub's NotATalkError contract for folders that are not talks.
import { compileTalk, loadTalk, recordTalk, validateTalk, type Diagnostic as CoreDiagnostic } from '@sage/core';
import { stubCore, type CorePort } from './core-port.ts';
import type { Diagnostic, Hold } from './protocol.ts';

const toDiag = (d: CoreDiagnostic): Diagnostic => {
  const out: Diagnostic = { severity: d.severity, code: d.code, message: d.message };
  if (d.file) out.file = d.line ? `${d.file}:${d.line}${d.col ? `:${d.col}` : ''}` : d.file;
  if (d.beat) out.beat = d.beat;
  return out;
};

export const sageCore: CorePort = {
  // The stub's loader already enforces the sidecar's contract (exists, has talk.json, sage-talk/1).
  load: (root) => stubCore.load(root),

  async layout({ root }) {
    const talk = loadTalk(root);
    if (!talk.spine) return { holds: [], duration: 0, diagnostics: talk.diagnostics.map(toDiag) };
    const rec = recordTalk(talk);
    const lay = rec.layout;
    const holds: Hold[] = lay.beats.map((b, i) => ({
      index: i + 1, at: b.at, label: b.label, backup: b.backup, beat: b.id, chapter: b.chapter, auto: b.auto,
    }));
    return { holds, duration: lay.duration, diagnostics: rec.diagnostics.map(toDiag) };
  },

  async validate({ root }) {
    const talk = loadTalk(root);
    return validateTalk(talk, talk.spine ? recordTalk(talk) : undefined).map(toDiag);
  },

  async compile({ root }) {
    const t0 = performance.now();
    const res = compileTalk(root);
    return { ok: res.ok, diagnostics: res.diagnostics.map(toDiag), ms: Math.round(performance.now() - t0) };
  },
};

