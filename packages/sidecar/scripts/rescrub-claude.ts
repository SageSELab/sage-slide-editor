// rescrub-claude.ts — re-applies test/claude-trace.ts's scrub to a recording (after the scrub
// rules change) and checks it for leaks. Paths were already replaced by placeholders.
//
//   node --import tsx scripts/rescrub-claude.ts <in.ndjson> <out.ndjson>
import fs from 'node:fs';
import { LEAK_PATTERNS, scrubEntry, type Recorded } from '../test/claude-trace.ts';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) throw new Error('usage: rescrub-claude.ts <in> <out>');
const places = { talk: '/nonexistent-talk', base: '/nonexistent-base', repo: '/nonexistent-repo' };
const lines = fs.readFileSync(src, 'utf8').trim().split('\n').map((l) => scrubEntry(JSON.parse(l) as Recorded, places));
const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
fs.writeFileSync(dst, text);
let leaks = 0;
for (const re of LEAK_PATTERNS) if (re.test(text)) { leaks++; process.stderr.write(`leak: ${re}\n`); }
process.stderr.write(`${lines.length} lines, ${leaks} leak patterns\n`);
if (leaks) process.exit(1);
