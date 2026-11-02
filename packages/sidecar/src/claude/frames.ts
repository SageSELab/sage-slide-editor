// frames.ts — talk_frame's renderer: headless Chromium through @sage/render (PLAN 6.2; Phase 0
// chose Chromium over WKWebView's takeSnapshot, which flattens 3D). One browser per bridge,
// launched on first use; the film is reopened per call because every call follows a rebuild.
import fs from 'node:fs';
import path from 'node:path';

export interface Shot { t: number; file: string }

export interface FrameRenderer {
  /** Renders each shot of the compiled film at `htmlPath` to its PNG file. */
  render(htmlPath: string, shots: Shot[]): Promise<{ errors: string[] }>;
  close(): Promise<void>;
}

export function chromiumFrames(): FrameRenderer {
  let renderer: Promise<import('@sage/render').Renderer> | null = null;
  return {
    async render(htmlPath, shots) {
      const { Renderer } = await import('@sage/render');
      renderer ??= Renderer.launch();
      const r = await renderer;
      const film = await r.openFilm(htmlPath);
      try {
        for (const s of shots) {
          fs.mkdirSync(path.dirname(s.file), { recursive: true });
          await film.frame(s.t, { path: s.file });
        }
        return { errors: film.errors() };
      } finally {
        await film.close();
      }
    },
    async close() {
      const r = renderer;
      renderer = null;
      if (r) await (await r).close().catch(() => {});
    },
  };
}
