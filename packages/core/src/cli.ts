#!/usr/bin/env node
// cli.ts — `talkc`: build, validate, layout. (shoot and publish come in a later phase.)
// Runs directly on Node 24 (type stripping); `node --import tsx` also works.
//
//   talkc build <talk> [--out <dir>]        write build/index.html; exit 1 on a build error
//   talkc validate <talk> [--json] [--public]   exit 1 when any error-severity diagnostic
//   talkc layout <talk> [--json] [--public]     the hold list, like ?cplist
// Exit codes: 0 ok, 1 talk has errors, 2 usage.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTalk } from './compile.ts';
import { formatDiagnostic, hasErrors } from './diagnostics.ts';
import { formatCplist } from './layout.ts';
import { loadTalk } from './load.ts';
import { recordTalk } from './record.ts';
import { validateTalk } from './validate.ts';

export interface Io { out: (s: string) => void; err: (s: string) => void }
const stdio: Io = { out: (s) => process.stdout.write(s + '\n'), err: (s) => process.stderr.write(s + '\n') };

const USAGE = `usage: talkc <command> <talk> [options]
  build <talk> [--out <dir>]
  validate <talk> [--json] [--public]
  layout <talk> [--json] [--public]`;

export function main(argv: readonly string[], io: Io = stdio): number {
  const [cmd, ...rest] = argv;
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const pos: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--out') out = rest[++i];
    else if (!a.startsWith('--')) pos.push(a);
  }
  const known = new Set(['--json', '--public', '--out']);
  const bad = [...flags].find((f) => !known.has(f));
  if (!cmd || cmd === '-h' || cmd === '--help' || bad || pos.length !== 1 || !['build', 'validate', 'layout'].includes(cmd)) {
    if (bad) io.err(`talkc: unknown option ${bad}`);
    io.err(USAGE);
    return cmd === '-h' || cmd === '--help' ? 0 : 2;
  }
  const dir = path.resolve(pos[0]!);
  const json = flags.has('--json'), pub = flags.has('--public');

  if (cmd === 'build') {
    const r = compileTalk(dir, out ? { outDir: out } : {});
    for (const d of r.diagnostics) io.err(formatDiagnostic(d));
    if (!r.ok) { io.err('talkc: build failed'); return 1; }
    io.out(`wrote ${path.relative(process.cwd(), r.outFile!) || r.outFile} (${r.bytes} bytes)`);
    return 0;
  }
  const talk = loadTalk(dir);
  if (cmd === 'validate') {
    const ds = validateTalk(talk, undefined, { public: pub });
    if (json) io.out(JSON.stringify({ ok: !hasErrors(ds), diagnostics: ds }, null, 2));
    else {
      for (const d of ds) io.out(formatDiagnostic(d));
      const n = (s: string) => ds.filter((d) => d.severity === s).length;
      io.out(`${n('error')} errors, ${n('warning')} warnings, ${n('info')} infos`);
    }
    return hasErrors(ds) ? 1 : 0;
  }
  // layout
  if (!talk.spine) { for (const d of talk.diagnostics) io.err(formatDiagnostic(d)); return 1; }
  const rec = recordTalk(talk, { public: pub });
  for (const d of rec.diagnostics) io.err(formatDiagnostic(d));
  io.out(json ? JSON.stringify(rec.layout, null, 2) : formatCplist(rec.layout));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
