// materials.ts — the paper materials a talk declares in talk.json (PLAN 7): resolved against the
// talk folder, passed to the Agent SDK as additionalDirectories, and inventoried for
// talk_materials. Files (a PDF) contribute their folder; missing entries are skipped with a
// diagnostic rather than failing the session.
import fs from 'node:fs';
import path from 'node:path';

export interface MaterialEntry {
  key: string;
  /** As written in talk.json (usually relative to the talk). */
  declared: string;
  abs: string;
  kind: 'dir' | 'file' | 'missing';
}

export interface Materials {
  entries: MaterialEntry[];
  /** Folders Claude may read: each directory entry, and the folder of each file entry. Deduplicated. */
  dirs: string[];
  /** One line per skipped entry. */
  diagnostics: string[];
}

export function resolveMaterials(talkRoot: string, declared: Record<string, string> | undefined): Materials {
  const entries: MaterialEntry[] = [];
  const dirs = new Set<string>();
  const diagnostics: string[] = [];
  for (const [key, rel] of Object.entries(declared ?? {})) {
    if (typeof rel !== 'string' || !rel) continue;
    const abs = path.resolve(talkRoot, rel);
    let kind: MaterialEntry['kind'] = 'missing';
    try {
      const real = fs.realpathSync(abs);
      kind = fs.statSync(real).isDirectory() ? 'dir' : 'file';
      dirs.add(kind === 'dir' ? real : path.dirname(real));
      entries.push({ key, declared: rel, abs: real, kind });
      continue;
    } catch {
      diagnostics.push(`materials.${key}: ${rel} does not exist; skipped`);
    }
    entries.push({ key, declared: rel, abs, kind });
  }
  // A folder already covered by another is redundant.
  const list = [...dirs].sort();
  const minimal = list.filter((d) => !list.some((o) => o !== d && (d + path.sep).startsWith(o + path.sep)));
  return { entries, dirs: minimal, diagnostics };
}

const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv', 'build', '.sage']);

/** A short text inventory: per entry, file counts by extension and the top-level listing. */
export function inventory(m: Materials, opts: { maxDepth?: number; maxFiles?: number; listTop?: number } = {}): string {
  const maxDepth = opts.maxDepth ?? 4, maxFiles = opts.maxFiles ?? 5_000, listTop = opts.listTop ?? 40;
  if (!m.entries.length) return 'This talk declares no materials in talk.json ("materials": {"paper": "../paper", ...}).';
  const out: string[] = [];
  for (const e of m.entries) {
    if (e.kind === 'missing') { out.push(`${e.key}: ${e.declared} (missing)`); continue; }
    if (e.kind === 'file') {
      const size = fs.statSync(e.abs).size;
      out.push(`${e.key}: ${e.declared} -> ${e.abs} (file, ${Math.round(size / 1024)} KB)`);
      continue;
    }
    const byExt = new Map<string, number>();
    let files = 0, truncated = false;
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth || truncated) return;
      let names: fs.Dirent[];
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        if (SKIP.has(d.name)) continue;
        if (d.isDirectory()) walk(path.join(dir, d.name), depth + 1);
        else if (d.isFile()) {
          if (++files > maxFiles) { truncated = true; return; }
          const ext = path.extname(d.name).toLowerCase() || '(none)';
          byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
        }
      }
    };
    walk(e.abs, 0);
    const exts = [...byExt].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x, n]) => `${x} ${n}`).join(', ');
    out.push(`${e.key}: ${e.declared} -> ${e.abs} (folder, ${truncated ? `>${maxFiles}` : files} files: ${exts || 'empty'})`);
    let top: string[] = [];
    try {
      top = fs.readdirSync(e.abs, { withFileTypes: true }).filter((d) => !SKIP.has(d.name)).map((d) => d.name + (d.isDirectory() ? '/' : '')).sort();
    } catch { /* unreadable */ }
    out.push('  ' + top.slice(0, listTop).join('  ') + (top.length > listTop ? `  … (+${top.length - listTop})` : ''));
  }
  if (m.diagnostics.length) out.push('', ...m.diagnostics);
  return out.join('\n');
}
