import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLinks, parseLog } from '../src/git.js';
import { parseCommits } from '../src/parser.js';
import { collectBreaking, groupCommits, renderRelease } from '../src/render.js';

const fixtures = join(__dirname, 'fixtures');
const sampleLog = readFileSync(join(fixtures, 'sample-log.txt'), 'utf8');
const commits = parseCommits(parseLog(sampleLog));

describe('sample-log.txt fixture', () => {
  it('parses every record', () => {
    expect(commits).toHaveLength(11);
  });

  it('reads git metadata off each record', () => {
    const first = commits[0]!;
    expect(first.shortHash).toBe('9f1c7a2');
    expect(first.hash).toHaveLength(40);
    expect(first.authorName).toBe('Ada Lovelace');
    expect(first.date).toBe('2026-08-21T10:04:11+01:00');
  });

  it('identifies the merge commit by parent count', () => {
    expect(commits.filter((c) => c.isMerge).map((c) => c.shortHash)).toEqual(['d1f6b93']);
  });

  it('keeps multi-line bodies intact', () => {
    expect(commits[0]!.body).toContain('Co-authored-by: Grace Hopper');
  });

  it('finds both breaking changes', () => {
    expect(collectBreaking(commits).map((c) => c.shortHash)).toEqual(['9f1c7a2', '5d0a2f8']);
  });

  it('finds the one non-conventional commit', () => {
    const odd = commits.filter((c) => !c.isConventional && !c.isMerge);
    expect(odd.map((c) => c.subject)).toEqual(['wip']);
  });

  it('handles an empty body without crashing', () => {
    const empty = commits.find((c) => c.shortHash === 'a7c4e18')!;
    expect(empty.body).toBe('');
    expect(empty.references).toEqual([]);
  });
});

describe('rendered output matches expected-changelog.md', () => {
  it('renders a linked release for a tagged range', () => {
    const output = renderRelease({
      version: '1.4.0',
      date: '2026-08-21',
      groups: groupCommits(commits),
      breaking: collectBreaking(commits),
      links: buildLinks('https://github.com/example/changelog-from-commits'),
      previousTag: 'v1.3.0',
      currentTag: 'v1.4.0',
    });

    expect(output).toBe(readFileSync(join(fixtures, 'expected-changelog.md'), 'utf8'));
  });

  it('renders an unlinked, include-all release', () => {
    const output = renderRelease({
      version: 'Unreleased',
      date: '2026-08-21',
      groups: groupCommits(commits, { includeAll: true }),
      breaking: collectBreaking(commits),
      links: null,
      previousTag: null,
      currentTag: null,
    });

    expect(output).toBe(readFileSync(join(fixtures, 'expected-changelog-include-all.md'), 'utf8'));
  });
});
