// Contract tests for the publish section of the protocol: every fixture in tests/rpc/publish is a
// valid message of the kind and method its name says. PublishProtocolTests.swift decodes the same files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PUBLISH_METHOD_NAMES, PUBLISH_NOTIFICATION_NAMES, PublishErrorCode, checkErrorObject, classify,
  publishNotificationCheckers, publishParamCheckers, publishResultCheckers,
  type PublishMethodName, type PublishNotificationName,
} from '../src/protocol.ts';
import { RPC_FIXTURES } from './helpers.ts';

function parseFixtureName(file: string) {
  const tokens = path.basename(file, '.json').split('.');
  const k = tokens.findIndex((t) => ['request', 'response', 'notification', 'error'].includes(t));
  return { method: tokens.slice(0, k).join('.'), kind: tokens[k] };
}

const DIR = path.join(RPC_FIXTURES, 'publish');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const load = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

describe('tests/rpc/publish fixtures', () => {
  it.each(files)('%s', (f) => {
    const { method, kind } = parseFixtureName(f);
    const c = classify(load(f));
    expect(c.type, `${f} envelope`).toBe(kind);
    if (c.type === 'request') {
      expect(c.msg.method).toBe(method);
      expect(publishParamCheckers[method as PublishMethodName](c.msg.params)).toEqual([]);
    } else if (c.type === 'response') {
      expect(publishResultCheckers[method as PublishMethodName](c.msg.result)).toEqual([]);
    } else if (c.type === 'notification') {
      expect(publishNotificationCheckers[method as PublishNotificationName](c.msg.params)).toEqual([]);
    } else if (c.type === 'error') {
      expect(checkErrorObject(c.msg.error)).toEqual([]);
      expect(Object.values(PublishErrorCode)).toContain(c.msg.error.code);
    } else throw new Error(`${f}: ${c.type}`);
  });

  it('cover every publish method, notification and error code', () => {
    const seen = files.map(parseFixtureName);
    for (const m of PUBLISH_METHOD_NAMES) {
      expect(seen, `${m} request`).toContainEqual({ method: m, kind: 'request' });
      expect(seen, `${m} response`).toContainEqual({ method: m, kind: 'response' });
    }
    for (const n of PUBLISH_NOTIFICATION_NAMES) expect(seen, n).toContainEqual({ method: n, kind: 'notification' });
    const codes = files.filter((f) => f.startsWith('error.')).map((f) => (load(f) as { error: { code: number } }).error.code);
    expect(new Set(codes)).toEqual(new Set(Object.values(PublishErrorCode)));
  });
});

describe('publish validators reject drift', () => {
  it('bad params', () => {
    expect(publishParamCheckers['talk.publish']({ slug: 'a/b' })).toEqual(['params.slug: expected letters, digits, . _ -']);
    expect(publishParamCheckers['talk.publish']({ slug: '..' })).toEqual(['params.slug: expected letters, digits, . _ -']);
    expect(publishParamCheckers['talk.export']({ kind: 'png', holds: [] })).toEqual(["params.holds: expected 'all' or a non-empty list of hold numbers"]);
    expect(publishParamCheckers['talk.export']({ kind: 'png', holds: [0] })).toEqual(["params.holds: expected 'all' or a non-empty list of hold numbers"]);
    expect(publishParamCheckers['talk.export']({ kind: 'pdf', around: 0 })).toEqual(['params.around: expected seconds in (0, 10]']);
    expect(publishParamCheckers['site.stage']({ site: 'blog', repo: '/r', slug: 's' })).toEqual(['params.site: bad value']);
    expect(publishParamCheckers['site.stage']({ site: 'lab', repo: '/r', slug: 's', paperEntry: ' ' })).toEqual(['params.paperEntry: expected a non-empty string']);
    expect(publishParamCheckers['site.commit']({ repo: '/r', paths: ['a/../../b'], message: 'm' })).toEqual(['params.paths: expected repo-relative paths']);
    expect(publishParamCheckers['site.commit']({ repo: '/r', paths: ['a'], message: '', push: true })).toEqual(["params: unexpected 'push'", 'params.message: expected a non-empty string']);
  });
  it('bad results', () => {
    const r = (load('site.stage.response.json') as { result: Record<string, unknown> }).result;
    expect(publishResultCheckers['site.stage']({ ...r, files: [{ path: '/abs', status: 'added' }] })).toEqual(['result.files[0].path: expected a repo-relative path']);
    expect(publishResultCheckers['site.commit']({ commit: 'HEAD', summary: '' })).toEqual(['result.commit: expected a commit hash']);
    expect(publishNotificationCheckers['talk.exportProgress']({ kind: 'png', done: 3, total: 2 })).toEqual(['params.done/total: expected 0 <= done <= total, total >= 1']);
  });
});
