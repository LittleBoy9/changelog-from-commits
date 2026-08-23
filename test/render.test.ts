import { describe, expect, it } from 'vitest';
import { buildLinks } from '../src/git.js';
import { parseCommit } from '../src/parser.js';
import { collectBreaking, DEFAULT_TYPES, groupCommits, renderRelease } from '../src/render.js';
import type { ChangelogContext, ParsedCommit, RawCommit } from '../src/types.js';

let counter = 0;

function commit(subject: string, body = '', overrides: Partial<RawCommit> = {}): ParsedCommit {
  counter += 1;
  const short = counter.toString(16).padStart(7, '0');
  return parseCommit({
    hash: short.repeat(6).slice(0, 40),
    shortHash: short,
    authorName: 'Test',
    authorEmail: 'test@example.com',
    date: '2026-08-21T10:00:00Z',
    subject,
    body,
    isMerge: false,
    ...overrides,
  });
}

const links = buildLinks('https://github.com/acme/widgets');

function context(commits: ParsedCommit[], overrides: Partial<ChangelogContext> = {}) {
  return {
    version: '1.0.0',
    date: '2026-08-21',
    groups: groupCommits(commits),
    breaking: collectBreaking(commits),
    links,
    previousTag: null,
    currentTag: null,
    ...overrides,
  } satisfies ChangelogContext;
}

describe('groupCommits', () => {
  it('buckets by type in the configured order', () => {
    const groups = groupCommits([
      commit('docs: a'),
      commit('fix: b'),
      commit('feat: c'),
      commit('perf: d'),
    ]);
    expect(groups.map((g) => g.title)).toEqual([
      'Features',
      'Bug Fixes',
      'Performance Improvements',
      'Documentation',
    ]);
  });

  it('preserves commit order inside a group', () => {
    const groups = groupCommits([commit('feat: first'), commit('feat: second')]);
    expect(groups[0]!.commits.map((c) => c.description)).toEqual(['first', 'second']);
  });

  it('drops merge commits', () => {
    const groups = groupCommits([
      commit('feat: real'),
      commit('Merge pull request #1 from x/y', '', { isMerge: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commits).toHaveLength(1);
  });

  it('hides chore and style by default', () => {
    expect(groupCommits([commit('chore: a'), commit('style: b')])).toEqual([]);
  });

  it('drops non-conventional commits by default', () => {
    expect(groupCommits([commit('wip')])).toEqual([]);
  });

  it('keeps non-conventional commits under includeAll', () => {
    const groups = groupCommits([commit('feat: a'), commit('wip')], { includeAll: true });
    expect(groups.map((g) => g.title)).toEqual(['Features', 'Other Changes']);
  });

  it('puts Other Changes last', () => {
    const groups = groupCommits([commit('wip'), commit('feat: a'), commit('fix: b')], {
      includeAll: true,
    });
    expect(groups.at(-1)!.title).toBe('Other Changes');
  });

  it('gives unrecognized conventional types their own section', () => {
    const groups = groupCommits([commit('feat: a'), commit('deps-update: b')]);
    expect(groups.map((g) => g.title)).toEqual(['Features', 'Deps Update']);
  });

  it('honours a custom type table', () => {
    const groups = groupCommits([commit('feat: a'), commit('chore: b')], {
      types: [
        { type: 'chore', title: 'Housekeeping' },
        { type: 'feat', title: 'New Stuff' },
      ],
    });
    expect(groups.map((g) => g.title)).toEqual(['Housekeeping', 'New Stuff']);
  });

  it('honours a custom Other Changes title', () => {
    const groups = groupCommits([commit('nope')], { includeAll: true, otherTitle: 'Misc' });
    expect(groups[0]!.title).toBe('Misc');
  });

  it('exposes every default type with a title', () => {
    for (const entry of DEFAULT_TYPES) {
      expect(entry.title, entry.type).toBeTruthy();
    }
  });
});

describe('renderRelease', () => {
  it('renders a heading with the date', () => {
    const output = renderRelease(context([commit('feat: a')]));
    expect(output.split('\n')[0]).toBe('## 1.0.0 (2026-08-21)');
  });

  it('links the heading to a compare view when both tags are known', () => {
    const output = renderRelease(
      context([commit('feat: a')], { previousTag: 'v0.9.0', currentTag: 'v1.0.0' }),
    );
    expect(output.split('\n')[0]).toBe(
      '## [1.0.0](https://github.com/acme/widgets/compare/v0.9.0...v1.0.0) (2026-08-21)',
    );
  });

  it('does not link the heading without a previous tag', () => {
    const output = renderRelease(context([commit('feat: a')], { currentTag: 'v1.0.0' }));
    expect(output.split('\n')[0]).toBe('## 1.0.0 (2026-08-21)');
  });

  it('renders scopes in bold', () => {
    expect(renderRelease(context([commit('feat(auth): a')]))).toContain('* **auth:** a');
  });

  it('omits the scope prefix when there is none', () => {
    expect(renderRelease(context([commit('feat: a')]))).toMatch(/^\* a /m);
  });

  it('links to the PR when known, otherwise the commit', () => {
    const output = renderRelease(context([commit('feat: with pr (#42)'), commit('feat: no pr')]));
    expect(output).toContain('([#42](https://github.com/acme/widgets/pull/42))');
    expect(output).toMatch(/\(\[[0-9a-f]+\]\(https:\/\/github\.com\/acme\/widgets\/commit\//);
  });

  it('renders a prominent breaking changes section first', () => {
    const output = renderRelease(context([commit('fix: b'), commit('feat!: a')]));
    const breakingAt = output.indexOf('### ⚠ BREAKING CHANGES');
    const featuresAt = output.indexOf('### Features');
    expect(breakingAt).toBeGreaterThan(-1);
    expect(breakingAt).toBeLessThan(featuresAt);
  });

  it('lists a breaking commit in both the breaking section and its type section', () => {
    const output = renderRelease(context([commit('feat(api)!: drop v1')]));
    expect(output.match(/drop v1/g)).toHaveLength(2);
  });

  it('uses the footer text in the breaking section and the subject in the type section', () => {
    const output = renderRelease(
      context([commit('feat(api)!: rework auth', 'BREAKING CHANGE: tokens replace cookies')]),
    );
    expect(output).toContain('* **api:** tokens replace cookies');
    expect(output).toContain('* **api:** rework auth');
  });

  it('omits the breaking section when nothing is breaking', () => {
    expect(renderRelease(context([commit('feat: a')]))).not.toContain('BREAKING');
  });

  it('falls back to plain text when there are no links', () => {
    const output = renderRelease(context([commit('feat: a (#7)'), commit('fix: b')], { links: null }));
    expect(output).toContain('* a (#7)');
    expect(output).toMatch(/\* b \([0-9a-f]+\)$/m);
  });

  it('drops links when linkReferences is false', () => {
    const output = renderRelease(context([commit('feat: a (#7)')]), { linkReferences: false });
    expect(output).not.toContain('https://');
    expect(output).toContain('* a (#7)');
  });

  it('appends closes references from issue footers', () => {
    const output = renderRelease(context([commit('fix: a thing', 'Closes #12')]));
    expect(output).toContain(', closes [#12](https://github.com/acme/widgets/issues/12)');
  });

  it('lists several references separated by a space', () => {
    const output = renderRelease(context([commit('fix: a thing', 'Closes #12, #13')]));
    expect(output).toContain(', closes [#12](https://github.com/acme/widgets/issues/12) [#13](https://github.com/acme/widgets/issues/13)');
  });

  it('does not repeat the PR number as a reference', () => {
    const output = renderRelease(context([commit('fix: a thing (#42)', 'Closes #42')]));
    expect(output).toContain('([#42](https://github.com/acme/widgets/pull/42))');
    expect(output).not.toContain('closes');
  });

  it('still lists other issues alongside a PR', () => {
    const output = renderRelease(context([commit('fix: a thing (#42)', 'Closes #42, #7')]));
    expect(output).toContain('closes [#7]');
    expect(output).not.toContain('closes [#42]');
  });

  it('renders plain references when links are off', () => {
    const output = renderRelease(context([commit('fix: a thing', 'Closes #12')]), {
      linkReferences: false,
    });
    expect(output).toContain(', closes #12');
  });

  it('omits references when showReferences is false', () => {
    const output = renderRelease(context([commit('fix: a thing', 'Closes #12')]), {
      showReferences: false,
    });
    expect(output).not.toContain('closes');
  });

  it('leaves the breaking section free of reference noise', () => {
    const output = renderRelease(context([commit('feat!: rework', 'Closes #12')]));
    const breaking = output.slice(output.indexOf('BREAKING'), output.indexOf('### Features'));
    expect(breaking).not.toContain('closes');
  });

  it('says so when a range has no notable changes', () => {
    expect(renderRelease(context([commit('chore: bump')]))).toContain('_No notable changes._');
  });

  it('ends with exactly one trailing newline', () => {
    const output = renderRelease(context([commit('feat: a')]));
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });

  it('separates every heading from its entries with a blank line', () => {
    const output = renderRelease(context([commit('feat!: a'), commit('fix: b')]));
    for (const [index, line] of output.split('\n').entries()) {
      if (line.startsWith('#')) {
        expect(output.split('\n')[index + 1], line).toBe('');
      }
    }
  });
});
