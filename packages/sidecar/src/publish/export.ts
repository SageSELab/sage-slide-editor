// export.ts — talk.export: holds of the compiled film (build/index.html, backups included) as
// PNGs or one PDF, rendered by @sage/render's headless Chromium (the renderer behind talkc shoot
// and talk_frame; Phase 0 chose it over WKWebView snapshots, which flatten 3D).
//
//   png  <talk>/build/export/png/hold-NN.png (and hold-NN-before/after.png with `around`), plus
//        manifest.json. The folder is emptied first, so it only ever holds one export.
//   pdf  <talk>/build/export/<talk>.pdf: one 1920x1080-point page per frame, each the frame's
//        PNG drawn full-bleed. Assembled with pdf-lib (pure JS, no native code, MIT): Chromium's
//        page.pdf() would print the page's layout instead of the frame as it renders.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import type { FramePlan, Hold, Renderer } from '@sage/render';
import { RpcError, ErrorCode, type ExportParams, type ExportProgressParams, type ExportResult } from '../protocol.ts';
import { slugify } from './publish.ts';

export const STAGE = { width: 1920, height: 1080 } as const;

export interface ExportDeps {
  /** A launched renderer (closed by the caller), or a factory for one. */
  launch?: () => Promise<Renderer>;
  progress?: (p: ExportProgressParams) => void;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Frames for the chosen holds (1-based numbers of the full film), sorted by time. */
export function exportPlan(holds: Hold[], duration: number, p: Pick<ExportParams, 'holds' | 'around'>, plan: typeof import('@sage/render').planFrames): FramePlan[] {
  let chosen = holds;
  if (Array.isArray(p.holds)) {
    const bad = p.holds.filter((n) => n < 1 || n > holds.length);
    if (bad.length) throw new RpcError(ErrorCode.InvalidParams, `no hold ${bad.join(', ')} (the film has ${holds.length})`, { problems: [`params.holds: out of range ${bad.join(', ')}`] });
    const want = new Set(p.holds);
    chosen = holds.filter((h) => want.has(h.index));
  }
  return plan(chosen, duration, { holds: true, ...(p.around ? { around: p.around } : {}) });
}

export const frameFile = (f: FramePlan, width: number) =>
  `hold-${pad(f.hold ?? 0, width)}${f.kind === 'before' ? '-before' : f.kind === 'after' ? '-after' : ''}.png`;

export async function exportFilm(root: string, p: ExportParams, deps: ExportDeps = {}): Promise<ExportResult> {
  const t0 = performance.now();
  const film = path.join(root, 'build', 'index.html');
  if (!fs.existsSync(film)) throw new RpcError(ErrorCode.NoTalkOpen, `no compiled film at ${film}`);
  const render = await import('@sage/render');
  const own = !deps.launch;
  const renderer = deps.launch ? await deps.launch() : await render.Renderer.launch();
  try {
    const f = await renderer.openFilm(film);
    try {
      const holds = f.holds();
      const frames = exportPlan(holds, f.duration, p, render.planFrames);
      const width = Math.max(2, String(holds.length).length);
      const total = frames.length;
      const exportDir = path.join(root, 'build', 'export');
      const files: string[] = [];
      let errorsSeen = f.errors().length;
      const errors: string[] = [];
      const shot = async (fr: FramePlan, i: number, to?: string) => {
        const png = await f.frame(fr.t, to ? { path: to } : {});
        const e = f.errors();
        if (e.length > errorsSeen) { errors.push(...e.slice(errorsSeen)); errorsSeen = e.length; }
        deps.progress?.({ kind: p.kind, done: i + 1, total });
        return png;
      };
      if (p.kind === 'png') {
        const dir = path.join(exportDir, 'png');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        for (const [i, fr] of frames.entries()) {
          const file = path.join(dir, frameFile(fr, width));
          await shot(fr, i, file);
          files.push(file);
        }
        const manifest = { film, duration: f.duration, renderer: renderer.version, width: STAGE.width, height: STAGE.height,
          frames: frames.map((fr, i) => ({ file: path.basename(files[i]!), t: fr.t, kind: fr.kind, hold: fr.hold, label: fr.label, backup: fr.backup })) };
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        return { kind: 'png', dir, files, frames: total, ...STAGE, ms: Math.round(performance.now() - t0), errors };
      }
      const doc = await PDFDocument.create();
      const title = readTitle(root);
      doc.setTitle(title);
      doc.setCreator('SAGE Talk');
      doc.setProducer('SAGE Talk (@sage/render, pdf-lib)');
      for (const [i, fr] of frames.entries()) {
        const img = await doc.embedPng(await shot(fr, i));
        doc.addPage([STAGE.width, STAGE.height]).drawImage(img, { x: 0, y: 0, width: STAGE.width, height: STAGE.height });
      }
      fs.mkdirSync(exportDir, { recursive: true });
      const out = path.join(exportDir, `${slugify(path.basename(root))}.pdf`);
      const tmp = out + '.tmp';
      fs.writeFileSync(tmp, await doc.save());
      fs.renameSync(tmp, out);
      files.push(out);
      return { kind: 'pdf', dir: exportDir, files, frames: total, ...STAGE, ms: Math.round(performance.now() - t0), errors };
    } finally { await f.close(); }
  } finally { if (own) await renderer.close().catch(() => {}); }
}

function readTitle(root: string): string {
  try { return String((JSON.parse(fs.readFileSync(path.join(root, 'talk.json'), 'utf8')) as { title?: string }).title ?? path.basename(root)); } catch { return path.basename(root); }
}
