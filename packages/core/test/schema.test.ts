import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, parseSpine, SpineSchema } from '../src/schema.ts';
import { parseJsonAst } from '../src/jsonast.ts';
import { ISSTA, spineOf } from './helpers.ts';

describe('schema', () => {
  it('declares the format version', () => expect(FORMAT_VERSION).toBe('sage-talk/1'));

  it('accepts the ISSTA fixture spine (read at test time)', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ISSTA, 'talk.json'), 'utf8'));
    const r = parseSpine(raw);
    expect(r.spine).not.toBeNull();
    expect(r.diagnostics).toEqual([]);
  });

  it('accepts the PLAN 3.1 example shape (materials, public, empty beats)', () => {
    const r = SpineSchema.safeParse({
      format: 'sage-talk/1', title: 't', stage: { width: 1920, height: 1080 }, materials: { paper: '../paper' },
      defaults: { holdPad: 1 }, chapters: [{ id: 'omt', label: 'x', dark: true, private: true, beats: [] }, { id: 'b', label: 'B', backup: true }],
      public: { scene: 'scenes/end.html', beats: [{ id: 'end', label: 'Paper' }] },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.chapters[1]!.beats).toEqual([]);
  });

  it.each([
    ['wrong format', { ...spineOf([]), format: 'sage-talk/2' }, 'format'],
    ['missing title', { format: 'sage-talk/1', chapters: [] }, 'title'],
    ['dotted beat id', spineOf([{ id: 'c', beats: [{ id: 'a.b' }] }]), 'chapters.0.beats.0.id'],
    ['negative hold', spineOf([{ id: 'c', beats: [{ id: 'a', hold: -1 }] }]), 'chapters.0.beats.0.hold'],
    ['chapters not an array', { format: 'sage-talk/1', title: 't', chapters: {} }, 'chapters'],
  ])('rejects %s with schema-invalid at the right path', (_n, raw, p) => {
    const r = parseSpine(raw);
    expect(r.spine).toBeNull();
    expect(r.diagnostics.map((d) => d.code)).toContain('schema-invalid');
    expect(r.diagnostics.find((d) => d.code === 'schema-invalid')!.message.startsWith(p + ':')).toBe(true);
  });

  it('locates diagnostics in the source text', () => {
    const text = JSON.stringify(spineOf([{ id: 'c', beats: [{ id: 'a', hold: -1 }] }]), null, 2);
    const r = parseSpine(JSON.parse(text), { file: 'talk.json', text, ast: parseJsonAst(text) });
    const d = r.diagnostics[0]!;
    expect(d.file).toBe('talk.json');
    expect(text.split('\n')[d.line! - 1]).toContain('"hold": -1');
  });

  it('reports unknown keys as warnings and still parses', () => {
    const r = parseSpine({ ...spineOf([{ id: 'c', beats: [{ id: 'a' }] }]), colour: 'red' });
    expect(r.spine).not.toBeNull();
    expect(r.diagnostics).toMatchObject([{ code: 'schema-unknown-key', severity: 'warning' }]);
  });
});
