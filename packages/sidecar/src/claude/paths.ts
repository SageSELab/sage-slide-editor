// paths.ts — small path helpers shared by the Claude bridge modules.
import path from 'node:path';

/** True when `p` is `root` or inside it (both absolute; no symlink resolution). */
export function within(p: string, root: string): boolean {
  const a = path.resolve(p), r = path.resolve(root);
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Talk-relative POSIX path of an absolute path inside `root`, or null. */
export function relInside(root: string, p: string): string | null {
  if (!within(p, root)) return null;
  return path.relative(path.resolve(root), path.resolve(p)).split(path.sep).join('/');
}

/** Resolves a tool's path argument against the talk folder (tools may pass relative paths). */
export function absFrom(root: string, p: string): string {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(root, p);
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
