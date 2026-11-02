// canUseTool policy (PLAN 12.7 "Permission tests"): reads in the talk and materials pass, writes
// inside the talk pass and are announced, everything else asks, "Allow for this talk" persists.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PermissionStore, bashPrefix, decide, matches, predictWrite, ruleFor, type PolicyContext } from '../src/claude/policy.ts';

let base: string, talk: string, paper: string, ctx: PolicyContext;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sage-policy-')));
  talk = path.join(base, 'talk');
  paper = path.join(base, 'paper');
  fs.mkdirSync(path.join(talk, 'scenes'), { recursive: true });
  fs.mkdirSync(paper);
  fs.writeFileSync(path.join(talk, 'scenes/a.html'), '<p id="x">Hello</p>\n<p id="y">Hello</p>\n');
  ctx = { talkRoot: talk, readRoots: [talk, paper], rules: [] };
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('decide', () => {
  it('allows reads in the talk and in materials, asks for reads elsewhere', () => {
    expect(decide('Read', { file_path: path.join(talk, 'talk.json') }, ctx).kind).toBe('allow');
    expect(decide('Read', { file_path: path.join(paper, 'main.tex') }, ctx).kind).toBe('allow');
    expect(decide('Grep', { pattern: 'x' }, ctx).kind).toBe('allow'); // no path: the cwd
    expect(decide('Glob', { pattern: '**/*.tex', path: paper }, ctx).kind).toBe('allow');
    const d = decide('Read', { file_path: '/etc/hosts' }, ctx);
    expect(d).toMatchObject({ kind: 'ask', path: '/etc/hosts', reason: expect.stringContaining('outside') });
  });

  it('allows writes inside the talk and announces the predicted content', () => {
    const w = decide('Write', { file_path: path.join(talk, 'scenes/b.html'), content: 'new' }, ctx);
    expect(w).toEqual({ kind: 'allow', why: 'write in talk', announce: { rel: 'scenes/b.html', content: 'new' } });
    const e = decide('Edit', { file_path: 'scenes/a.html', old_string: 'Hello', new_string: 'Hi' }, ctx);
    expect(e).toMatchObject({ kind: 'allow', announce: { rel: 'scenes/a.html', content: '<p id="x">Hi</p>\n<p id="y">Hello</p>\n' } });
    // An Edit whose old_string is missing will fail in the tool; it is allowed but not announced.
    expect(decide('Edit', { file_path: path.join(talk, 'scenes/a.html'), old_string: 'nope', new_string: 'x' }, ctx)).toEqual({ kind: 'allow', why: 'write in talk' });
  });

  it('asks for writes in the paper folder and elsewhere, and for shell commands', () => {
    const p = decide('Write', { file_path: path.join(paper, 'notes.txt'), content: 'x' }, ctx);
    expect(p).toMatchObject({ kind: 'ask', rule: { tool: 'Write', prefix: paper }, scope: 'Write in ../paper' });
    expect(decide('Edit', { file_path: path.join(base, 'elsewhere.txt'), old_string: 'a', new_string: 'b' }, ctx).kind).toBe('ask');
    expect(decide('Bash', { command: 'npx talkc build .' }, ctx)).toMatchObject({ kind: 'ask', rule: { tool: 'Bash', prefix: 'npx talkc' } });
    expect(decide('WebFetch', { url: 'https://example.org/a' }, ctx)).toMatchObject({ kind: 'ask', rule: { tool: 'WebFetch', prefix: 'example.org' } });
  });

  it('allows the app tools and housekeeping tools, denies AskUserQuestion', () => {
    expect(decide('mcp__talk__talk_frame', { beat: 'line.title' }, ctx).kind).toBe('allow');
    expect(decide('Skill', { skill: 'sage-talk:academic-talk-film' }, ctx).kind).toBe('allow');
    expect(decide('ToolSearch', { query: 'x' }, ctx).kind).toBe('allow');
    expect(decide('AskUserQuestion', { questions: [] }, ctx).kind).toBe('deny');
  });

  it('a path that only looks like the talk (prefix sibling) is outside it', () => {
    fs.mkdirSync(talk + '-old');
    expect(decide('Write', { file_path: path.join(talk + '-old', 'x'), content: '' }, ctx).kind).toBe('ask');
  });
});

describe('saved rules', () => {
  it('Bash rules match simple commands with the same first two words only', () => {
    expect(bashPrefix('npx talkc build .')).toBe('npx talkc');
    expect(bashPrefix('ls')).toBe('ls');
    expect(bashPrefix('npx talkc build && rm -rf /')).toBeNull();
    const rule = ruleFor('Bash', { command: 'npx talkc build .' }, talk).rule;
    expect(matches(rule, 'Bash', { command: 'npx talkc validate .' }, talk)).toBe(true);
    expect(matches(rule, 'Bash', { command: 'npx talkcx' }, talk)).toBe(false);
    expect(matches(rule, 'Bash', { command: 'npx talkc build; rm -rf ~' }, talk)).toBe(false);
    // A compound command gets an exact rule that never matches, so it keeps asking.
    const exact = ruleFor('Bash', { command: 'a && b' }, talk);
    expect(exact.scope).toBe('this exact command');
    expect(matches(exact.rule, 'Bash', { command: 'a && b' }, talk)).toBe(false);
  });

  it('file rules cover the folder', () => {
    const rule = ruleFor('Write', { file_path: path.join(paper, 'figs/a.pdf') }, talk).rule;
    expect(rule).toEqual({ tool: 'Write', prefix: path.join(paper, 'figs') });
    expect(matches(rule, 'Write', { file_path: path.join(paper, 'figs/sub/b.pdf') }, talk)).toBe(true);
    expect(matches(rule, 'Write', { file_path: path.join(paper, 'c.pdf') }, talk)).toBe(false);
    expect(matches(rule, 'Edit', { file_path: path.join(paper, 'figs/a.pdf') }, talk)).toBe(false);
  });

  it('"Allow for this talk" persists in .sage/permissions.json and applies on the next decision', () => {
    const store = new PermissionStore(talk);
    const ask = decide('Bash', { command: 'npx talkc build .' }, { ...ctx, rules: store.rules });
    expect(ask.kind).toBe('ask');
    if (ask.kind !== 'ask') return;
    store.add(ask.rule);
    store.add(ask.rule); // no duplicates
    const saved = JSON.parse(fs.readFileSync(path.join(talk, '.sage/permissions.json'), 'utf8'));
    expect(saved).toEqual({ rules: [{ tool: 'Bash', prefix: 'npx talkc' }] });
    const reopened = new PermissionStore(talk);
    expect(decide('Bash', { command: 'npx talkc validate .' }, { ...ctx, rules: reopened.rules })).toMatchObject({ kind: 'allow', why: 'saved rule' });
  });

  it('ignores a malformed permissions file', () => {
    fs.mkdirSync(path.join(talk, '.sage'));
    fs.writeFileSync(path.join(talk, '.sage/permissions.json'), '{"rules":[{"tool":3},{"tool":"Bash","prefix":"ls"}]');
    expect(new PermissionStore(talk).rules).toEqual([]);
    fs.writeFileSync(path.join(talk, '.sage/permissions.json'), '{"rules":[{"tool":3},{"tool":"Bash","prefix":"ls"}]}');
    expect(new PermissionStore(talk).rules).toEqual([{ tool: 'Bash', prefix: 'ls' }]);
  });
});

describe('predictWrite', () => {
  it('applies Edit, replace_all, MultiEdit and Write', () => {
    expect(predictWrite('Edit', { old_string: 'a', new_string: 'b' }, 'aXa')).toBe('bXa');
    expect(predictWrite('Edit', { old_string: 'a', new_string: 'b', replace_all: true }, 'aXa')).toBe('bXb');
    expect(predictWrite('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'X', new_string: 'Y' }] }, 'aXa')).toBe('bYa');
    expect(predictWrite('Write', { content: 'z' }, null)).toBe('z');
    expect(predictWrite('Edit', { old_string: 'a', new_string: 'b' }, null)).toBeNull();
    expect(predictWrite('NotebookEdit', {}, 'x')).toBeNull();
  });
});
