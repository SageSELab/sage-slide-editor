import { describe, expect, it } from 'vitest';
import { loadTalk, loadTalkFrom, memoryHost, talkFiles } from '../src/load.ts';
import { ISSTA, mini, spineOf } from './helpers.ts';

describe('load', () => {
  it('loads the ISSTA fixture: spine, layers, scenes, lib and motion', () => {
    const t = loadTalk(ISSTA);
    expect(t.spine).not.toBeNull();
    expect(t.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(t.layers?.path).toBe('scenes/layers.html');
    expect(t.lib.length).toBe(t.spine!.lib!.length);
    expect(t.chapters.map((c) => c.id)).toEqual(t.spine!.chapters.map((c) => c.id));
    expect(t.chapters[0]!.motion?.text).toContain("Talk.beat('line.title'");
    expect(talkFiles(t)[0]!.path).toBe('talk.json');
  });

  it('reports a missing talk.json', () => {
    const t = loadTalkFrom(memoryHost({}));
    expect(t.diagnostics).toMatchObject([{ code: 'file-missing', file: 'talk.json' }]);
  });

  it('reports JSON syntax errors with a location', () => {
    const t = mini('{\n  "format": "sage-talk/1",\n  "title": oops\n}');
    expect(t.diagnostics).toMatchObject([{ code: 'json-syntax', line: 3, col: 12 }]);
  });

  it('reports files named by the spine that do not exist', () => {
    const t = mini(spineOf([{ id: 'c', scene: 'scenes/c.html', beats: [{ id: 'a' }] }], { lib: ['lib/x.js'] }));
    expect(t.diagnostics.map((d) => d.message)).toEqual(['lib file not found: lib/x.js', 'scene (chapter c) file not found: scenes/c.html']);
  });

  it('uses the beats/<chapter>.js convention when motion is not named', () => {
    const t = mini(spineOf([{ id: 'c', beats: [{ id: 'a' }] }]), { 'beats/c.js': '//' });
    expect(t.chapters[0]!.motion?.path).toBe('beats/c.js');
    expect(t.diagnostics).toEqual([]);
  });

  it('loads the public block as its own chapter', () => {
    const t = mini(spineOf([{ id: 'c', beats: [] }], { public: { id: 'end', scene: 'scenes/end.html', beats: [{ id: 'end', label: 'P' }] } }), { 'scenes/end.html': '<div></div>' });
    expect(t.publicChapter).toMatchObject({ id: 'end', scene: { path: 'scenes/end.html' } });
  });
});
