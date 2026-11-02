// Phase 5 over RPC: the real sidecar on a temp copy of fixtures/issta26 publishes, exports PNGs
// and a PDF, and stages the public file into temp repositories laid out like the two sites
// (public/talks/, src/content/talks.yaml, src/content/publications.yaml). The real site
// repositories are never touched: every repo here is created under the OS temp folder.
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ErrorCode, PublishErrorCode, classify, publishNotificationCheckers, publishResultCheckers, resultCheckers,
  type ExportProgressParams, type ExportResult, type MethodName, type OpenResult, type PublishMethodName, type PublishResult,
  type SiteCommitResult, type SiteStageResult,
} from '../src/protocol.ts';
import { LAB_HEADER, PUBS, TALKS } from './site-samples.ts';
import { tempTalk } from './helpers.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A minimal NDJSON client; checks every result and notification against the protocol. */
class Client {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly notes: { method: string; params: unknown }[] = [];
  readonly problems: string[] = [];
  private pending = new Map<number, { method: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  private buf = '';
  constructor() {
    this.proc = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: PKG, env: { ...process.env, SAGE_LOG: 'warn' } });
    this.proc.stdout.on('data', (c: Buffer) => this.feed(c.toString('utf8')));
    this.proc.stderr.on('data', () => {});
  }
  request<R>(method: string, params?: unknown): Promise<R> {
    const id = this.nextId++;
    this.proc.stdin.write(JSON.stringify(params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject }));
  }
  private feed(text: string) {
    this.buf += text;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const c = classify(JSON.parse(line));
      if (c.type === 'notification') {
        if (c.msg.method === 'talk.exportProgress') this.problems.push(...publishNotificationCheckers['talk.exportProgress'](c.msg.params));
        this.notes.push({ method: c.msg.method, params: c.msg.params });
      } else if (c.type === 'response' || c.type === 'error') {
        const p = this.pending.get(c.msg.id as number)!;
        this.pending.delete(c.msg.id as number);
        if (c.type === 'error') { p.reject(c.msg.error); continue; }
        const check = publishResultCheckers[p.method as PublishMethodName] ?? resultCheckers[p.method as MethodName];
        this.problems.push(...(check?.(c.msg.result) ?? []).map((x) => `${p.method}: ${x}`));
        p.resolve(c.msg.result);
      }
    }
  }
}

const tmps: string[] = [];
const tmp = (prefix: string) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))); tmps.push(d); return d; };
const vcs = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });

/** A temp repository shaped like one of the sites, with one commit and a bare "origin". */
function siteRepo(kind: 'personal' | 'lab') {
  const repo = tmp(`sage-site-${kind}-`);
  vcs(repo, 'init', '-q', '-b', 'main');
  vcs(repo, 'config', 'user.name', 'Test');
  vcs(repo, 'config', 'user.email', 'test@example.org');
  vcs(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'public/talks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/content'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'public/talks/older-talk-fse25.html'), '<!doctype html>old');
  fs.writeFileSync(path.join(repo, 'src/content/talks.yaml'), kind === 'lab' ? LAB_HEADER + TALKS : TALKS);
  fs.writeFileSync(path.join(repo, 'src/content/publications.yaml'), kind === 'lab' ? LAB_HEADER + PUBS : PUBS);
  fs.writeFileSync(path.join(repo, 'README.md'), 'site\n');
  vcs(repo, 'add', '-A');
  vcs(repo, 'commit', '-q', '-m', 'initial');
  // A bare clone stands in for GitHub, so the test can show that nothing ever reaches it.
  const origin = tmp(`sage-site-${kind}-origin-`);
  execFileSync('git', ['clone', '-q', '--bare', repo, origin]);
  vcs(repo, 'remote', 'add', 'origin', origin);
  vcs(repo, 'fetch', '-q', 'origin');
  return { repo, origin };
}

const pngSize = (file: string) => { const b = fs.readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

let c: Client, root = '', cleanup = () => {}, holds = 0;
beforeAll(async () => {
  const t = tempTalk();
  root = t.root; cleanup = t.cleanup;
  c = new Client();
  const open = await c.request<OpenResult>('talk.open', { path: root, watch: false });
  expect(open.build?.ok).toBe(true);
  holds = open.holds!.length;
}, 60_000);
afterAll(() => { c?.proc.kill('SIGKILL'); cleanup(); for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

describe('talk.publish', () => {
  it('writes build/public/<slug>.html (default slug: the folder name) with no warnings for the clean fixture', async () => {
    const r = await c.request<PublishResult>('talk.publish');
    expect(r.path).toBe(path.join(root, 'build/public/issta26.html'));
    expect(r.bytes).toBe(fs.statSync(r.path).size);
    expect(r.holds).toBeGreaterThan(30);
    expect(r.holds).toBeLessThan(holds); // the private chapters and backups are cut
    expect(r.duration).toBeGreaterThan(200);
    expect(r.warnings).toEqual([]);
    const named = await c.request<PublishResult>('talk.publish', { slug: 'ui-repair-issta26' });
    expect(named.path).toBe(path.join(root, 'build/public/ui-repair-issta26.html'));
    expect(c.problems).toEqual([]);
  });

  it('warns when a private label or a speaker note would ship', async () => {
    const scene = path.join(root, 'scenes/end.html');
    const before = fs.readFileSync(scene, 'utf8');
    fs.appendFileSync(scene, '\n<!-- One more thing -->\n<p hidden>Thank you. I am Kevin Moran from UCF. Joint work</p>\n');
    try {
      const r = await c.request<PublishResult>('talk.publish', { slug: 'leaky' });
      // The chapter label, the private beat label "Thank you", and the opening of a note.
      expect(r.warnings).toHaveLength(3);
      for (const w of r.warnings) expect(w).toMatchObject({ severity: 'warning', code: 'publish-private-text', file: expect.stringMatching(/^scenes\/end\.html:1[45]$/) });
      const said = r.warnings.map((w) => w.message).join('\n');
      expect(said).toContain('"One more thing"');
      expect(said).toContain('private beat label "Thank you"');
      expect(said).toContain('speaker note "Thank you. I am Kevin Moran from UCF. Jo"');
    } finally { fs.writeFileSync(scene, before); }
  });

  it('rejects a bad slug and a legacy deck', async () => {
    await expect(c.request('talk.publish', { slug: '../evil' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('talk.publish', { slug: 'ok', extra: 1 })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });
});

describe('talk.export', () => {
  it('PNGs: chosen holds with frames around them, 1920x1080, progress after each', async () => {
    c.notes.length = 0;
    const r = await c.request<ExportResult>('talk.export', { kind: 'png', holds: [2, 3, 5], around: 0.5 });
    expect(r.dir).toBe(path.join(root, 'build/export/png'));
    expect(r.frames).toBe(9);
    expect(r.files.map((f) => path.basename(f))).toEqual([
      'hold-02-before.png', 'hold-02.png', 'hold-02-after.png', 'hold-03-before.png', 'hold-03.png', 'hold-03-after.png',
      'hold-05-before.png', 'hold-05.png', 'hold-05-after.png',
    ]);
    for (const f of r.files) expect(pngSize(f)).toEqual({ w: 1920, h: 1080 });
    expect(fs.readdirSync(r.dir).filter((f) => f.endsWith('.png'))).toHaveLength(9);
    expect(JSON.parse(fs.readFileSync(path.join(r.dir, 'manifest.json'), 'utf8')).frames).toHaveLength(9);
    expect(r.errors).toEqual([]);
    const progress = c.notes.filter((n) => n.method === 'talk.exportProgress').map((n) => n.params as ExportProgressParams);
    expect(progress.map((p) => p.done)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(progress.every((p) => p.total === 9 && p.kind === 'png')).toBe(true);

    // A second export replaces the folder's contents.
    const all = await c.request<ExportResult>('talk.export', { kind: 'png', holds: [1] });
    expect(fs.readdirSync(all.dir).sort()).toEqual(['hold-01.png', 'manifest.json']);
    expect(c.problems).toEqual([]);
  }, 60_000);

  it('PDF: one 1920x1080-point page per hold, backups included', async () => {
    const r = await c.request<ExportResult>('talk.export', { kind: 'pdf' });
    expect(r.files).toEqual([path.join(root, 'build/export/issta26.pdf')]);
    expect(r.frames).toBe(holds);
    const pdf = await PDFDocument.load(fs.readFileSync(r.files[0]!));
    expect(pdf.getPageCount()).toBe(holds);
    for (const p of pdf.getPages()) expect(p.getSize()).toEqual({ width: 1920, height: 1080 });
    expect(pdf.getTitle()).toMatch(/^Automated Program Repair/);
    expect(c.problems).toEqual([]);
  }, 120_000);

  it('rejects holds outside the film', async () => {
    await expect(c.request('talk.export', { kind: 'png', holds: [holds + 1] })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('talk.export', { kind: 'gif' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });
});

describe('talk.qr', () => {
  it('writes an SVG QR code per URL into assets/', async () => {
    const slides = fs.readFileSync(path.join(root, 'assets/qr-slides.svg'), 'utf8'); // the deck's own
    const r = await c.request<{ files: string[] }>('talk.qr', { paper: 'https://example.org/paper.pdf', package: 'https://example.org/pkg' });
    expect(r.files).toEqual(['assets/qr-paper.svg', 'assets/qr-package.svg']);
    for (const f of r.files) {
      const svg = fs.readFileSync(path.join(root, f), 'utf8');
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*viewBox="0 0 (\d+) \1"/);
      expect(svg).toContain('<path');
    }
    expect(fs.readFileSync(path.join(root, 'assets/qr-slides.svg'), 'utf8')).toBe(slides); // not asked for: untouched
    await expect(c.request('talk.qr', {})).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('talk.qr', { slides: 'javascript:alert(1)' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    expect(c.problems).toEqual([]);
  });
});

describe('site.stage and site.commit (temp repositories only)', () => {
  const slug = 'ui-repair-issta26';
  const published = () => fs.readFileSync(path.join(root, 'build/public', `${slug}.html`));

  it('personal site: places the file, adds the talk and the paper link, keeps comments, commits nothing; idempotent', async () => {
    await c.request('talk.publish', { slug });
    const { repo, origin } = siteRepo('personal');
    const head = vcs(repo, 'rev-parse', 'HEAD');
    const r = await c.request<SiteStageResult>('site.stage', { site: 'personal', repo, slug, paperEntry: 'pub-002' });
    expect(r).toMatchObject({ site: 'personal', repo, url: `/talks/${slug}.html`, notes: [] });
    expect(r.files).toEqual([
      { path: `public/talks/${slug}.html`, status: 'added' },
      { path: 'src/content/talks.yaml', status: 'modified' },
      { path: 'src/content/publications.yaml', status: 'modified' },
    ]);
    expect(fs.readFileSync(path.join(repo, 'public/talks', `${slug}.html`)).equals(published())).toBe(true);
    const talks = fs.readFileSync(path.join(repo, 'src/content/talks.yaml'), 'utf8');
    expect(talks.startsWith('# Talks — newest first\n#\n# `date` renders as "Month YYYY".\n\n- id: ui-repair-issta26\n')).toBe(true);
    expect(talks).toContain('  # the day is not shown\n'); // an existing comment survives
    expect(talks.endsWith(TALKS.slice(TALKS.indexOf('- id: older-talk-fse25')))).toBe(true); // everything after the new entry is untouched
    expect((parseYaml(talks) as { id: string; title: string; links: unknown[] }[])[0]).toMatchObject({
      id: slug, title: 'Automated Program Repair of UI-centric Android Bugs: How Far are We?', venue: 'ISSTA 2026',
      links: [{ label: 'slides', url: `/talks/${slug}.html` }],
    });
    const pubs = fs.readFileSync(path.join(repo, 'src/content/publications.yaml'), 'utf8');
    expect(pubs).toBe(PUBS.replace('url: "/documents/repair.pdf"  \n', `url: "/documents/repair.pdf"  \n    - label: "slides"\n      url: "/talks/${slug}.html"\n`));
    expect(r.diff).toMatch(new RegExp(`^public/talks/${slug}\\.html: new file, \\d+\\.\\d\\d MB\\n`));
    expect(r.diff).toContain('+- id: ui-repair-issta26');
    expect(r.diff).toContain('+    - label: "slides"');
    // Nothing committed, nothing staged.
    expect(vcs(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(vcs(repo, 'diff', '--cached', '--name-only')).toBe('');

    const again = await c.request<SiteStageResult>('site.stage', { site: 'personal', repo, slug, paperEntry: 'pub-002' });
    expect(again).toEqual(r);
    expect(fs.readFileSync(path.join(repo, 'src/content/talks.yaml'), 'utf8')).toBe(talks);
    expect(fs.readFileSync(path.join(repo, 'src/content/publications.yaml'), 'utf8')).toBe(pubs);

    // The user clicks Commit: exactly these paths, another staged change stays staged, no push.
    fs.writeFileSync(path.join(repo, 'README.md'), 'site, edited\n');
    vcs(repo, 'add', 'README.md');
    const paths = r.files.filter((f) => f.status !== 'unchanged').map((f) => f.path);
    const done = await c.request<SiteCommitResult>('site.commit', { repo, paths, message: `Add the ${slug} talk\n\nStaged by SAGE Talk.` });
    expect(done.commit).toBe(vcs(repo, 'rev-parse', 'HEAD').trim());
    expect(done.summary).toMatch(new RegExp(`^${done.commit.slice(0, 7)} Add the ${slug} talk`));
    expect(vcs(repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual([...paths].sort());
    expect(vcs(repo, 'diff', '--cached', '--name-only').trim()).toBe('README.md');
    expect(vcs(origin, 'rev-parse', 'main')).toBe(head); // nothing was pushed: the remote still has only the first commit
    const after = await c.request<SiteStageResult>('site.stage', { site: 'personal', repo, slug, paperEntry: 'pub-002' });
    expect(after.files.map((f) => f.status)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    expect(after.diff).toBe('');
    await expect(c.request('site.commit', { repo, paths, message: 'again' })).rejects.toMatchObject({ code: PublishErrorCode.SiteFailed, message: expect.stringMatching(/nothing to commit/) });
    expect(c.problems).toEqual([]);
  });

  it('lab site: copies the file only; the generated YAML is left alone with a note', async () => {
    const { repo } = siteRepo('lab');
    const r = await c.request<SiteStageResult>('site.stage', { site: 'lab', repo, slug, paperEntry: 'pub-002' });
    expect(r.files).toEqual([
      { path: `public/talks/${slug}.html`, status: 'added' },
      { path: 'src/content/talks.yaml', status: 'unchanged' },
      { path: 'src/content/publications.yaml', status: 'unchanged' },
    ]);
    expect(r.notes).toEqual([
      'src/content/talks.yaml is generated from another repository; the talk listing comes from there.',
      "src/content/publications.yaml is generated from another repository; the paper's slides link comes from there.",
    ]);
    expect(vcs(repo, 'status', '--porcelain')).toBe(`?? public/talks/${slug}.html\n`);
  });

  it('a paper that is not there is a note; bad repositories and unpublished slugs are errors', async () => {
    const { repo } = siteRepo('personal');
    const r = await c.request<SiteStageResult>('site.stage', { site: 'personal', repo, slug, paperEntry: 'No Such Paper' });
    expect(r.notes).toEqual(['No entry "No Such Paper" in src/content/publications.yaml (matched by id, then title); its slides link was not added.']);
    expect(r.files[2]).toEqual({ path: 'src/content/publications.yaml', status: 'unchanged' });

    const plain = tmp('sage-not-a-repo-');
    await expect(c.request('site.stage', { site: 'personal', repo: plain, slug })).rejects.toMatchObject({ code: PublishErrorCode.SiteFailed, message: expect.stringMatching(/not a git working tree/) });
    await expect(c.request('site.stage', { site: 'personal', repo: path.join(repo, 'src'), slug })).rejects.toMatchObject({ code: PublishErrorCode.SiteFailed, message: expect.stringMatching(/choose its top folder/) });
    await expect(c.request('site.stage', { site: 'personal', repo, slug: 'never-published' })).rejects.toMatchObject({ code: PublishErrorCode.NotPublished });
    await expect(c.request('site.stage', { site: 'personal', repo: 'relative/path', slug })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(c.request('site.commit', { repo, paths: ['../outside'], message: 'x' })).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

    // A YAML file that does not parse leaves the whole repository untouched.
    const { repo: broken } = siteRepo('personal');
    fs.writeFileSync(path.join(broken, 'src/content/talks.yaml'), '- id: [unclosed\n');
    await expect(c.request('site.stage', { site: 'personal', repo: broken, slug })).rejects.toMatchObject({ code: PublishErrorCode.SiteFailed, message: expect.stringMatching(/talks\.yaml: does not parse/) });
    expect(fs.existsSync(path.join(broken, 'public/talks', `${slug}.html`))).toBe(false);
  });
});
