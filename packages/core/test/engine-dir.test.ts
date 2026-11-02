// The engine folder default: packages/engine/src, or SAGE_ENGINE_DIR (the packaged app's sidecar).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileTalk, DEFAULT_ENGINE_DIR, defaultEngineDir, ENGINE_FILES } from '../src/index.ts';

describe('defaultEngineDir', () => {
  it('is packages/engine/src unless SAGE_ENGINE_DIR is set', () => {
    expect(defaultEngineDir({})).toBe(DEFAULT_ENGINE_DIR);
    expect(defaultEngineDir({ SAGE_ENGINE_DIR: '' })).toBe(DEFAULT_ENGINE_DIR);
    expect(defaultEngineDir({ SAGE_ENGINE_DIR: '/x/engine' })).toBe('/x/engine');
    for (const f of ENGINE_FILES) expect(fs.existsSync(path.join(DEFAULT_ENGINE_DIR, f)), f).toBe(true);
  });

  it('compileTalk copies the engine from SAGE_ENGINE_DIR, read at call time', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sage-engine-dir-'));
    const engine = path.join(base, 'engine');
    fs.mkdirSync(engine);
    for (const f of ENGINE_FILES) fs.writeFileSync(path.join(engine, f), `/* relocated ${f} */\n`);
    const talk = path.join(base, 'talk');
    fs.mkdirSync(path.join(talk, 'scenes'), { recursive: true });
    fs.writeFileSync(path.join(talk, 'talk.json'), JSON.stringify({
      format: 'sage-talk/1', title: 'T', chapters: [{ id: 'a', label: 'A', scene: 'scenes/a.html', beats: [{ id: 'one', label: 'One', hold: 1 }] }],
    }));
    fs.writeFileSync(path.join(talk, 'scenes/a.html'), '<section id="a"><h1 id="h">Hi</h1></section>\n');
    const before = process.env.SAGE_ENGINE_DIR;
    process.env.SAGE_ENGINE_DIR = engine;
    try {
      const r = compileTalk(talk);
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(fs.readFileSync(path.join(talk, 'build/talk.js'), 'utf8')).toBe('/* relocated talk.js */\n');
    } finally {
      if (before === undefined) delete process.env.SAGE_ENGINE_DIR; else process.env.SAGE_ENGINE_DIR = before;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
