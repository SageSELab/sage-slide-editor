#!/usr/bin/env node
// cli.ts — `talkc`: build, validate, layout, shoot, publish.
// Runs directly on Node 24 (type stripping); `node --import tsx` also works.
//
//   talkc build <talk> [--out <dir>]        write build/index.html; exit 1 on a build error
//   talkc validate <talk> [--json] [--public] [--render]
//                                            exit 1 when any error-severity diagnostic;
//                                            --render adds the browser checks (ghost-visible)
//   talkc layout <talk> [--json] [--public]     the hold list, like ?cplist
//   talkc shoot <talk|film.html> [--holds] [--around S] [--times a,b] [--beats ch.beat,...]
//               [--no-backups] [--out <dir>]
//                                            PNG frames in headless Chromium (default: every
//                                            hold) into <talk>/build/shots; a talk folder is
//                                            built first, an .html film is shot as is
//   talkc publish <talk> [slug] [--out <dir>]   the self-contained public file,
//                                            <talk>/build/public/<slug>.html (slug: talk)
// Exit codes: 0 ok, 1 talk has errors (or frames could not be rendered), 2 usage.
//
// Commands that need a browser (shoot, validate --render) import @sage/render lazily, so build, validate and
// layout, and every library user of @sage/core, never load Playwright.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTalk } from './compile.ts';
import { formatDiagnostic, hasErrors, type Diagnostic } from './diagnostics.ts';
import { formatCplist } from './layout.ts';
import { loadTalk } from './load.ts';
import { publishTalk } from './publish.ts';
import { recordTalk } from './record.ts';
import { validateRendered } from './talk-render.ts';
import { sortDiagnostics, validateTalk } from './validate.ts';

export interface Io { out: (s: string) => void; err: (s: string) => void }
const stdio: Io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') };

const USAGE = `usage: talkc <command> <talk> [options]
  build <talk> [--out <dir>]
  validate <talk> [--json] [--public] [--render]
  layout <talk> [--json] [--public]
  shoot <talk|film.html> [--holds] [--around S] [--times a,b] [--beats ch.beat,...] [--no-backups] [--out <dir>]
  publish <talk> [slug] [--out <dir>]`;

/** Flags per command; `true` = takes a value. */
const FLAGS: Record<string, Record<string, boolean>> = {
  build: { '--out': true },
  validate: { '--json': false, '--public': false, '--render': false },
  layout: { '--json': false, '--public': false },
  publish: { '--out': true },
  shoot: { '--holds': false, '--around': true, '--times': true, '--beats': true, '--no-backups': false, '--out': true },
};

interface Parsed { cmd: string; pos: string[]; flags: Set<string>; vals: Map<string, string[]> }

function parse(argv: readonly string[]): Parsed | string {
  const [cmd, ...rest] = argv;
  const known = cmd ? FLAGS[cmd] : undefined;
  if (!cmd || !known) return cmd ? `unknown command ${cmd}` : '';
  const p: Parsed = { cmd, pos: [], flags: new Set(), vals: new Map() };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) { p.pos.push(a); continue; }
    if (!(a in known)) return `unknown option ${a}`;
    p.flags.add(a);
    if (known[a]) {
      const v = rest[++i];
      if (v === undefined) return `${a} needs a value`;
      p.vals.set(a, [...(p.vals.get(a) ?? []), v]);
    }
  }
  return p;
}

const list = (vs: string[] | undefined) => (vs ?? []).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);

export function main(argv: readonly string[], io: Io = stdio): number | Promise<number> {
  if (argv[0] === '-h' || argv[0] === '--help') { io.err(USAGE); return 0; }
  const p = parse(argv);
  if (typeof p === 'string' || p.pos.length < 1 || p.pos.length > (p.cmd === 'publish' ? 2 : 1)) {
    if (typeof p === 'string' && p) io.err(`talkc: ${p}`);
    io.err(USAGE);
    return 2;
  }
  const { cmd, flags, vals } = p;
  const dir = path.resolve(p.pos[0]!);
  const out = vals.get('--out')?.at(-1);
  const json = flags.has('--json'), pub = flags.has('--public');

  if (cmd === 'build') {
    const r = compileTalk(dir, out ? { outDir: out } : {});
    for (const d of r.diagnostics) io.err(formatDiagnostic(d));
    if (!r.ok) { io.err('talkc: build failed'); return 1; }
    io.out(`wrote ${path.relative(process.cwd(), r.outFile!) || r.outFile} (${r.bytes} bytes)`);
    return 0;
  }
  if (cmd === 'shoot') return shoot(dir, p, out, io);
  if (cmd === 'publish') {
    const slug = p.pos[1];
    if (slug !== undefined && !/^[A-Za-z0-9._-]+$/.test(slug)) { io.err(`talkc: bad slug ${slug} (use letters, numbers, . _ -)`); return 2; }
    const r = publishTalk(dir, { ...(slug ? { slug } : {}), ...(out ? { outDir: out } : {}) });
    for (const d of r.diagnostics) io.err(formatDiagnostic(d));
    if (!r.ok) { io.err('talkc: publish failed'); return 1; }
    if (r.cut?.droppedLibs.length) io.out(`left out (only private beats use them): ${r.cut.droppedLibs.join(', ')}`);
    io.out(`wrote ${path.relative(process.cwd(), r.outFile!) || r.outFile} (${(r.bytes / 1e6).toFixed(2)} MB)`);
    return 0;
  }
  const talk = loadTalk(dir);
  if (cmd === 'validate') {
    const ds = validateTalk(talk, undefined, { public: pub });
    const report = (ds: Diagnostic[]) => {
      if (json) io.out(JSON.stringify({ ok: !hasErrors(ds), diagnostics: ds }, null, 2));
      else {
        for (const d of ds) io.out(formatDiagnostic(d));
        const n = (s: string) => ds.filter((d) => d.severity === s).length;
        io.out(`${n('error')} errors, ${n('warning')} warnings, ${n('info')} infos`);
      }
      return hasErrors(ds) ? 1 : 0;
    };
    if (!flags.has('--render')) return report(ds);
    if (hasErrors(ds)) { io.err('talkc: render checks skipped: fix the errors first'); return report(ds); }
    return validateRendered(talk, { public: pub }).then(
      (more) => report(sortDiagnostics([...ds, ...more])),
      (e: Error) => { io.err(`talkc: render checks failed: ${e.message.split('\n')[0]}`); return 1; });
  }
  // layout
  if (!talk.spine) { for (const d of talk.diagnostics) io.err(formatDiagnostic(d)); return 1; }
  const rec = recordTalk(talk, { public: pub });
  for (const d of rec.diagnostics) io.err(formatDiagnostic(d));
  io.out(json ? JSON.stringify(rec.layout, null, 2) : formatCplist(rec.layout));
  return 0;
}

async function shoot(target: string, p: Parsed, out: string | undefined, io: Io): Promise<number> {
  const times = list(p.vals.get('--times')).map(Number);
  const around = p.vals.has('--around') ? Number(p.vals.get('--around')!.at(-1)) : 0;
  if (times.some((t) => !Number.isFinite(t) || t < 0) || !Number.isFinite(around) || around < 0) {
    io.err('talkc: --times and --around take non-negative numbers'); io.err(USAGE); return 2;
  }
  const beats = list(p.vals.get('--beats'));
  let html = target, outDir = out;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const r = compileTalk(target);
    for (const d of r.diagnostics) io.err(formatDiagnostic(d));
    if (!r.ok) { io.err('talkc: build failed'); return 1; }
    html = r.outFile!;
    outDir ??= path.join(target, 'build', 'shots');
  } else if (!fs.existsSync(target)) { io.err(`talkc: no such talk or film: ${target}`); return 1; }
  outDir = path.resolve(outDir ?? path.join(path.dirname(target), 'shots'));
  const holds = p.flags.has('--holds') || (!times.length && !beats.length);
  const { shootFilm } = await import('@sage/render');
  try {
    const r = await shootFilm(html, outDir, { holds, around, times, beats, backups: !p.flags.has('--no-backups') });
    const errs = r.frames.filter((f) => f.errors);
    for (const f of errs) io.err(`talkc: page error at t=${f.t}: ${f.errors!.join('; ')}`);
    io.out(`shot ${r.frames.length} frames -> ${path.relative(process.cwd(), outDir) || outDir}`);
    return errs.length ? 1 : 0;
  } catch (e) {
    io.err(`talkc: shoot failed: ${(e as Error).message.split('\n')[0]}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
}
