import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TalkWatcher, atomicAppWrite, isIgnored, type WatchBatch } from '../src/watcher.ts';
import { eventually, tempTalk } from './helpers.ts';

describe('isIgnored', () => {
  it.each([
    ['build/index.html', true], ['.sage/thumbs/1.png', true], ['node_modules/x/y.js', true], ['scenes/.DS_Store', true],
    ['beats/line.js~', true], ['beats/.line.js.swp', true], ['.sage/tmp/a.tmp-1-2', true], ['scenes/line.html.tmp.84781.bc19e2d964ab', true], ['scenes/a.tmp.html', false],
    ['scenes/line.html', false], ['talk.json', false], ['assets/faces/a.jpg', false], ['lib/builder.js', false],
  ])('%s -> %s', (rel, want) => expect(isIgnored(rel)).toBe(want));
});

describe('TalkWatcher', () => {
  let stop = () => {};
  afterEach(() => stop());

  function start() {
    const t = tempTalk();
    const batches: WatchBatch[] = [];
    const w = new TalkWatcher(t.root, { debounceMs: 80, onBatch: (b) => batches.push(b) });
    w.start();
    stop = () => { w.stop(); t.cleanup(); };
    return { root: t.root, w, batches };
  }
  const settle = () => new Promise((r) => setTimeout(r, 300)); // let FSEvents deliver the copy's tail

  it('labels an unannounced write external, and ignores build/', async () => {
    const { root, batches } = start();
    await settle();
    batches.length = 0;
    fs.mkdirSync(path.join(root, 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'build/index.html'), 'x');
    fs.appendFileSync(path.join(root, 'scenes/line.html'), '\n<!-- external -->\n');
    const b = await eventually(() => batches.find((x) => x.external.includes('scenes/line.html')), 8000, 'external batch');
    expect(b.app).toEqual([]);
    expect(batches.flatMap((x) => [...x.app, ...x.external]).filter((p) => p.startsWith('build'))).toEqual([]);
  });

  it('labels an announced atomic write app, and a later different write external', async () => {
    const { root, w, batches } = start();
    await settle();
    batches.length = 0;
    atomicAppWrite(w, root, 'beats/line.js', '// app edit\n');
    const a = await eventually(() => batches.find((x) => x.app.includes('beats/line.js')), 8000, 'app batch');
    expect(a.external).toEqual([]);
    expect(fs.existsSync(path.join(root, '.sage/tmp'))).toBe(true);
    batches.length = 0;
    fs.writeFileSync(path.join(root, 'beats/line.js'), '// terminal edit\n');
    await eventually(() => batches.find((x) => x.external.includes('beats/line.js')), 8000, 'external batch');
  });

  it('flush() classifies by content, independent of FSEvents timing', () => {
    const t = tempTalk();
    stop = t.cleanup;
    const batches: WatchBatch[] = [];
    const w = new TalkWatcher(t.root, { onBatch: (b) => batches.push(b) });
    w.expectWrite('talk.json', fs.readFileSync(path.join(t.root, 'talk.json')));
    w.expectWrite('theme.css', 'something else');
    (w as unknown as { dirty: Set<string> }).dirty = new Set(['talk.json', 'theme.css', 'scenes']);
    w.flush();
    expect(batches).toEqual([{ app: ['talk.json'], external: ['theme.css'] }]);
  });

  it('labels writes announced by Claude separately from the app\'s', () => {
    const t = tempTalk();
    stop = t.cleanup;
    const batches: WatchBatch[] = [];
    const w = new TalkWatcher(t.root, { onBatch: (b) => batches.push(b) });
    fs.writeFileSync(path.join(t.root, 'scenes/line.html'), 'claude wrote this');
    w.expectWrite('scenes/line.html', 'claude wrote this', 'claude');
    w.expectWrite('talk.json', fs.readFileSync(path.join(t.root, 'talk.json')), 'app');
    w.expectWrite('theme.css', 'predicted, but a terminal won', 'claude');
    (w as unknown as { dirty: Set<string> }).dirty = new Set(['scenes/line.html', 'talk.json', 'theme.css']);
    w.flush();
    expect(batches).toEqual([{ app: ['talk.json'], external: ['theme.css'], claude: ['scenes/line.html'] }]);
  });
});
