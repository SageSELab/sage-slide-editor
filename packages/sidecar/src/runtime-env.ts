// runtime-env.ts — resolves the runtime for the running entry and exports it into the
// environment, as a side effect of being imported. Imported first by main.ts and talkc.ts so it
// runs before anything reads SAGE_ENGINE_DIR, SAGE_PLUGIN_DIR or the browser choice.
import { fileURLToPath } from 'node:url';
import { applyRuntime, resolveRuntime } from './runtime.ts';

/** In a bundle import.meta.url is the bundle (dist/main.mjs or dist/talkc.mjs); in the repo, src/. */
export const runtime = resolveRuntime({ entry: fileURLToPath(import.meta.url) });
applyRuntime(runtime);
