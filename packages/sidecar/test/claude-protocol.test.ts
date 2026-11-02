// Contract tests for the Claude section of the protocol: every fixture in tests/rpc/claude is a
// valid message of the kind and method its name says. ClaudeProtocolTests.swift decodes the same files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_REQUEST_NAMES, CLAUDE_METHOD_NAMES, CLAUDE_NOTIFICATION_NAMES, appRequestParamCheckers, appRequestResultCheckers,
  claudeNotificationCheckers, claudeParamCheckers, claudeResultCheckers, classify,
  type AppRequestName, type ClaudeMethodName, type ClaudeNotificationName,
} from '../src/protocol.ts';
import { RPC_FIXTURES } from './helpers.ts';

/** `claude.send.request.attachments.json` -> {method: 'claude.send', kind: 'request'} (as in protocol.test.ts). */
function parseFixtureName(file: string) {
  const tokens = path.basename(file, '.json').split('.');
  const k = tokens.findIndex((t) => ['request', 'response', 'notification', 'error'].includes(t));
  return { method: tokens.slice(0, k).join('.'), kind: tokens[k] };
}

const DIR = path.join(RPC_FIXTURES, 'claude');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const load = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const isClaude = (m: string): m is ClaudeMethodName => (CLAUDE_METHOD_NAMES as readonly string[]).includes(m);
const isApp = (m: string): m is AppRequestName => (APP_REQUEST_NAMES as readonly string[]).includes(m);

describe('tests/rpc/claude fixtures', () => {
  it.each(files)('%s', (f) => {
    const { method, kind } = parseFixtureName(f);
    const c = classify(load(f));
    expect(c.type, `${f} envelope`).toBe(kind);
    if (c.type === 'request') {
      expect(c.msg.method).toBe(method);
      const check = isClaude(method) ? claudeParamCheckers[method] : isApp(method) ? appRequestParamCheckers[method] : null;
      expect(check, `checker for ${method}`).not.toBeNull();
      expect(check!(c.msg.params)).toEqual([]);
    } else if (c.type === 'response') {
      const check = isClaude(method) ? claudeResultCheckers[method] : isApp(method) ? appRequestResultCheckers[method] : null;
      expect(check!(c.msg.result)).toEqual([]);
    } else if (c.type === 'notification') {
      expect(claudeNotificationCheckers[method as ClaudeNotificationName](c.msg.params)).toEqual([]);
    } else {
      throw new Error(`${f}: unexpected ${c.type}`);
    }
  });

  it('cover every Claude method, notification and app request', () => {
    const seen = files.map(parseFixtureName);
    for (const m of [...CLAUDE_METHOD_NAMES, ...APP_REQUEST_NAMES]) {
      expect(seen, `${m} request`).toContainEqual({ method: m, kind: 'request' });
      expect(seen, `${m} response`).toContainEqual({ method: m, kind: 'response' });
    }
    for (const n of CLAUDE_NOTIFICATION_NAMES) expect(seen, n).toContainEqual({ method: n, kind: 'notification' });
  });
});

describe('Claude validators reject drift', () => {
  it('bad values and unknown keys', () => {
    expect(claudeParamCheckers['claude.send']({ text: '  ' })).toEqual(['params.text: expected a non-empty string']);
    expect(claudeParamCheckers['claude.send']({ text: 'x', files: [] })).toEqual(["params: unexpected 'files'"]);
    expect(claudeParamCheckers['claude.send']({ text: 'x', effort: 'huge' })).toEqual(['params.effort: bad value']);
    expect(claudeNotificationCheckers['claude.tool']({ id: 'a', name: 'Edit', summary: '', status: 'ok' })).toEqual(['params.status: bad value']);
    expect(claudeNotificationCheckers['claude.tool']({ id: 'a', name: 'Edit', summary: '', status: 'done', path: '/abs' })).toEqual(['params.path: expected a relative path']);
    expect(appRequestResultCheckers['app.ask']({ decision: 'always' })).toEqual(['result.decision: bad value']);
    const r = (load('claude.result.notification.json') as { params: Record<string, unknown> }).params;
    expect(claudeNotificationCheckers['claude.result']({ ...r, usage: { ...(r.usage as object), contextTokens: -1 } })).toEqual(['params.usage.contextTokens: expected a non-negative integer']);
    expect(claudeNotificationCheckers['claude.result']({ ...r, error: { kind: 'oops', message: 'x' } })).toEqual(['params.error.kind: bad value']);
  });
});
