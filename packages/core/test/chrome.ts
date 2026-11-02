// Headless Chrome helpers for the browser-equivalence tests (PLAN 12.3 flags).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const hasChrome = fs.existsSync(CHROME);

async function chrome(args: string[]) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'talkc-chrome-'));
  try {
    return await run(CHROME, ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--virtual-time-budget=3000', ...args], { maxBuffer: 64 << 20, timeout: 90_000 });
  } finally { fs.rmSync(profile, { recursive: true, force: true }); }
}

/** `?cplist&layout&capture` — the runtime's hold list and Talk.layout JSON. */
export async function browserLayout(indexHtml: string): Promise<{ cplist: string; layout: { beats: { id: string; start: number; lastEnd: number; hold: number; at: number }[]; duration: number; diagnostics: { beat: string; code: string; sel?: string }[] } }> {
  const { stdout } = await chrome(['--dump-dom', pathToFileURL(indexHtml).href + '?cplist&layout&capture']);
  const pre = (id: string) => {
    const m = new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`).exec(stdout);
    if (!m) throw new Error(`no <pre id="${id}"> in dump`);
    return m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  };
  return { cplist: pre('cplist'), layout: JSON.parse(pre('layout')) };
}

/** One 1920x1080 frame at time t. */
export async function shoot(indexHtml: string, t: number, out: string): Promise<Buffer> {
  await chrome([`--screenshot=${out}`, '--window-size=1920,1080', '--hide-scrollbars', pathToFileURL(indexHtml).href + `?t=${t}&capture`]);
  return fs.readFileSync(out);
}
