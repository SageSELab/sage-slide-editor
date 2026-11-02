// Contract tests for the themes section of the protocol: every fixture in tests/rpc/themes is a
// valid message of the kind and method its name says. ThemeProtocolTests.swift decodes the same files.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  THEME_METHOD_NAMES, ThemeErrorCode, checkErrorObject, classify, themeParamCheckers, themeResultCheckers,
  type ThemeMethodName,
} from '../src/protocol.ts';
import { RPC_FIXTURES } from './helpers.ts';

function parseFixtureName(file: string) {
  const tokens = path.basename(file, '.json').split('.');
  const k = tokens.findIndex((t) => ['request', 'response', 'notification', 'error'].includes(t));
  return { method: tokens.slice(0, k).join('.'), kind: tokens[k] };
}

const DIR = path.join(RPC_FIXTURES, 'themes');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
const load = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

describe('tests/rpc/themes fixtures', () => {
  it.each(files)('%s', (f) => {
    const { method, kind } = parseFixtureName(f);
    const c = classify(load(f));
    expect(c.type, `${f} envelope`).toBe(kind);
    if (c.type === 'request') {
      expect(c.msg.method).toBe(method);
      expect(themeParamCheckers[method as ThemeMethodName](c.msg.params)).toEqual([]);
    } else if (c.type === 'response') {
      expect(themeResultCheckers[method as ThemeMethodName](c.msg.result)).toEqual([]);
    } else if (c.type === 'error') {
      expect(checkErrorObject(c.msg.error)).toEqual([]);
      expect(Object.values(ThemeErrorCode)).toContain(c.msg.error.code);
    } else throw new Error(`${f}: ${c.type}`);
  });

  it('cover every theme method and error code', () => {
    const seen = files.map(parseFixtureName);
    for (const m of THEME_METHOD_NAMES) {
      expect(seen, `${m} request`).toContainEqual({ method: m, kind: 'request' });
      expect(seen, `${m} response`).toContainEqual({ method: m, kind: 'response' });
    }
    const codes = files.filter((f) => f.startsWith('error.')).map((f) => (load(f) as { error: { code: number } }).error.code);
    expect(new Set(codes)).toEqual(new Set(Object.values(ThemeErrorCode)));
  });
});

describe('theme validators reject drift', () => {
  it('bad params', () => {
    expect(themeParamCheckers['theme.apply']({ path: 'relative.talktheme' })).toEqual(['params.path: expected an absolute .talktheme path']);
    expect(themeParamCheckers['theme.apply']({ path: '/a/b.theme' })).toEqual(['params.path: expected an absolute .talktheme path']);
    expect(themeParamCheckers['theme.validate']({})).toEqual(['params: expected exactly one of path, theme']);
    expect(themeParamCheckers['theme.validate']({ path: '/a.talktheme', theme: {} })).toEqual(['params: expected exactly one of path, theme']);
    expect(themeParamCheckers['fonts.add']({ id: 'Lora' })).toEqual(['params.id: expected a Fontsource id']);
    expect(themeParamCheckers['fonts.add']({ id: 'lora', weights: [450] })).toEqual(['params.weights: expected weights 100...900']);
    expect(themeParamCheckers['fonts.add']({ id: 'lora', styles: ['oblique'] })).toEqual(["params.styles: expected 'normal' and/or 'italic'"]);
    expect(themeParamCheckers['fonts.search']({ query: 'x', limit: 0 })).toEqual(['params.limit: expected 1...200']);
    expect(themeParamCheckers['fonts.list']({ x: 1 })).toEqual(["params: unexpected 'x'"]);
  });
  it('bad results', () => {
    const r = (load('theme.apply.response.json') as { result: Record<string, unknown> }).result;
    expect(themeResultCheckers['theme.apply']({ ...r, fonts: ['fonts/x.woff2'] })).toEqual(['result.fonts[0]: expected assets/fonts/<file>.woff2']);
    const bad = { ...(r.theme as Record<string, unknown>), format: 'sage-theme/2' };
    expect(themeResultCheckers['theme.apply']({ ...r, theme: bad })[0]).toMatch(/^result\.theme\.format:/);
    expect(themeResultCheckers['theme.apply']({ ...r, edit: { ...(r.edit as object), ok: 'yes' } })).toEqual(['result.edit.ok: expected a boolean']);
  });
});
