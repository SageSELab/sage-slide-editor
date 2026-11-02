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

  it('shoot: frames for holds, --times and --beats into build/shots, manifest, exit codes', async () => {
    const dir = tmpTalk("B.in('#h', 0);");
    try {
      const a = io();
      expect(await main(['shoot', dir], a.io)).toBe(0); // default: every hold
      expect(fs.readdirSync(path.join(dir, 'build/shots')).sort()).toEqual(['manifest.json', 't0002.000.png']);
      const out = path.join(dir, 'x'), b = io();
      expect(await main(['shoot', dir, '--times', '0.5,1', '--beats', 'c.a', '--around', '0.25', '--holds', '--out', out], b.io)).toBe(0);
      expect(b.o.out[0]).toMatch(/^shot 5 frames/);
      const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
      expect(m.frames.map((f: { t: number; kind: string }) => [f.t, f.kind])).toEqual([[0.5, 'time'], [1, 'time'], [1.75, 'before'], [2, 'hold'], [2.25, 'after']]);
      // an .html film is shot as is, next to itself by default
      const c = io();
      expect(await main(['shoot', path.join(dir, 'build/index.html'), '--times', '1'], c.io)).toBe(0);
      expect(fs.existsSync(path.join(dir, 'build/shots/t0001.000.png'))).toBe(true);
      const d = io();
      expect(await main(['shoot', dir, '--beats', 'c.nope'], d.io)).toBe(1);
      expect(d.o.err[0]).toMatch(/no beat "c\.nope"/);
      expect(await main(['shoot', dir, '--times', 'abc'], io().io)).toBe(2);
      expect(await main(['shoot', dir, '--around'], io().io)).toBe(2);
      expect(await main(['shoot', path.join(dir, 'missing')], io().io)).toBe(1);
      fs.writeFileSync(path.join(dir, 'beats/c.js'), 'Talk.beat(');
      expect(await main(['shoot', dir], io().io)).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true }); }
  }, 60_000);
});
