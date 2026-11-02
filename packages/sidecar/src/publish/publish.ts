// publish.ts — talk.publish: @sage/core's publishTalk (talkc publish) for the open talk, plus a
// final leak check on the file it wrote. The core already warns when a private label or a note
// appears in a file it ships; this also searches the finished page itself, which is what goes
// on the web (it catches text that reaches the page another way, such as the spine). Text the
// engine itself carries (a CSS comment naming "One more thing") is the same in every talk and
// is not a leak.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ENGINE_DIR, ENGINE_FILES, loadTalk, privateNeedles, publishTalk, type Diagnostic as CoreDiagnostic } from '@sage/core';
import { RpcError, PublishErrorCode, type Diagnostic, type PublishResult } from '../protocol.ts';

/** `My Talk (v2)` -> `my-talk-v2`. */
export const slugify = (s: string) => s.normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '') || 'talk';

const toWire = (d: CoreDiagnostic): Diagnostic => {
  const out: Diagnostic = { severity: d.severity, code: d.code, message: d.message };
  if (d.file) out.file = d.line ? `${d.file}:${d.line}` : d.file;
  if (d.beat) out.beat = d.beat;
  return out;
};

export function publishOpenTalk(root: string, slug = slugify(path.basename(root))): PublishResult {
  const r = publishTalk(root, { slug });
  const diagnostics = r.diagnostics.map(toWire);
  if (!r.ok || !r.outFile) {
    const first = diagnostics.find((d) => d.severity === 'error');
    throw new RpcError(PublishErrorCode.PublishFailed, `publish failed${first ? `: ${first.message}` : ''}`, { diagnostics });
  }
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  const html = fs.readFileSync(r.outFile, 'utf8');
  const reported = new Set(warnings.map((w) => w.message));
  const engine = ENGINE_FILES.map((f) => { try { return fs.readFileSync(path.join(DEFAULT_ENGINE_DIR, f), 'utf8'); } catch { return ''; } }).join('\n');
  for (const n of privateNeedles(loadTalk(root))) {
    if (!html.includes(n.text) || engine.includes(n.text)) continue;
    const message = `${n.what} "${n.text}" appears in the published page`;
    if ([...reported].some((m) => m.includes(`"${n.text}"`))) continue; // the core already named its source file
    warnings.push({ severity: 'warning', code: 'publish-private-leak', message, file: path.relative(root, r.outFile) });
  }
  return { path: r.outFile, bytes: r.bytes, holds: r.holds, duration: r.duration, warnings };
}
