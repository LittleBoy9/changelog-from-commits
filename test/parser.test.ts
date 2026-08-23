import { describe, expect, it } from 'vitest';
import { parseCommit } from '../src/parser.js';
import type { RawCommit } from '../src/types.js';

function raw(subject: string, body = '', overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'a'.repeat(40),
    shortHash: 'aaaaaaa',
    authorName: 'Test',
    authorEmail: 'test@example.com',
    date: '2026-08-21T10:00:00Z',
    subject,
    body,
    isMerge: false,
    ...overrides,
  };
}

describe('header grammar', () => {
  it('parses type and description', () => {
    const commit = parseCommit(raw('feat: add a thing'));
    expect(commit.isConventional).toBe(true);
    expect(commit.type).toBe('feat');
    expect(commit.scope).toBeNull();
    expect(commit.description).toBe('add a thing');
    expect(commit.breaking).toBe(false);
  });

  it('parses a scope', () => {
    expect(parseCommit(raw('fix(parser): trim bodies')).scope).toBe('parser');
  });

  it('accepts multi-word and slashed scopes', () => {
    expect(parseCommit(raw('feat(api/v2): add endpoint')).scope).toBe('api/v2');
    expect(parseCommit(raw('feat(deps dev): bump')).scope).toBe('deps dev');
  });

  it('lowercases the type but preserves the description', () => {
    const commit = parseCommit(raw('FEAT: Add A Thing'));
    expect(commit.type).toBe('feat');
    expect(commit.description).toBe('Add A Thing');
  });

  it('requires whitespace after the colon', () => {
    expect(parseCommit(raw('feat:no-space')).isConventional).toBe(false);
  });

  it('tolerates extra whitespace after the colon', () => {
    expect(parseCommit(raw('feat:   padded')).description).toBe('padded');
  });

  it('marks non-conventional subjects', () => {
    for (const subject of ['wip', 'fixed stuff', 'Update README.md', 'feat', '']) {
      const commit = parseCommit(raw(subject));
      expect(commit.isConventional, subject).toBe(false);
      expect(commit.type, subject).toBeNull();
      expect(commit.description, subject).toBe(subject);
    }
  });

  it('does not treat a URL in the subject as a type', () => {
    expect(parseCommit(raw('see https://example.com for details')).isConventional).toBe(false);
  });
});

describe('breaking changes', () => {
  it('detects the ! marker without a scope', () => {
    const commit = parseCommit(raw('feat!: drop node 16'));
    expect(commit.breaking).toBe(true);
    expect(commit.breakingDescription).toBe('drop node 16');
  });

  it('detects the ! marker after a scope', () => {
    expect(parseCommit(raw('feat(api)!: drop v1')).breaking).toBe(true);
  });

  it('detects the BREAKING CHANGE footer', () => {
    const commit = parseCommit(raw('feat: new auth', 'BREAKING CHANGE: cookies are gone'));
    expect(commit.breaking).toBe(true);
    expect(commit.breakingDescription).toBe('cookies are gone');
  });

  it('detects the hyphenated BREAKING-CHANGE footer', () => {
    expect(parseCommit(raw('feat: x', 'BREAKING-CHANGE: y')).breaking).toBe(true);
  });

  it('ignores a lowercase breaking change token, per the spec', () => {
    expect(parseCommit(raw('feat: x', 'breaking change: y')).breaking).toBe(false);
  });

  it('joins a wrapped footer into one line', () => {
    const commit = parseCommit(
      raw('feat: x', 'BREAKING CHANGE: the first line\nwraps onto a second line'),
    );
    expect(commit.breakingDescription).toBe('the first line wraps onto a second line');
  });

  it('stops the footer at the next trailer', () => {
    const commit = parseCommit(
      raw('feat: x', 'BREAKING CHANGE: gone\n\nCloses #12\nCo-authored-by: A <a@b.c>'),
    );
    expect(commit.breakingDescription).toBe('gone');
  });

  it('prefers the footer text over the description', () => {
    const commit = parseCommit(raw('feat!: short', 'BREAKING CHANGE: the long explanation'));
    expect(commit.breakingDescription).toBe('the long explanation');
  });

  it('leaves breakingDescription null for non-breaking commits', () => {
    expect(parseCommit(raw('feat: x')).breakingDescription).toBeNull();
  });
});

describe('pull request and issue references', () => {
  it('extracts a trailing PR number and strips it from the description', () => {
    const commit = parseCommit(raw('feat: add thing (#42)'));
    expect(commit.pr).toBe(42);
    expect(commit.description).toBe('add thing');
  });

  it('leaves a parenthetical that is not a PR alone', () => {
    const commit = parseCommit(raw('feat: add thing (finally)'));
    expect(commit.pr).toBeNull();
    expect(commit.description).toBe('add thing (finally)');
  });

  it('only strips a PR suffix at the end of the subject', () => {
    const commit = parseCommit(raw('fix: revert (#12) because it broke things'));
    expect(commit.pr).toBeNull();
    expect(commit.description).toBe('revert (#12) because it broke things');
  });

  it('reads a PR number from a GitHub merge subject', () => {
    const commit = parseCommit(
      raw('Merge pull request #99 from user/branch', '', { isMerge: true }),
    );
    expect(commit.pr).toBe(99);
  });

  it('reads a merge request number from a GitLab merge body', () => {
    const commit = parseCommit(
      raw("Merge branch 'x' into 'main'", "Some description\n\nSee merge request group/proj!77", {
        isMerge: true,
      }),
    );
    expect(commit.pr).toBe(77);
  });

  it('collects issue references from footers', () => {
    const commit = parseCommit(raw('fix: x', 'Closes #1\nFixes #2, #3\nRefs: #2'));
    expect(commit.references).toEqual([1, 2, 3]);
  });

  it('returns no references when there are no footers', () => {
    expect(parseCommit(raw('fix: x', 'just prose about #5 in passing')).references).toEqual([]);
  });

  it('does not leak regex state between calls', () => {
    const first = parseCommit(raw('fix: a', 'Closes #1'));
    const second = parseCommit(raw('fix: b', 'Closes #2'));
    expect(first.references).toEqual([1]);
    expect(second.references).toEqual([2]);
  });
});

describe('raw fields', () => {
  it('passes through git metadata untouched', () => {
    const input = raw('feat: x', 'body', { shortHash: 'deadbee', authorName: 'Ada' });
    const commit = parseCommit(input);
    expect(commit.shortHash).toBe('deadbee');
    expect(commit.authorName).toBe('Ada');
    expect(commit.body).toBe('body');
  });
});
