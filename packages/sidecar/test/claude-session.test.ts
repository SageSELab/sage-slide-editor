// Session persistence and fork (PLAN 6.1), materials resolution, and the beat locator.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beatAt, locateBeat } from '../src/claude/beat-locator.ts';
import { inventory, resolveMaterials } from '../src/claude/materials.ts';
import { clearSession, loadSession, planResume, saveSession, sessionFile } from '../src/claude/session-store.ts';
import { tempTalk } from './helpers.ts';

let base: string;
beforeEach(() => { base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-claude-'))); });
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('session store', () => {
  it('starts new, then resumes in the same folder', () => {
    const talk = path.join(base, 'talk');
    fs.mkdirSync(talk);
    expect(loadSession(talk)).toBeNull();
    expect(planResume(loadSession(talk), talk)).toEqual({ mode: 'new' });
    saveSession(talk, 'abc-123', new Date('2026-11-02T00:00:00Z'));
    expect(JSON.parse(fs.readFileSync(sessionFile(talk), 'utf8'))).toEqual({ sessionId: 'abc-123', cwd: talk, updatedAt: '2026-11-02T00:00:00.000Z' });
    expect(planResume(loadSession(talk), talk)).toEqual({ mode: 'resume', resume: 'abc-123' });
  });

  it('forks when the talk moved (the session was recorded for another cwd)', () => {
    const talk = path.join(base, 'talk');
    fs.mkdirSync(talk);
    saveSession(talk, 'abc-123');
    const moved = path.join(base, 'moved');
    fs.renameSync(talk, moved);
    expect(planResume(loadSession(moved), moved)).toEqual({ mode: 'fork', resume: 'abc-123', forkSession: true });
    // After the fork's init, the new id is saved for the new place and later opens resume it.
    saveSession(moved, 'def-456');
    expect(planResume(loadSession(moved), moved)).toEqual({ mode: 'resume', resume: 'def-456' });
  });

  it('clear forgets the session; garbage is ignored', () => {
    const talk = path.join(base, 'talk');
    fs.mkdirSync(path.join(talk, '.sage'), { recursive: true });
    fs.writeFileSync(sessionFile(talk), '{"sessionId": 5}');
    expect(loadSession(talk)).toBeNull();
    saveSession(talk, 'x');
    clearSession(talk);
    expect(loadSession(talk)).toBeNull();
    clearSession(talk); // idempotent
  });
});

describe('materials', () => {
  it('resolves relative folders and files, skips missing ones with a diagnostic, dedupes nested folders', () => {
    const talk = path.join(base, 'talk');
    fs.mkdirSync(path.join(base, 'paper/figs'), { recursive: true });
    fs.mkdirSync(path.join(base, 'replication'));
    fs.mkdirSync(talk);
    fs.writeFileSync(path.join(base, 'paper/main.pdf'), 'pdf');
    fs.writeFileSync(path.join(base, 'paper/main.tex'), 'tex');
    const m = resolveMaterials(talk, { paper: '../paper', pdf: '../paper/main.pdf', figs: '../paper/figs', package: '../replication', data: '../nope' });
    expect(m.dirs).toEqual([path.join(base, 'paper'), path.join(base, 'replication')]);
    expect(m.diagnostics).toEqual(['materials.data: ../nope does not exist; skipped']);
    expect(m.entries.map((e) => [e.key, e.kind])).toEqual([['paper', 'dir'], ['pdf', 'file'], ['figs', 'dir'], ['package', 'dir'], ['data', 'missing']]);
    const inv = inventory(m);
    expect(inv).toContain('paper: ../paper');
    expect(inv).toMatch(/\.pdf 1/);
    expect(inv).toContain('data: ../nope (missing)');
    expect(resolveMaterials(talk, undefined)).toEqual({ entries: [], dirs: [], diagnostics: [] });
  });
});

describe('beat locator', () => {
  const src = "// x\nTalk.beat('c.one', (B) => {\n  B.in('#a', 0);\n});\n\nTalk.beat(\"c.two\", (B) => {\n  B.in('#b', 0);\n});\n";
  it('finds the registration enclosing an offset', () => {
    expect(beatAt(src, 0)).toBe('c.one');
    expect(beatAt(src, src.indexOf("'#a'"))).toBe('c.one');
    expect(beatAt(src, src.indexOf("'#b'"))).toBe('c.two');
  });

  it('locates edits in the fixture motion and scene files', () => {
    const t = tempTalk();
    try {
      const spine = JSON.parse(fs.readFileSync(path.join(t.root, 'talk.json'), 'utf8'));
      const motion = fs.readFileSync(path.join(t.root, 'beats/line.js'), 'utf8');
      const inFifteen = motion.slice(motion.indexOf("B.in('#c1-eye'"), motion.indexOf("B.in('#c1-eye'") + 30);
      expect(locateBeat(t.root, spine, 'beats/line.js', { old_string: inFifteen, new_string: inFifteen + ' ' })).toBe('line.fifteen');
      // A scene edit: the beat whose motion first animates the edited element.
      expect(locateBeat(t.root, spine, 'scenes/line.html', { old_string: 'x', new_string: '<div class="eyebrow" id="c1-eye" data-a>New</div>' })).toBe('line.fifteen');
      // No id: the chapter's first beat.
      expect(locateBeat(t.root, spine, 'scenes/line.html', { old_string: 'a', new_string: 'b' })).toBe('line.title');
      expect(locateBeat(t.root, spine, 'talk.json', { old_string: 'a', new_string: 'b' })).toBeUndefined();
    } finally { t.cleanup(); }
  });
});
