// talk_theme_* and talk_fonts_* (PLAN 6.2): Claude creates a theme from a description, it is
// validated, saved into the user's library (a temp dir here) and applied through the same
// computed edit as theme.apply, labelled Claude's. Fonts come from a fake Fontsource (no
// network); a scripted SDK turn is replayed through the translator for the tool row. No SDK
// process, no model calls.
import fs from 'node:fs';
import path from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseTheme } from '@sage/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClaudeBridge, type QueryFn } from '../src/claude/bridge.ts';
import type { FrameRenderer } from '../src/claude/frames.ts';
import { claudeNotificationCheckers, type ChangedParams } from '../src/protocol.ts';
import { Session } from '../src/session.ts';
import { FontCatalog, Themer } from '../src/themes/index.ts';
import { eventually, quiet, tempTalk } from './helpers.ts';
import { BUILTINS, fakeFetch, tempDir } from './theme-helpers.ts';

const noFrames: FrameRenderer = { render: async () => ({ errors: [] }), close: async () => {} };
const SID = '99999999-3333-3333-4444-555555555555';

/** What Claude would write for "a dark-teal, editorial look with a serif display face". */
const tide = {
  format: 'sage-theme/1', id: 'tide', name: 'Tide', description: 'Editorial: off-white slides, deep teal ink, Lora headings; a teal-black dark passage.',
  light: { bg: '#f7f5f0', ink: '#0d2b2b', ink2: '#355454', ink3: '#6b8585', line: 'rgba(13, 43, 43, 0.14)', panel: 'rgba(13, 43, 43, 0.04)', accent1: '#0f766e', accent2: '#b45309', accent3: '#be123c' },
  dark: { bg: '#041414', ink: '#ecf5f3', ink2: '#9fbab6', ink3: '#5f7d79', line: 'rgba(236, 245, 243, 0.14)', panel: 'rgba(236, 245, 243, 0.06)', accent1: '#2dd4bf' },
  fonts: {
    display: { family: 'Lora', fallback: 'Georgia, serif', source: 'google', id: 'lora', weights: [600, 700] },
    body: { family: 'Inter', fallback: 'system-ui, sans-serif', source: 'google', id: 'inter', weights: [400, 500, 600] },
    mono: { family: 'JetBrains Mono', fallback: 'Menlo, monospace', source: 'google', id: 'jetbrains-mono', weights: [400] },
  },
  type: { xl: 120, l: 90, m: 60, s: 40, sub: 34, cap: 26, eyebrow: 26, headingWeight: 600, headingTracking: 0.5 },
};

describe('theme and font tools', () => {
  const t = tempTalk();
  const library = tempDir('sage-library-');
  const changed: ChangedParams[] = [];
  const notes: { method: string; params: Record<string, unknown> }[] = [];
  let session: Session;
  let bridge: ClaudeBridge;
  let messages: SDKMessage[] = [];
  const fetch = fakeFetch();
  const queryFn: QueryFn = ({ prompt }) => {
    const it = prompt[Symbol.asyncIterator]();
    async function* gen(): AsyncGenerator<SDKMessage> { await it.next(); for (const m of messages) yield m; }
    const g = gen();
    return { [Symbol.asyncIterator]: () => g, interrupt: async () => undefined, close: () => { void it.return?.(); } };
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await bridge.toolHandlers.get(name)!(args);
    return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
  };
  const css = () => fs.readFileSync(path.join(t.root, 'theme.css'), 'utf8');

  beforeAll(async () => {
    session = new Session({ changed: (p) => changed.push(p), built: () => {} }, undefined, () => {}, 60);
    await session.open({ path: t.root, watch: true });
    const themer = new Themer({
      get root() { return session.root; }, get kind() { return session.kind; },
      spine: () => session.spine(),
      computedEdit: (m, f, mk, b, a) => session.computedEdit(m, f, mk, b, a),
    }, { catalog: new FontCatalog({ cacheDir: tempDir('sage-fonts-'), fetch }), builtins: BUILTINS, library });
    bridge = new ClaudeBridge({
      root: t.root,
      spine: async () => (await session.spine()) as never,
      layout: () => session.layout(),
      build: () => session.build(),
      edit: (p) => session.edit(p, 'claude'),
      themer,
      expectWrite: (rel, content, author) => session.expectWrite(rel, content, author),
      notify: (method, params) => notes.push({ method, params: params as unknown as Record<string, unknown> }),
      request: async () => ({ t: 0, playing: false, selection: [], pinned: false }),
      log: () => {},
    }, { queryFn, frames: noFrames });
  }, 60_000);
  afterAll(async () => { await bridge.close(); await session.close(); t.cleanup(); });

  it('talk_theme_list shows the built-ins and the talk\'s current look', async () => {
    const r = await call('talk_theme_list', {});
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toContain('paper\tPaper\tbuilt-in\tWarm:');
    expect(r.text).toContain('contrast\tHigh Contrast\tbuilt-in');
    expect(r.text).toContain('This talk now: display Manrope, body SF Pro Text, mono Menlo; light bg #ffffff');
  });

  it('talk_theme_create returns the problems of an invalid theme and writes nothing', async () => {
    const before = css();
    const r = await call('talk_theme_create', { theme: { ...tide, light: { ...tide.light, bg: 'red; } * { display: none' }, fonts: { ...tide.fonts, display: { family: 'Lora', fallback: 'serif', source: 'google' } } } });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('- light.bg: must be a plain CSS value');
    expect(r.text).toContain('- fonts.display.id: google fonts need their Fontsource id');
    expect(css()).toBe(before);
    expect(fs.readdirSync(library)).toEqual([]);
  });

  it('talk_theme_create saves a valid theme to the library and applies it as Claude', async () => {
    changed.length = 0;
    const r = await call('talk_theme_create', { theme: tide });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^Saved the theme "Tide" \(tide\) to the library: .*tide\.talktheme with 6 font files\.\nApplied it to this talk\.\nChanged: assets\/fonts\/inter-latin-400-normal\.woff2, /);
    const pkg = path.join(library, 'tide.talktheme');
    expect(parseTheme(JSON.parse(fs.readFileSync(path.join(pkg, 'theme.json'), 'utf8'))).problems).toEqual([]);
    expect(fs.readdirSync(path.join(pkg, 'fonts'))).toHaveLength(6);
    expect(css()).toContain('--display: Lora, Georgia, serif;');
    expect(css()).toContain('#black { background: #041414 !important; }');
    await eventually(() => changed.some((c) => c.paths.includes('theme.css')), 8_000, 'the watcher batch');
    await quiet([changed]);
    expect(changed.every((c) => c.source === 'claude')).toBe(true);
    // apply: false only saves.
    const only = await call('talk_theme_create', { theme: { ...tide, id: 'tide-2', name: 'Tide 2' }, apply: false });
    expect(only.text).toMatch(/^Saved the theme "Tide 2" \(tide-2\)[^\n]*\.$/);
  });

  it('talk_theme_apply by name, and an unknown theme', async () => {
    const r = await call('talk_theme_apply', { theme: 'slate' });
    expect(r.isError, r.text).toBe(false);
    expect(r.text).toMatch(/^Applied the theme "Slate" \(slate\)\./);
    expect(css()).toContain('--display: "Space Grotesk"');
    expect(css()).not.toContain('Lora'); // the previous theme's faces are gone
    const bad = await call('talk_theme_apply', { theme: 'Neon' });
    expect(bad).toEqual({ isError: true, text: 'No theme "Neon". Call talk_theme_list for the library.' });
  });

  it('talk_fonts_search and talk_fonts_add', async () => {
    const s = await call('talk_fonts_search', { query: 'play' });
    expect(s.text).toBe('id\tfamily\tcategory\tweights\nplayfair-display\tPlayfair Display\tserif\tweights 400,500,600,700,800,900\titalic');
    const a = await call('talk_fonts_add', { id: 'playfair-display', weights: [700] });
    expect(a.isError, a.text).toBe(false);
    expect(a.text).toBe('Embedded Playfair Display: assets/fonts/playfair-display-latin-700-normal.woff2.\nUse font-family: "Playfair Display", Georgia, "Times New Roman", serif;\nThe talk rebuilt.');
    expect(css()).toContain('src: url("assets/fonts/playfair-display-latin-700-normal.woff2")');
    expect((await call('talk_fonts_add', { id: 'ubuntu' })).isError).toBe(true);
  });

  it('a replayed turn calling talk_theme_create yields a readable tool row', async () => {
    const input = { theme: { ...tide, id: 'tide-3', name: 'Tide 3' }, apply: false };
    const done = (await call('talk_theme_create', input)).text;
    messages = [
      { type: 'system', subtype: 'init', session_id: SID, model: 'claude-opus-5-5', skills: ['sage-talk:academic-talk-film'], tools: [], mcp_servers: [{ name: 'talk', status: 'connected' }] },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu7', name: 'mcp__talk__talk_theme_create', input }] }, parent_tool_use_id: null, session_id: SID },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu7', content: [{ type: 'text', text: done }] }] }, parent_tool_use_id: null, session_id: SID },
      { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 5, num_turns: 1, usage: {}, session_id: SID },
    ] as unknown as SDKMessage[];
    await bridge.send({ text: 'make me a teal theme' });
    await eventually(() => notes.some((n) => n.method === 'claude.result'), 5_000, 'the result');
    const rows = notes.filter((n) => n.method === 'claude.tool');
    for (const r of rows) expect(claudeNotificationCheckers['claude.tool'](r.params)).toEqual([]);
    expect(rows[0]!.params).toMatchObject({ id: 'tu7', name: 'talk_theme_create', status: 'running', summary: '"Tide 3"' });
    expect(rows.at(-1)!.params).toMatchObject({ id: 'tu7', status: 'done' });
  });
});
