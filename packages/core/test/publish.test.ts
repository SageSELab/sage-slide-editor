// talkc publish: the spine-driven public cut, the engine's web variant, inlining, and on the
// real ISSTA fixture the PLAN 12.3 acceptance: the file works alone from file:// with no
// network, its frames match the original deck's published file, and private text is absent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Renderer, type Film } from '@sage/render';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import { DEFAULT_ENGINE_DIR } from '../src/compile.ts';
import { loadTalk } from '../src/load.ts';
import { privateNeedles, publicSpine, publishTalk, renderPublic } from '../src/publish.ts';
import { DEFAULT_TYPE, extractTheme, withThemeBlocks } from '../src/theme.ts';
import { ISSTA, REPO } from './helpers.ts';

const tmps: string[] = [];
const tmpDir = (p = 'talkc-pub-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmps.push(d); return d; };
afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** A small talk on disk: a public chapter, a private one with its own helper lib, an end card. */
function talkOnDisk(over: { spine?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const dir = tmpDir();
  const spine = {
    format: 'sage-talk/1', title: 'Tiny <talk>', venue: 'Nowhere',
    materials: { paper: '../secret-paper' },
    lib: ['lib/pub.js', 'lib/priv.js', 'lib/side.js'],
    defaults: { tail: 1 },
    chapters: [
      { id: 'a', label: 'Open', scene: 'scenes/a.html', beats: [{ id: 'one', label: 'First', notes: 'Say the first thing to the audience, slowly.', hold: 2 }] },
      { id: 'p', label: 'Hidden passage', private: true, dark: true, scene: 'scenes/p.html', beats: [{ id: 'two', label: 'Secret beat label', notes: 'Never published, these notes are private.', hold: 3 }] },
    ],
    public: { id: 'end', label: 'Paper', tail: 0, scene: 'scenes/end.html', motion: 'beats/end.js', beats: [{ id: 'end', label: 'Paper', hold: 1.5 }] },
    ...over.spine,
  };
  const files: Record<string, string> = {
    'talk.json': JSON.stringify(spine, null, 2),
    'theme.css': '.logo { background: url(assets/dot.png); }\n',
    'scenes/a.html': '<div class="scene" id="a"><h1 id="h" data-a>Hello</h1><img id="im" src="assets/dot.png" alt=""><div id="bg" style="background:url(\'assets/dot.png\')"></div></div>',
    'scenes/p.html': '<div class="scene dk" id="p"><h1 id="ph" data-a>Recruiting: come talk to us</h1><div id="pgrid"></div></div>',
    'scenes/end.html': '<div class="scene" id="end"><h1 id="eh" data-a>The paper</h1></div>',
    'lib/pub.js': "Talk.lib.pub = { enter: (B, sel, t) => B.in(sel, t) };",
    'lib/priv.js': "(function () { document.getElementById('pgrid').appendChild(document.createElement('i')); Talk.lib.priv = { enter: (B, sel, t) => B.in(sel, t) }; })();",
    'lib/side.js': "Talk.ready(() => {});",
    'beats/a.js': "Talk.beat('a.one', (B) => { B.lib.pub.enter(B, '#h', 0); const s = '</script>'; });",
    'beats/p.js': "Talk.beat('p.two', (B) => { B.lib.priv.enter(B, '#ph', 0); });",
    'beats/end.js': "Talk.beat('end.end', (B) => { B.out('#h', 0); B.in('#eh', 0.2); });",
    ...over.files,
  };
  for (const [p, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); }
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets/dot.png'), PNG1);
  fs.copyFileSync(path.join(DEFAULT_ENGINE_DIR, 'manrope-latin.woff2'), path.join(dir, 'assets/manrope-latin.woff2'));
  return dir;
}

describe('publicSpine', () => {
  it('drops private chapters, notes, materials and the public block; appends the end card; uses the public tail', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(talkOnDisk(), 'talk.json'), 'utf8'));
    const s = publicSpine(raw) as { chapters: { id: string; beats: Record<string, unknown>[] }[]; defaults: { tail: number } } & Record<string, unknown>;
    expect(s.chapters.map((c) => c.id)).toEqual(['a', 'end']);
    expect(s.chapters.flatMap((c) => c.beats).some((b) => 'notes' in b)).toBe(false);
    expect(s.chapters[1]).toMatchObject({ id: 'end', label: 'Paper', scene: 'scenes/end.html', motion: 'beats/end.js' });
    expect('tail' in s.chapters[1]!).toBe(false);
    expect(s.defaults.tail).toBe(0);
    expect(s.public).toBeUndefined();
    expect(s.materials).toBeUndefined();
    expect(raw.chapters.length).toBe(2); // input untouched
  });
});

describe('renderPublic', () => {
  it('cuts by the spine and inlines everything', () => {
    const dir = talkOnDisk();
    const r = renderPublic(loadTalk(dir));
    expect(r.diagnostics).toEqual([]);
    const html = r.html!;
    expect(r.cut).toEqual({ scenes: ['scenes/a.html', 'scenes/end.html'], motion: ['beats/a.js', 'beats/end.js'], libs: ['lib/pub.js', 'lib/side.js'], droppedLibs: ['lib/priv.js'] });
    // private scene, motion, lib, labels and all notes gone
    for (const s of ['Recruiting', 'pgrid', "Talk.beat('p.two'", 'Secret beat label', 'Hidden passage', 'Say the first thing', 'Never published', 'secret-paper']) expect(html, s).not.toContain(s);
    // no external files: no link/src to engine files or assets
    expect(html).not.toMatch(/<link rel="stylesheet"|<script src=|assets\//);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('url(\'data:image/png;base64,'); // style attribute, quote kept
    expect(html).toContain('url("data:image/png;base64,'); // theme, quotes added
    expect(html).toContain('url("data:font/woff2;base64,'); // the font in talk.css
    // web variant of the engine
    expect(html).toContain("this.stage.style.zoom = s;");
    expect(html).not.toContain('this.openPresenter();\n');
    expect(html).toContain("if (!q.has('capture')) this.play(this.cps[0]?.at ?? null);");
    expect(html).toContain("document.querySelector('.hint')?.classList.add('gone');");
    expect(html).toContain('    if (ED) ED.apply();');
    expect(html).not.toContain("q.has('hide')");
    expect(html).toContain('<div class="film">\n<div class="hint">Press space or tap to play to the next stop · ← back · F fullscreen</div>\n<div class="stage">');
    expect(html).toContain('#slideno { display: none; }');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<meta name="description" content="Talk slides: Tiny &lt;talk>. Press space or tap to advance.">');
    expect(html).toContain('<title>Tiny &lt;talk> — Nowhere</title>');
    // no editor, and no overrides block when there are no overrides
    expect(html).not.toMatch(/id="text-overrides"|class TalkEdit/);
    // an inlined script cannot close its own element
    expect(html).toContain("const s = '<\\/script>';");
  });

  it('ships an id-keyed overrides applier only when there are overrides', () => {
    const html = renderPublic(loadTalk(talkOnDisk()), { overrides: { text: { h: 'Hi <b>there</b>' } } }).html!;
    expect(html).toContain('<script type="application/json" id="text-overrides">\n{"text":{"h":"Hi \\u003cb>there\\u003c/b>"}}\n</script>');
    expect(html).toContain('class TalkEdit');
    expect(html).toContain('document.getElementById(id)');
  });

  it('errors: missing asset, engine drift, script syntax; warns on private text in shipped files', () => {
    const miss = renderPublic(loadTalk(talkOnDisk({ files: { 'scenes/end.html': '<div class="scene" id="end"><img src="assets/nope.png"></div>' } })));
    expect(miss.html).toBeNull();
    expect(miss.diagnostics).toMatchObject([{ code: 'asset-missing', severity: 'error' }]);

    const engine = tmpDir('talkc-engine-');
    for (const f of ['talk.js', 'talk.css', 'talk-layout.js']) fs.copyFileSync(path.join(DEFAULT_ENGINE_DIR, f), path.join(engine, f));
    fs.writeFileSync(path.join(engine, 'talk.js'), fs.readFileSync(path.join(engine, 'talk.js'), 'utf8').replace("this.openPresenter();", 'this.openPresenter2();'));
    const drift = renderPublic(loadTalk(talkOnDisk()), { engineDir: engine });
    expect(drift.html).toBeNull();
    expect(drift.diagnostics.map((d) => [d.code, d.message])).toEqual([['publish-engine-patch', 'talk.js: the presenter key patch matched 0 times (expected once); the engine changed']]);

    const bad = renderPublic(loadTalk(talkOnDisk({ files: { 'beats/end.js': 'Talk.beat(' } })));
    expect(bad.diagnostics.map((d) => d.code)).toContain('script-syntax');

    const leak = renderPublic(loadTalk(talkOnDisk({ files: { 'lib/side.js': "// see 'Secret beat label' and: Never published, these notes are private.\nTalk.ready(() => {});" } })));
    expect(leak.html).not.toBeNull();
    expect(leak.diagnostics.map((d) => [d.code, d.severity, d.file, d.line])).toEqual([
      ['publish-private-text', 'warning', 'lib/side.js', 1], ['publish-private-text', 'warning', 'lib/side.js', 1]]);
  });

  it('privateNeedles: multi-word private labels and the opening of every note', () => {
    expect(privateNeedles(loadTalk(talkOnDisk())).map((n) => n.text)).toEqual(['Say the first thing to the audience, slo', 'Hidden passage', 'Secret beat label', 'Never published, these notes are private']);
  });
});

describe('talkc publish', () => {
  const io = () => { const o = { out: [] as string[], err: [] as string[] }; return { o, io: { out: (s: string) => o.out.push(s), err: (s: string) => o.err.push(s) } }; };
  it('writes build/public/<slug>.html; exit codes', async () => {
    const dir = talkOnDisk();
    const a = io();
    expect(await main(['publish', dir], a.io)).toBe(0);
    expect(fs.existsSync(path.join(dir, 'build/public/talk.html'))).toBe(true);
    expect(a.o.out, JSON.stringify(a.o)).toEqual(['left out (only private beats use them): lib/priv.js', expect.stringMatching(/^wrote .*talk\.html \(0\.\d\d MB\)$/)]);
    const out = path.join(dir, 'site');
    expect(await main(['publish', dir, 'tiny-talk', '--out', out], io().io)).toBe(0);
    expect(fs.existsSync(path.join(out, 'tiny-talk.html'))).toBe(true);
    expect(await main(['publish', dir, '../evil'], io().io)).toBe(2);
    expect(await main(['publish', dir, 'a', 'b'], io().io)).toBe(2);
    expect(await main(['publish'], io().io)).toBe(2);
    fs.writeFileSync(path.join(dir, 'scenes/a.html'), '<div class="scene"><img src="assets/gone.png"></div>');
    const b = io();
    expect(await main(['publish', dir], b.io)).toBe(1);
    expect(b.o.err).toEqual([expect.stringMatching(/asset-missing/), 'talkc: publish failed']);
  });
});

// ---- the real deck ----
const ORIGINAL = path.join(REPO, 'fixtures/issta26-original/public/ui-repair-issta26.html');
let alone = '', html = '', renderer: Renderer, ours: Film, orig: Film, publicLayout = { holds: 0, duration: 0 };

describe('ISSTA public build', () => {
  beforeAll(async () => {
    const r = publishTalk(ISSTA, { slug: 'ui-repair-issta26', outDir: tmpDir() });
    expect(r.diagnostics).toEqual([]);
    expect(r.cut!.droppedLibs).toEqual(['lib/agents.js', 'lib/heatmap.js', 'lib/term.js']);
    html = fs.readFileSync(r.outFile!, 'utf8');
    publicLayout = { holds: r.holds, duration: r.duration };
    // (a) the file alone in an empty folder
    alone = path.join(tmpDir('talkc-alone-'), 'ui-repair-issta26.html');
    fs.copyFileSync(r.outFile!, alone);
    renderer = await Renderer.launch();
    ours = await renderer.openFilm(alone);
    orig = await renderer.openFilm(ORIGINAL);
  }, 120_000);
  afterAll(async () => { await ours?.close(); await orig?.close(); await renderer?.close(); });

  it('reports the public film\'s holds and duration, as the engine counts them', () => {
    expect(publicLayout.holds).toBe(ours.holds().length);
    expect(publicLayout.duration).toBeCloseTo(ours.duration, 6);
  });

  it('(a) loads from file:// alone with no network: no requests but the page, no errors', () => {
    expect(fs.readdirSync(path.dirname(alone))).toEqual(['ui-repair-issta26.html']);
    expect(ours.requests()).toEqual([{ url: expect.stringMatching(/^file:.*ui-repair-issta26\.html\?capture$/), ok: true, blocked: false }]);
    expect(ours.errors()).toEqual([]);
  });

  it('(a) as a viewer sees it: the title autoplays to the first hold; a key hides the hint', async () => {
    const live = await renderer.openFilm(alone, { capture: false });
    try {
      const st = await live.evaluate(async () => {
        const T = (window as unknown as { T: { t: number; playing: boolean } }).T;
        const start = performance.now();
        while ((T.playing || T.t === 0) && performance.now() - start < 15_000) await new Promise((r) => setTimeout(r, 100));
        const t = T.t, hint = document.querySelector('.hint')!;
        const before = hint.classList.contains('gone');
        dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); // a key that does not mark the start
        dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
        return { t, before, after: hint.classList.contains('gone'), slideno: getComputedStyle(document.getElementById('slideno')!).display, ui: !!document.querySelector('.film-ui'), zoom: (document.querySelector('.stage') as HTMLElement).style.zoom };
      }, null);
      expect(st).toEqual({ t: 5, before: false, after: true, slideno: 'none', ui: true, zoom: '1' });
      expect(live.errors()).toEqual([]);
    } finally { await live.close(); }
  }, 30_000);

  it('(b) the hold list is the original public file\'s', () => {
    const strip = (f: Film) => f.holds().map((h) => [h.at, h.label, h.backup]);
    expect(strip(ours)).toEqual(strip(orig));
    expect(ours.holds().length).toBe(49);
    expect(ours.duration).toBe(orig.duration);
    expect(ours.holds().at(-1)).toMatchObject({ at: 244.8, label: 'Paper', id: 'end.end' });
  });

  it('(b) frames match the original public file at the first hold, a mid-talk hold and the end card', async () => {
    const holds = ours.holds();
    const report: string[] = [];
    for (const h of [holds[0]!, holds[24]!, holds.at(-1)!]) {
      const a = await ours.frame(h.at), b = await orig.frame(h.at);
      const A = PNG.sync.read(a), B = PNG.sync.read(b);
      const diff = pixelmatch(A.data, B.data, undefined, A.width, A.height, { threshold: 0.1 });
      report.push(`${h.at} ${h.label}: ${diff} px (${(100 * diff / (A.width * A.height)).toFixed(3)} %), bytes ${Buffer.compare(a, b) === 0 ? 'identical' : 'differ'}`);
      expect(diff, `${h.at} ${h.label}`).toBe(0);
    }
    console.log('publish vs original:\n  ' + report.join('\n  '));
  }, 60_000);

  it('(c) private strings are absent', () => {
    const spine = JSON.parse(fs.readFileSync(path.join(ISSTA, 'talk.json'), 'utf8')) as { chapters: { private?: boolean; label: string; beats: { label: string; notes?: string }[] }[] };
    const notes = spine.chapters.flatMap((c) => c.beats).map((b) => b.notes ?? '').filter((n) => n.length > 30);
    expect(notes.length).toBeGreaterThan(50);
    for (const n of notes) expect(html, 'note: ' + n.slice(0, 40)).not.toContain(n.slice(0, 40));
    const backupLabels = spine.chapters.filter((c) => c.private).flatMap((c) => c.beats.map((b) => b.label)).filter((l) => l.includes(' '));
    expect(backupLabels).toContain('A tool at work');
    // talk.css (the engine, not the talk) names the section in a comment, as in the original
    const authored = html.replace('/* Dark passages (the "One more thing" section) flip the tokens on their scene. */', '');
    expect(authored.length).toBeLessThan(html.length);
    for (const l of backupLabels) expect(authored, 'label: ' + l).not.toContain(l);
    const privateText = [
      // the recruiting slide
      'Applying to PhD programs', 'If you are recruiting', 'sparsh.pandey@ucf.edu', 'Undergraduate researcher',
      // the dark passage: "One more thing" and the fixture's placeholder study
      'One more thing.', 'One more one more thing', 'Three tools on 50 example cases', 'Model A', 'Model B', 'example runs',
      'LinkHandler.java', 'Category one', 'pass rate', 'Every run',
      // the close
      'How far are we?', 'kpmoran@ucf.edu',
      // where the paper lives on disk, and the notes key itself
      '"materials"', '"notes"',
    ];
    for (const s of privateText) expect(html, s).not.toContain(s);
  });

  // Applying the SAGE look itself must not move a pixel: its theme block restates talk.css.
  it('with the SAGE theme applied, the public frames are byte-identical to the unthemed ones', async () => {
    const copy = path.join(tmpDir('talkc-sage-'), 'issta26');
    fs.cpSync(ISSTA, copy, { recursive: true, filter: (s) => !s.startsWith(path.join(ISSTA, 'build')) });
    const own = fs.readFileSync(path.join(copy, 'theme.css'), 'utf8');
    const sage = { ...extractTheme(fs.readFileSync(path.join(DEFAULT_ENGINE_DIR, 'talk.css'), 'utf8'), own, { id: 'sage', name: 'SAGE' }), type: DEFAULT_TYPE };
    fs.writeFileSync(path.join(copy, 'theme.css'), withThemeBlocks(own, null, sage));
    const r = publishTalk(copy, { slug: 'themed', outDir: tmpDir() });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(r.outFile!, 'utf8')).toContain('sage-theme:begin');
    const themed = await renderer.openFilm(r.outFile!);
    try {
      const holds = ours.holds();
      for (const h of [holds[0]!, holds[12]!, holds[30]!, holds.at(-1)!]) {
        const [a, b] = [await ours.frame(h.at), await themed.frame(h.at)];
        expect(Buffer.compare(a, b), `${h.at} ${h.label}`).toBe(0);
      }
    } finally { await themed.close(); }
  }, 120_000);
});
