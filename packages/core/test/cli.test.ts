import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import { ISSTA } from './helpers.ts';

const io = () => { const o = { out: [] as string[], err: [] as string[] }; return { o, io: { out: (s: string) => o.out.push(s), err: (s: string) => o.err.push(s) } }; };

function tmpTalk(motion: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkc-cli-'));
  fs.mkdirSync(path.join(dir, 'scenes')); fs.mkdirSync(path.join(dir, 'beats'));
  fs.writeFileSync(path.join(dir, 'talk.json'), JSON.stringify({ format: 'sage-talk/1', title: 'T', chapters: [{ id: 'c', label: 'C', scene: 'scenes/c.html', beats: [{ id: 'a', label: 'A', notes: 'n', hold: 2 }] }] }, null, 2));
  fs.writeFileSync(path.join(dir, 'scenes/c.html'), '<div class="scene"><h1 id="h" data-a>x</h1></div>');
  fs.writeFileSync(path.join(dir, 'beats/c.js'), `Talk.beat('c.a', (B) => { ${motion} });`);
  return dir;
}

describe('talkc', () => {
  it('usage errors exit 2', () => {
    const a = io();
    expect(main([], a.io)).toBe(2);
    expect(main(['frobnicate', 'x'], a.io)).toBe(2);
    expect(main(['layout', 'x', '--nope'], a.io)).toBe(2);
    expect(main(['--help'], a.io)).toBe(0);
  });

  it('layout prints the hold list like ?cplist', () => {
    const a = io();
    expect(main(['layout', ISSTA], a.io)).toBe(0);
    expect(a.o.out[0]!.split('\n')[0]).toBe('1 5.0 Title');
  });

  it('layout --json prints the layout object', () => {
    const a = io();
    expect(main(['layout', ISSTA, '--json'], a.io)).toBe(0);
    expect(JSON.parse(a.o.out[0]!).beats[0]).toMatchObject({ id: 'line.title', hold: 5 });
  });

  it('validate: exit 0 with warnings only, 1 with errors; human and --json output', () => {
    const ok = tmpTalk("B.in('#h', 0);"), bad = tmpTalk("B.in('#h', -1);");
    try {
      const a = io();
      expect(main(['validate', ok], a.io)).toBe(0);
      expect(a.o.out.at(-1)).toBe('0 errors, 0 warnings, 0 infos');
      const b = io();
      expect(main(['validate', bad], b.io)).toBe(1);
      expect(b.o.out[0]).toMatch(/^beats\/c\.js:1:\d+: error ghost-entrance: /);
      const c = io();
      expect(main(['validate', bad, '--json'], c.io)).toBe(1);
      expect(JSON.parse(c.o.out[0]!)).toMatchObject({ ok: false, diagnostics: [{ code: 'ghost-entrance', severity: 'error', file: 'beats/c.js', line: 1 }] });
    } finally { fs.rmSync(ok, { recursive: true }); fs.rmSync(bad, { recursive: true }); }
  });

  it('build writes build/index.html (exit 0) and fails on a syntax error (exit 1)', () => {
    const dir = tmpTalk("B.in('#h', 0);");
    try {
      const a = io();
      expect(main(['build', dir, '--out', path.join(dir, 'out')], a.io)).toBe(0);
      expect(fs.existsSync(path.join(dir, 'out/index.html'))).toBe(true);
      fs.writeFileSync(path.join(dir, 'beats/c.js'), 'Talk.beat(');
      const b = io();
      expect(main(['build', dir], b.io)).toBe(1);
      expect(b.o.err[0]).toMatch(/script-syntax/);
    } finally { fs.rmSync(dir, { recursive: true }); }
  });
});
