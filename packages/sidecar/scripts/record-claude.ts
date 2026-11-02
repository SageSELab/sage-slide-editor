// record-claude.ts — records ONE live Agent SDK session through the real bridge, for the replay
// tests (PLAN 12.7). Costs real money: every request is capped by maxBudgetUsd.
//
//   node --import tsx scripts/record-claude.ts <out.ndjson> [budgetUsd=1]
//
// It copies fixtures/issta26 to a temp folder (with a small ../paper as materials), opens it in
// a real Session with the watcher on, answers app.* requests like the app would (allow every
// ask, canvas at t = 0), sends the prompts below, and writes the scrubbed trace. The raw trace
// never leaves the temp folder, which is deleted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeBridge, type TraceEntry } from '../src/claude/bridge.ts';
import type { AppStateResult } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { scrubEntry, type Recorded } from '../test/claude-trace.ts';
import { FIXTURE, REPO_ROOT } from '../test/helpers.ts';

export const PROMPTS = [
  'In scenes/line.html, inside the title block (the div that holds #t-lg), add one caption line after the logos: <p class="cap" id="t-cap" style="margin-top:18px">Preliminary results</p> (no data-a attribute, no motion). Make exactly one Edit and do not read other files first.',
  'Now call talk_frame for beat line.title, read the PNG it returns, and tell me in one sentence whether the caption is visible.',
];

async function main() {
  const out = path.resolve(process.argv[2] ?? 'claude-session.ndjson');
  const budget = Number(process.argv[3] ?? 1);
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-rec-')));
  const talk = path.join(base, 'talk');
  fs.cpSync(FIXTURE, talk, { recursive: true, filter: (s) => !s.includes(`${path.sep}build`) && !s.includes(`${path.sep}.sage`) });
  fs.mkdirSync(path.join(base, 'paper'));
  fs.writeFileSync(path.join(base, 'paper/main.tex'), '\\section{Results}\nPreliminary results: 12 of 20 bugs repaired.\n');
  const spineFile = path.join(talk, 'talk.json');
  const spine = JSON.parse(fs.readFileSync(spineFile, 'utf8'));
  spine.materials = { paper: '../paper' };
  fs.writeFileSync(spineFile, JSON.stringify(spine, null, 2) + '\n');

  const lines: Recorded[] = [];
  const places = { talk, base, repo: REPO_ROOT };
  const log = (level: string, msg: string) => { if (level !== 'debug') process.stderr.write(`[record] ${level}: ${msg}\n`); };
  const session = new Session({
    changed: (p) => lines.push({ kind: 'meta', event: 'talk.changed', ...p }),
    built: () => {},
  }, undefined, log);
  await session.open({ path: talk, watch: true });
  let t = 0;
  const bridge = new ClaudeBridge({
    root: session.root!,
    spine: () => session.spine(),
    layout: () => session.layout(),
    build: () => session.build(),
    expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
    notify: (method, params) => { lines.push({ kind: 'notify', method, params }); if (method === 'claude.delta') process.stderr.write((params as { text: string }).text); },
    request: async (method, params) => {
      if (method === 'app.ask') return { decision: 'allow' };
      if (method === 'app.goto') { t = (params as { t: number }).t; return { t }; }
      if (method === 'app.state') return { t, playing: false, selection: [], pinned: false } satisfies AppStateResult;
      throw new Error(`no ${method}`);
    },
    log,
  }, { budgetUsd: budget, trace: (e: TraceEntry) => lines.push(e) });

  let resolveDone: (() => void) | null = null;
  const origNotify = lines.push.bind(lines);
  lines.push = (...items: Recorded[]) => {
    const n = origNotify(...items);
    for (const it of items) if (it.kind === 'notify' && it.method === 'claude.result') resolveDone?.();
    return n;
  };
  let spent = 0;
  for (const prompt of PROMPTS) {
    const done = new Promise<void>((r) => { resolveDone = r; });
    await bridge.send({ text: prompt });
    await done;
    await new Promise((r) => setTimeout(r, 1_000)); // let the watcher report Claude's write
    const res = lines.filter((l) => l.kind === 'notify' && l.method === 'claude.result').at(-1) as { params: { cost: number; error?: unknown } };
    spent += res.params.cost;
    process.stderr.write(`\n[record] request cost ${res.params.cost.toFixed(4)} USD${res.params.error ? ` error ${JSON.stringify(res.params.error)}` : ''}\n`);
    if (res.params.error) break;
  }
  await bridge.close();
  await session.close();

  // Facts about isolation, printed as counts only (never the names).
  const init = lines.find((l) => l.kind === 'sdk' && (l.msg as { subtype?: string }).subtype === 'init') as { msg: Record<string, unknown> } | undefined;
  if (init) {
    const arr = (k: string) => (Array.isArray(init.msg[k]) ? (init.msg[k] as unknown[]) : []);
    const servers = arr('mcp_servers') as { name: string; source?: string; status?: string }[];
    process.stderr.write(`[record] init: mcp_servers ${servers.length} (other than talk: ${servers.filter((s) => s.name !== 'talk').length}; sources ${[...new Set(servers.map((s) => s.source ?? '?'))].join(',')}), ` +
      `skills ${arr('skills').length} (own: ${(arr('skills') as string[]).filter((s) => s.startsWith('sage-talk:')).join(',')}), plugins ${arr('plugins').length}, ` +
      `tools ${arr('tools').length} (mcp__ other than talk: ${(arr('tools') as string[]).filter((x) => x.startsWith('mcp__') && !x.startsWith('mcp__talk__')).length}), ` +
      `deferred talk tools: ${(arr('tools') as string[]).filter((x) => x.startsWith('mcp__talk__')).length === 5 ? 'no' : 'maybe'}; keys ${Object.keys(init.msg).sort().join(',')}\n`);
  }
  const results = lines.filter((l) => l.kind === 'sdk' && (l.msg as { type?: string }).type === 'result').map((l) => (l as { msg: { total_cost_usd: number } }).msg.total_cost_usd);
  process.stderr.write(`[record] result total_cost_usd values: ${results.join(', ')}; spent ${spent.toFixed(4)} USD\n`);

  lines.unshift({ kind: 'meta', recorded: new Date().toISOString().slice(0, 10), sdk: '0.3.316', model: bridge.model, prompts: PROMPTS.length });
  fs.writeFileSync(out, lines.map((l) => JSON.stringify(scrubEntry(l, places))).join('\n') + '\n');
  const leaks = fs.readFileSync(out, 'utf8').split(os.homedir()).length - 1;
  process.stderr.write(`[record] wrote ${lines.length} lines to ${path.basename(out)}; home-path occurrences after scrub: ${leaks}\n`);
  fs.rmSync(base, { recursive: true, force: true });
}

main().catch((e) => { process.stderr.write(`[record] failed: ${(e as Error).stack ?? e}\n`); process.exit(1); });
