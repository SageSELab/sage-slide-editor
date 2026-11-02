// policy.ts — what canUseTool does with each tool call (PLAN 6.1, 12.7).
//
//   reads (Read, Glob, Grep, LS, NotebookRead) inside the talk or a materials folder  allow
//   writes (Write, Edit, MultiEdit, NotebookEdit) inside the talk                       allow, and the
//       predicted content is announced to the watcher so the change is labelled 'claude'
//   the app's own tools, Skill, ToolSearch, TodoWrite                                   allow
//   AskUserQuestion                                                                     deny (no UI for it;
//       Claude asks in its reply instead)
//   anything else (Bash, writes outside the talk, reads elsewhere, web, subagents)      ask the app, unless
//       a rule the user saved with "Allow for this talk" (.sage/permissions.json) matches
//
// Pure functions plus a tiny store, so the policy is unit-tested without an SDK process.
import fs from 'node:fs';
import path from 'node:path';
import { absFrom, relInside, within } from './paths.ts';

export const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export const SAFE_TOOLS = new Set(['Skill', 'ToolSearch', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
export const APP_TOOL_PREFIX = 'mcp__talk__';

/** A saved "Allow for this talk" grant. */
export interface PermissionRule {
  tool: string;
  /** Bash: the command's first two words. File tools: an absolute folder. WebFetch: a host. */
  prefix?: string;
}

export interface PolicyContext {
  talkRoot: string;
  /** Folders reads are free in: the talk and its materials. */
  readRoots: string[];
  rules: readonly PermissionRule[];
}

export interface Announce { rel: string; content: string }

export type Decision =
  | { kind: 'allow'; announce?: Announce; why: string }
  | { kind: 'deny'; message: string }
  | { kind: 'ask'; reason: string; rule: PermissionRule; scope: string; path?: string };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The path argument of a file tool, absolute. Glob/Grep without a path search the cwd. */
export function toolPath(toolName: string, input: Record<string, unknown>, talkRoot: string): string | undefined {
  const p = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  if (p) return absFrom(talkRoot, p);
  if (toolName === 'Glob' || toolName === 'Grep' || toolName === 'LS') return talkRoot;
  return undefined;
}

const SHELL_META = /[;&|`$<>(){}\n\\]/;

/** First two words of a simple command; null for anything with shell metacharacters. */
export function bashPrefix(command: string): string | null {
  const c = command.trim();
  if (!c || SHELL_META.test(c)) return null;
  return c.split(/\s+/).slice(0, 2).join(' ');
}

export function matches(rule: PermissionRule, toolName: string, input: Record<string, unknown>, talkRoot: string): boolean {
  if (rule.tool !== toolName) return false;
  if (rule.prefix === undefined) return true;
  if (toolName === 'Bash') {
    const c = str(input.command);
    const p = c ? bashPrefix(c) : null;
    // A rule is only ever saved for a simple command; compound commands always ask again.
    return p !== null && (p === rule.prefix || (c!.trim() + ' ').startsWith(rule.prefix + ' '));
  }
  if (toolName === 'WebFetch') {
    try { return new URL(str(input.url) ?? '').host === rule.prefix; } catch { return false; }
  }
  const p = toolPath(toolName, input, talkRoot);
  return p !== undefined && within(p, rule.prefix);
}

/** The rule "Allow for this talk" would save for this call, and how to describe it. */
export function ruleFor(toolName: string, input: Record<string, unknown>, talkRoot: string): { rule: PermissionRule; scope: string } {
  if (toolName === 'Bash') {
    const c = str(input.command) ?? '';
    const p = bashPrefix(c);
    // Compound commands get an exact-match rule, which matches() never accepts, so they keep asking.
    return p ? { rule: { tool: 'Bash', prefix: p }, scope: `Bash commands starting with "${p}"` } : { rule: { tool: 'Bash', prefix: c.trim() }, scope: 'this exact command' };
  }
  if (toolName === 'WebFetch') {
    let host = '';
    try { host = new URL(str(input.url) ?? '').host; } catch { /* no host */ }
    return host ? { rule: { tool: 'WebFetch', prefix: host }, scope: `WebFetch from ${host}` } : { rule: { tool: 'WebFetch' }, scope: 'WebFetch' };
  }
  const p = toolPath(toolName, input, talkRoot);
  if (p) {
    const dir = READ_TOOLS.has(toolName) && toolName !== 'Read' ? p : path.dirname(p);
    const shown = path.relative(talkRoot, dir) || '.';
    return { rule: { tool: toolName, prefix: dir }, scope: `${toolName} in ${shown}` };
  }
  return { rule: { tool: toolName }, scope: `every ${toolName} call` };
}

/** Applies Edit / MultiEdit / Write to the current file text; null when the result cannot be predicted. */
export function predictWrite(toolName: string, input: Record<string, unknown>, current: string | null): string | null {
  if (toolName === 'Write') return typeof input.content === 'string' ? input.content : null;
  const apply = (text: string, e: Record<string, unknown>): string | null => {
    const o = e.old_string, n = e.new_string;
    if (typeof o !== 'string' || typeof n !== 'string') return null;
    if (o === '') return text === '' ? n : null;
    const i = text.indexOf(o);
    if (i < 0) return null;
    return e.replace_all === true ? text.split(o).join(n) : text.slice(0, i) + n + text.slice(i + o.length);
  };
  if (current === null) return null;
  if (toolName === 'Edit') return apply(current, input);
  if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
    let t: string | null = current;
    for (const e of input.edits) { if (t === null || typeof e !== 'object' || !e) return null; t = apply(t, e as Record<string, unknown>); }
    return t;
  }
  return null;
}

function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

export function decide(toolName: string, input: Record<string, unknown>, ctx: PolicyContext): Decision {
  if (toolName.startsWith(APP_TOOL_PREFIX) || SAFE_TOOLS.has(toolName)) return { kind: 'allow', why: 'app tool' };
  if (toolName === 'AskUserQuestion') {
    return { kind: 'deny', message: 'The SAGE chat pane cannot show multiple-choice questions. Ask the user in your reply and wait for their answer.' };
  }
  const p = toolPath(toolName, input, ctx.talkRoot);
  if (READ_TOOLS.has(toolName) && p && ctx.readRoots.some((r) => within(p, r))) return { kind: 'allow', why: 'read in talk or materials' };
  if (WRITE_TOOLS.has(toolName) && p) {
    const rel = relInside(ctx.talkRoot, p);
    if (rel !== null) {
      const content = predictWrite(toolName, input, readText(p));
      return content === null ? { kind: 'allow', why: 'write in talk' } : { kind: 'allow', why: 'write in talk', announce: { rel, content } };
    }
  }
  if (ctx.rules.some((r) => matches(r, toolName, input, ctx.talkRoot))) return { kind: 'allow', why: 'saved rule' };
  const { rule, scope } = ruleFor(toolName, input, ctx.talkRoot);
  let reason: string;
  if (WRITE_TOOLS.has(toolName)) reason = 'Writes outside the talk folder need your approval.';
  else if (READ_TOOLS.has(toolName)) reason = 'Reads outside the talk and its materials need your approval.';
  else if (toolName === 'Bash') reason = 'Shell commands can change files anywhere.';
  else reason = `${toolName} is not pre-approved in SAGE.`;
  return { kind: 'ask', reason, rule, scope, ...(p ? { path: p } : {}) };
}

/** "Allow for this talk" grants, persisted in <talk>/.sage/permissions.json. */
export class PermissionStore {
  private list: PermissionRule[] = [];
  constructor(readonly talkRoot: string) { this.list = PermissionStore.read(talkRoot); }

  static file(talkRoot: string) { return path.join(talkRoot, '.sage', 'permissions.json'); }

  static read(talkRoot: string): PermissionRule[] {
    try {
      const j = JSON.parse(fs.readFileSync(PermissionStore.file(talkRoot), 'utf8')) as { rules?: unknown };
      return Array.isArray(j.rules)
        ? j.rules.filter((r): r is PermissionRule => !!r && typeof (r as PermissionRule).tool === 'string' && ((r as PermissionRule).prefix === undefined || typeof (r as PermissionRule).prefix === 'string'))
        : [];
    } catch { return []; }
  }

  get rules(): readonly PermissionRule[] { return this.list; }

  add(rule: PermissionRule) {
    if (this.list.some((r) => r.tool === rule.tool && r.prefix === rule.prefix)) return;
    this.list.push(rule);
    const f = PermissionStore.file(this.talkRoot);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ rules: this.list }, null, 2) + '\n');
  }
}
