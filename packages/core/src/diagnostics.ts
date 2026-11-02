// diagnostics.ts — the one diagnostic shape every @sage/core module reports in.
// Codes are stable strings (documented in validate.ts); severity drives `talkc` exit codes.

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** Stable machine code, e.g. `duplicate-element-id`. */
  code: string;
  severity: Severity;
  message: string;
  /** Path relative to the talk folder (e.g. `scenes/line.html`), when the problem has a file. */
  file?: string | undefined;
  /** 1-based line and column, when known. */
  line?: number | undefined;
  col?: number | undefined;
  /** `chapter.beat` id, when the problem belongs to a beat. */
  beat?: string | undefined;
}

/** 1-based line/column of a 0-based offset in `text`. */
export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1, last = -1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) { line++; last = i; }
  return { line, col: offset - last };
}

export function diag(
  code: string, severity: Severity, message: string,
  where: { file?: string | undefined; text?: string | undefined; offset?: number | undefined; line?: number | undefined; col?: number | undefined; beat?: string | undefined } = {},
): Diagnostic {
  const d: Diagnostic = { code, severity, message };
  if (where.file !== undefined) d.file = where.file;
  if (where.text !== undefined && where.offset !== undefined) Object.assign(d, lineCol(where.text, where.offset));
  else { if (where.line !== undefined) d.line = where.line; if (where.col !== undefined) d.col = where.col; }
  if (where.beat !== undefined) d.beat = where.beat;
  return d;
}

export const hasErrors = (ds: readonly Diagnostic[]): boolean => ds.some((d) => d.severity === 'error');

/** `file:line:col: severity code message` — the human format of `talkc validate`. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}${d.col ? `:${d.col}` : ''}` : ''}: ` : '';
  return `${where}${d.severity} ${d.code}: ${d.message}${d.beat ? ` [${d.beat}]` : ''}`;
}
