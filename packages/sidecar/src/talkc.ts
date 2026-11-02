// talkc.ts — the esbuild entry for the packaged app's talkc (dist/talkc.mjs, run by bin/talkc).
//
// runtime-env.ts is evaluated first and exports the bundled runtime (engine folder, browser
// choice) into the environment; then @sage/core's CLI runs. scripts/bundle.ts strips cli.ts's
// own "am I the program" guard from bundles, so main() runs exactly once, here. (Run from the
// repository, `node --import tsx src/talkc.ts`, that guard does not fire either.)
import './runtime-env.ts';
import { main } from '../../core/src/cli.ts';

Promise.resolve(main(process.argv.slice(2))).then((code) => { process.exitCode = code; });
