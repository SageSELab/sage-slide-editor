// sync-themes.ts — regenerates the built-in themes (skill/academic-talk-film/assets/themes):
// each package's theme.css from its theme.json, and its fonts/ from the Google Fonts catalog
// (Fontsource; needs the network for fonts not yet in the package or the local font cache).
//
//   node --import tsx scripts/sync-themes.ts        (from packages/sidecar)
//
// The test themes.test.ts checks that every built-in validates, has all its fonts and that its
// theme.css is what this script writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Themer } from '../src/themes/index.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skill/academic-talk-film/assets/themes');
const themer = new Themer({ root: null, kind: null, spine: async () => ({}), computedEdit: async () => { throw new Error('no talk'); } });
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.talktheme')).sort()) {
  const pkg = path.join(dir, name);
  const theme = JSON.parse(fs.readFileSync(path.join(pkg, 'theme.json'), 'utf8')) as unknown;
  const r = await themer.save({ path: pkg, theme });
  console.log(`${name}: ${r.fonts.length} font files`);
}
