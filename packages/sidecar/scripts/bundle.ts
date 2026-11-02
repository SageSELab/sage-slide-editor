// bundle.ts — the packaged app's sidecar as two ESM files (docs/packaging.md):
//   <out>/dist/main.mjs    src/main.ts with @sage/core, @sage/render, zod, parse5, linkedom, acorn
//   <out>/dist/talkc.mjs   @sage/core's CLI, for bin/talkc
// Left external, installed next to dist/ by apps/mac/scripts/package.sh, because they cannot be
// bundled: the Agent SDK (it locates its ~300 MB native claude binary as a sibling package)
// and Playwright (it resolves its own files and spawns its installer and driver). `playwright`
// is mapped to `playwright-core`, which is all @sage/render uses. Prints a size summary.
//
//   node scripts/bundle.ts <out-dir>
import { build, type Plugin } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/bundle.ts <out-dir>'); process.exit(2); }
const dist = path.join(path.resolve(out), 'dist');
fs.rmSync(dist, { recursive: true, force: true });

export const EXTERNAL = ['@anthropic-ai/claude-agent-sdk', 'playwright-core'];

/** `playwright` -> external `playwright-core` (same API; the test runner is not needed). */
const playwrightCore: Plugin = {
  name: 'playwright-core',
  setup(b) {
    b.onResolve({ filter: /^playwright$/ }, () => ({ path: 'playwright-core', external: true }));
  },
};

/**
 * @sage/core's cli.ts runs main() when `argv[1]` is its own file. Inside a bundle every module's
 * import.meta.url is the bundle's, so that guard would fire in main.mjs too (core's index
 * re-exports the CLI). Strip it; src/talkc.ts calls main() itself.
 */
const CLI_GUARD = 'if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {';
const cliGuard: Plugin = {
  name: 'cli-guard',
  setup(b) {
    b.onLoad({ filter: /[\/]core[\/]src[\/]cli\.ts$/ }, (args) => {
      const src = fs.readFileSync(args.path, 'utf8');
      if (src.split(CLI_GUARD).length !== 2) throw new Error(`bundle.ts: the main guard in ${args.path} changed; update CLI_GUARD`);
      return { contents: src.replace(CLI_GUARD, 'if (false) { // bundled: see scripts/bundle.ts'), loader: 'ts' };
    });
  },
};

const result = await build({
  absWorkingDir: PKG,
  entryPoints: { main: 'src/main.ts', talkc: 'src/talkc.ts' },
  outdir: dist,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: EXTERNAL,
  plugins: [playwrightCore, cliGuard],
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire as __sageRequire } from 'node:module';\nconst require = __sageRequire(import.meta.url);" },
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
});

const imports = new Set<string>();
for (const o of Object.values(result.metafile.outputs)) for (const i of o.imports) if (i.external) imports.add(i.path);
const unexpected = [...imports].filter((i) => !i.startsWith('node:') && !EXTERNAL.includes(i) && !/^[a-z_]+(\/[a-z_]+)?$/.test(i));
for (const [file, o] of Object.entries(result.metafile.outputs)) console.log(`${path.relative(PKG, file)}  ${(o.bytes / 1024).toFixed(0)} KB`);
console.log(`external: ${[...imports].filter((i) => EXTERNAL.includes(i)).sort().join(', ')}`);
if (unexpected.length) { console.error(`bundle.ts: unexpected external imports: ${unexpected.join(', ')}`); process.exit(1); }
