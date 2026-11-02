// The academic-talk-film skill (v2) against the compiler it documents: the starter that
// scripts/new-talk.sh scaffolds must validate (with the browser checks), build and publish, and
// the eval cases must be well formed, with fixtures that fail and pass the way the cases say.
// No model is called: evals are checked structurally only.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/cli.ts';
import { compileTalk } from '../src/compile.ts';
import { recordTalk } from '../src/record.ts';
import { loadTalk } from '../src/load.ts';
import { publishTalk } from '../src/publish.ts';
import { validateTalk } from '../src/validate.ts';
import { validateRendered } from '../src/talk-render.ts';
import { REPO } from './helpers.ts';

const SKILL = path.join(REPO, 'skill/academic-talk-film');
const EVALS = path.join(SKILL, 'evals');
const tmps: string[] = [];
afterAll(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmps.push(d); return d; };
const codes = (dir: string) => validateTalk(loadTalk(dir)).map((d) => `${d.severity} ${d.code}`);
const holds = (dir: string) => recordTalk(loadTalk(dir)).layout.beats.map((b) => [b.id, b.at] as const);
const io = () => { const o = { out: [] as string[], err: [] as string[] }; return { o, io: { out: (s: string) => o.out.push(s), err: (s: string) => o.err.push(s) } }; };

describe('skill v2 starter (scripts/new-talk.sh)', () => {
  const dest = path.join(tmp('skill-starter-'), 'talk');
  const title = 'How "far" & a\\b | are we?';
  execFileSync('bash', [path.join(SKILL, 'scripts/new-talk.sh'), dest, title], { stdio: 'pipe' });

  it('scaffolds a talk folder with the title in the spine', () => {
    for (const f of ['talk.json', 'theme.css', 'scenes/layers.html', 'scenes/title.html', 'scenes/end.html', 'beats/title.js', 'lib/slideno.js', 'assets/manrope-latin.woff2', 'PLAN.md', 'README.md', '.gitignore']) {
      expect(fs.existsSync(path.join(dest, f)), f).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dest, 'talk.json'), 'utf8')).title).toBe(title);
  });

  it('has a title, a chapter, a dark private passage, a backup and a public end card', () => {
    const spine = loadTalk(dest).spine!;
    expect(spine.chapters.map((c) => c.id)).toEqual(['title', 'claim', 'omt', 'backup']);
    expect(spine.chapters[2]).toMatchObject({ dark: true, private: true });
    expect(spine.chapters[3]).toMatchObject({ backup: true, private: true });
    expect(spine.public?.beats.map((b) => b.id)).toEqual(['end']);
    for (const c of spine.chapters) for (const b of c.beats) expect(b.hold, `${c.id}.${b.id}`).toBeTypeOf('number');
  });

  it('validates with no diagnostics at all, private and public', () => {
    expect(codes(dest)).toEqual([]);
    expect(validateTalk(loadTalk(dest), undefined, { public: true })).toEqual([]);
    expect(holds(dest)).toEqual([['title.title', 5], ['claim.claim', 8], ['claim.number', 11], ['omt.omt', 15], ['omt.thanks', 19], ['backup.backup', 21]]);
  });

  it('passes the browser checks (talkc validate --render)', async () => {
    expect(await validateRendered(loadTalk(dest))).toEqual([]);
    expect(await validateRendered(loadTalk(dest), { public: true })).toEqual([]);
  }, 120_000);

  it('builds and publishes', () => {
    const out = tmp('skill-starter-build-');
    const b = compileTalk(dest, { outDir: out });
    expect(b.ok).toBe(true);
    expect(fs.existsSync(path.join(out, 'assets/manrope-latin.woff2'))).toBe(true);
    const p = publishTalk(dest, { slug: 'starter', outDir: out });
    expect(p.ok).toBe(true);
    const html = fs.readFileSync(p.outFile!, 'utf8');
    expect(html).toContain('id="end"');
    expect(html).not.toContain('id="black"'); // the private dark passage is cut
  });

  it('refuses to overwrite an existing talk', () => {
    expect(() => execFileSync('bash', [path.join(SKILL, 'scripts/new-talk.sh'), dest, 'Again'], { stdio: 'pipe' })).toThrow();
    expect(JSON.parse(fs.readFileSync(path.join(dest, 'talk.json'), 'utf8')).title).toBe(title);
  });

  it('the starter folder in the skill validates as is', () => {
    expect(codes(path.join(SKILL, 'assets/starter-v2'))).toEqual([]);
  });
});

describe('skill v2 files', () => {
  const read = (p: string) => fs.readFileSync(path.join(SKILL, p), 'utf8');

  it('ships the ISSTA helpers as the starter library, each one documented', () => {
    const readme = read('assets/lib-starter/README.md');
    for (const n of ['device', 'codepane', 'stations', 'dots', 'bars', 'flow', 'heatmap', 'term', 'slideno']) {
      expect(read(`assets/lib-starter/${n}.js`)).toBe(fs.readFileSync(path.join(REPO, `fixtures/issta26/lib/${n}.js`), 'utf8'));
      expect(readme).toContain('`' + n + '.js`');
    }
  });

  it('every file SKILL.md and the references name exists', () => {
    const docs = ['SKILL.md', 'references/engine-api.md', 'references/gotchas.md', 'references/storyboard.md', 'references/publishing.md'].map(read).join('\n');
    const named = new Set([...docs.matchAll(/`((?:references|scripts|assets|evals)\/[\w./-]+?)`/g)].map((m) => m[1]!.replace(/\/$/, '')));
    expect(named.size).toBeGreaterThan(8);
    for (const p of named) expect(fs.existsSync(path.join(SKILL, p)), p).toBe(true);
    expect(read('SKILL.md')).toContain('## Inside the SAGE Talk app');
    expect(read('SKILL.md')).toContain('## Legacy single-file decks');
    expect(read('SKILL.md')).not.toMatch(/references\/example-index\.html/);
  });

  it('keeps v1 available under legacy/', () => {
    for (const p of ['references/legacy/example-index.html', 'references/legacy/example-plan.md', 'references/legacy/engine-api-v1.md',
      'scripts/legacy/new-talk.sh', 'scripts/legacy/cplist.sh', 'scripts/legacy/shoot.sh', 'scripts/legacy/shift-times.py',
      'assets/legacy/talk.js', 'assets/legacy/build-public.py', 'assets/legacy/starter/index.html']) {
      expect(fs.existsSync(path.join(SKILL, p)), p).toBe(true);
    }
  });

  it('the legacy scaffold still produces a single-file deck', () => {
    const dest = path.join(tmp('skill-legacy-'), 'talk');
    execFileSync('bash', [path.join(SKILL, 'scripts/legacy/new-talk.sh'), dest, 'Old'], { stdio: 'pipe' });
    for (const f of ['index.html', 'talk.js', 'talk.css', 'edit.js', 'serve.py', 'build-public.py', 'assets/manrope-latin.woff2']) expect(fs.existsSync(path.join(dest, f)), f).toBe(true);
  });

  it('talkc.sh runs this checkout\'s talkc', () => {
    const r = execFileSync('bash', [path.join(SKILL, 'scripts/talkc.sh'), 'layout', path.join(SKILL, 'assets/starter-v2')], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:' + path.dirname(process.execPath) } });
    expect(r.split('\n')[0]).toBe('1 5.0 Title');
  });
});

// ---- evals (structure only; no live runs) ----

/** `---\nkey: value\n---` front matter as raw strings. */
function frontMatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(m[1]!.split('\n').map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter((x) => !!x).map((x) => [x![1]!, x![2]!]));
}

describe('skill evals', () => {
  const cases = fs.readdirSync(EVALS).filter((d) => fs.statSync(path.join(EVALS, d)).isDirectory()).sort();

  it('has the four v2 cases', () => {
    expect(cases).toEqual(['convert-hold-into-beat', 'fix-validator-diagnostic', 'insert-hold-in-existing-deck', 'storyboard-from-paper']);
  });

  it.each(cases)('%s is well formed', (c) => {
    const dir = path.join(EVALS, c);
    const prompt = fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8');
    const fm = frontMatter(prompt);
    expect(fm.tags).toBe('[academic-talk-film]');
    expect(Number(fm.max_turns)).toBeGreaterThan(0);
    expect(Number(fm.timeout_seconds)).toBeGreaterThan(0);
    expect(fm.allowed_tools).toMatch(/^\[.*Skill.*\]$/);
    expect(prompt.slice(prompt.indexOf('\n---\n') + 5).trim().length).toBeGreaterThan(80);
    const yaml = fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8');
    expect(yaml).toMatch(/^schema_version: "1\.1"$/m);
    expect(yaml).toMatch(new RegExp(`^name: ${c}$`, 'm'));
    expect(yaml).toMatch(/^expected_outcome: \|\n( {2}\S.*\n)+/m);
    const graders = fs.readdirSync(path.join(dir, 'graders')).filter((f) => f.endsWith('.md'));
    expect(graders.length).toBeGreaterThan(0);
    for (const g of graders) {
      const gfm = frontMatter(fs.readFileSync(path.join(dir, 'graders', g), 'utf8'));
      expect(gfm).toMatchObject({ type: 'llm', focus: 'trace' });
      expect(Number(gfm.weight)).toBeGreaterThan(0);
    }
    // v2 cases speak the beat format, never the v1 workflow.
    expect(yaml + prompt).not.toMatch(/cplist\.sh|shift-times|build-public\.py/);
  });

  it('fix-validator-diagnostic: the fixture has exactly the ghost-entrance error, and the expected fix clears it', () => {
    const src = path.join(EVALS, 'fix-validator-diagnostic/fixture/talk');
    const ds = validateTalk(loadTalk(src));
    expect(ds.map((d) => `${d.severity} ${d.code} ${d.file}:${d.line} ${d.beat}`)).toEqual(['error ghost-entrance beats/claim.js:12 claim.number']);
    const a = io();
    expect(main(['validate', src], a.io)).toBe(1);
    const dir = tmp('skill-eval3-');
    fs.cpSync(src, dir, { recursive: true });
    const f = path.join(dir, 'beats/claim.js');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("B.in('#c2-stat', -0.4,", "B.in('#c2-stat', 0,"));
    expect(codes(dir)).toEqual([]);
    expect(holds(dir)).toEqual(holds(path.join(SKILL, 'assets/starter-v2')));
  });

  it('convert-hold-into-beat: the fixture is clean, and the expected conversion lands "The number" at 11.0', () => {
    const src = path.join(EVALS, 'convert-hold-into-beat/fixture/talk');
    expect(codes(src)).toEqual([]);
    const before = new Map(holds(src));
    const dir = tmp('skill-eval4-');
    fs.cpSync(src, dir, { recursive: true });
    const spine = JSON.parse(fs.readFileSync(path.join(dir, 'talk.json'), 'utf8'));
    spine.chapters[1].beats.push({ id: 'number', label: 'The number', notes: 'Eleven of fifty.', hold: 3 });
    fs.writeFileSync(path.join(dir, 'talk.json'), JSON.stringify(spine, null, 2));
    fs.appendFileSync(path.join(dir, 'beats/claim.js'), "\nTalk.beat('claim.number', (B) => {\n  B.in('#c2-stat', 0.2, { dur: 0.8, y: 20 });\n  B.count('#c2-n', 0.3, 1.3, 11);\n});\n");
    for (const m of ['beats/omt.js', 'beats/end.js']) {
      const f = path.join(dir, m);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace("'#c2-eye, #c2-h, #c2-s'", "'#c2-eye, #c2-h, #c2-s, #c2-stat'"));
    }
    expect(codes(dir)).toEqual([]);
    const after = holds(dir);
    expect(after.find(([id]) => id === 'claim.number')?.[1]).toBe(11);
    for (const [id, at] of after) if (before.has(id)) expect(at, id).toBe(before.get(id)! + (at > 8 ? 3 : 0));
  });
});
