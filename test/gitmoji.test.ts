import { describe, expect, it } from 'vitest';
import { parseCommit } from '../src/parser.js';
import { DEFAULT_ALIASES, groupCommits, renderRelease } from '../src/render.js';
import type { ParsedCommit, RawCommit } from '../src/types.js';

function make(subject: string, body = ''): ParsedCommit {
  return parseCommit({
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    authorName: 'T',
    authorEmail: 't@e.c',
    date: '2026-08-21T10:00:00Z',
    subject,
    body,
    isMerge: false,
  } satisfies RawCommit);
}

function render(commits: ParsedCommit[], options = {}) {
  return renderRelease(
    {
      version: '1.0.0',
      date: '2026-08-21',
      groups: groupCommits(commits),
      breaking: commits.filter((c) => c.breaking),
      links: null,
      previousTag: null,
      currentTag: null,
    },
    options,
  );
}

describe('gitmoji prefixes', () => {
  it('parses a unicode emoji prefix', () => {
    const commit = make('✨ feat(auth): add OAuth');
    expect(commit.isConventional).toBe(true);
    expect(commit.type).toBe('feat');
    expect(commit.scope).toBe('auth');
    expect(commit.description).toBe('add OAuth');
    expect(commit.emoji).toBe('✨');
  });

  it('parses a :shortcode: prefix', () => {
    const commit = make(':sparkles: feat: add OAuth');
    expect(commit.isConventional).toBe(true);
    expect(commit.type).toBe('feat');
    expect(commit.emoji).toBe(':sparkles:');
  });

  it('handles emoji with a variation selector', () => {
    const commit = make('⚡️ perf: speed things up');
    expect(commit.type).toBe('perf');
    expect(commit.description).toBe('speed things up');
  });

  it('handles a multi-codepoint emoji', () => {
    const commit = make('👨‍💻 feat: add tooling');
    expect(commit.type).toBe('feat');
    expect(commit.description).toBe('add tooling');
  });

  it('carries breaking markers through the prefix', () => {
    const commit = make('🔥 feat(api)!: remove legacy endpoint');
    expect(commit.breaking).toBe(true);
    expect(commit.scope).toBe('api');
  });

  it('still finds a trailing PR number', () => {
    const commit = make('✨ feat: add thing (#42)');
    expect(commit.pr).toBe(42);
    expect(commit.description).toBe('add thing');
  });

  it('leaves emoji inside the description alone', () => {
    const commit = make('feat: add ✨ sparkle');
    expect(commit.emoji).toBeNull();
    expect(commit.description).toBe('add ✨ sparkle');
  });

  it('sets emoji to null for ordinary commits', () => {
    expect(make('feat: plain').emoji).toBeNull();
  });

  it('does not rescue a genuinely non-conventional subject', () => {
    const commit = make('✨ just some work');
    expect(commit.isConventional).toBe(false);
    expect(commit.emoji).toBe('✨');
  });

  it('strips the emoji from rendered output by default', () => {
    expect(render([make('✨ feat: add OAuth')])).toContain('* add OAuth');
  });

  it('keeps the emoji when asked', () => {
    expect(render([make('✨ feat: add OAuth')], { keepEmoji: true })).toContain('* ✨ add OAuth');
  });

  it('places a kept emoji before the scope', () => {
    const output = render([make('✨ feat(auth): add OAuth')], { keepEmoji: true });
    expect(output).toContain('* ✨ **auth:** add OAuth');
  });

  it('renders a whole gitmoji repo instead of nothing', () => {
    const commits = [
      make('✨ feat(auth): add OAuth'),
      make('🐛 fix(api): correct 500'),
      make(':memo: docs: update readme'),
    ];
    const output = render(commits);
    expect(output).not.toContain('_No notable changes._');
    expect(output).toContain('### Features');
    expect(output).toContain('### Bug Fixes');
    expect(output).toContain('### Documentation');
  });
});

describe('type aliases', () => {
  it('folds feature onto feat', () => {
    const groups = groupCommits([make('feature: a'), make('feat: b')]);
    expect(groups.map((g) => g.title)).toEqual(['Features']);
    expect(groups[0]!.commits).toHaveLength(2);
  });

  it('folds bugfix onto fix', () => {
    expect(groupCommits([make('bugfix: a')]).map((g) => g.title)).toEqual(['Bug Fixes']);
  });

  it('covers the common spellings', () => {
    for (const [alias, canonical] of Object.entries(DEFAULT_ALIASES)) {
      expect(canonical, alias).toBeTruthy();
      expect(alias, alias).not.toBe(canonical);
    }
  });

  it('leaves the parsed type as the author wrote it', () => {
    // Grouping folds the bucket; the commit still records the real spelling.
    const commit = make('feature: a');
    expect(commit.type).toBe('feature');
    expect(groupCommits([commit])[0]!.title).toBe('Features');
  });

  it('respects a hidden canonical type through an alias', () => {
    expect(groupCommits([make('chores: noise')])).toEqual([]);
  });

  it('accepts extra aliases from config', () => {
    const groups = groupCommits([make('enhancement: a')], {
      aliases: { enhancement: 'feat' },
    });
    expect(groups.map((g) => g.title)).toEqual(['Features']);
  });

  it('lets a config alias override a default', () => {
    const groups = groupCommits([make('feature: a')], { aliases: { feature: 'fix' } });
    expect(groups.map((g) => g.title)).toEqual(['Bug Fixes']);
  });

  it('still gives a genuinely unknown type its own section', () => {
    expect(groupCommits([make('deps: a')]).map((g) => g.title)).toEqual(['Deps']);
  });
});
