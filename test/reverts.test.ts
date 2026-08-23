import { describe, expect, it } from 'vitest';
import { parseCommit } from '../src/parser.js';
import { applyReverts, groupCommits } from '../src/render.js';
import type { ParsedCommit, RawCommit } from '../src/types.js';

function make(subject: string, body = '', hash = 'a'.repeat(40)): ParsedCommit {
  return parseCommit({
    hash,
    shortHash: hash.slice(0, 7),
    authorName: 'T',
    authorEmail: 't@e.c',
    date: '2026-08-21T10:00:00Z',
    subject,
    body,
    isMerge: false,
  } satisfies RawCommit);
}

const FEAT_HASH = '1'.repeat(40);
const FIX_HASH = '2'.repeat(40);

describe('parsing reverts', () => {
  it('reads a conventional revert subject', () => {
    expect(make('revert: feat: add globs').revertOf).toEqual({
      hash: null,
      subject: 'feat: add globs',
    });
  });

  it('reads git\'s own Revert "..." subject', () => {
    expect(make('Revert "feat: add globs"').revertOf).toEqual({
      hash: null,
      subject: 'feat: add globs',
    });
  });

  it('reads the reverted hash from the body', () => {
    const commit = make('revert: feat: add globs', `This reverts commit ${FEAT_HASH}.`);
    expect(commit.revertOf?.hash).toBe(FEAT_HASH);
    expect(commit.revertOf?.subject).toBe('feat: add globs');
  });

  it('reads a hash even from a hand-written subject', () => {
    expect(make('chore: undo that', `This reverts commit ${FEAT_HASH}.`).revertOf?.hash).toBe(
      FEAT_HASH,
    );
  });

  it('leaves revertOf null for ordinary commits', () => {
    expect(make('feat: add globs').revertOf).toBeNull();
    expect(make('fix: revert is a word in this sentence').revertOf).toBeNull();
  });
});

describe('applyReverts', () => {
  it('removes both sides when matched by hash', () => {
    const feat = make('feat: add globs', '', FEAT_HASH);
    const revert = make('revert: feat: add globs', `This reverts commit ${FEAT_HASH}.`, FIX_HASH);

    const result = applyReverts([revert, feat]);
    expect(result.commits).toEqual([]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]!.reverted).toBe(feat);
  });

  it('matches an abbreviated hash in the body', () => {
    const feat = make('feat: add globs', '', FEAT_HASH);
    const revert = make('revert: x', `This reverts commit ${FEAT_HASH.slice(0, 8)}.`, FIX_HASH);
    expect(applyReverts([revert, feat]).commits).toEqual([]);
  });

  it('falls back to subject matching when there is no hash', () => {
    const feat = make('feat: add globs', '', FEAT_HASH);
    const revert = make('revert: feat: add globs', '', FIX_HASH);
    expect(applyReverts([revert, feat]).commits).toEqual([]);
  });

  it('keeps the revert when the original is outside the range', () => {
    const revert = make('revert: feat: shipped last release', '', FIX_HASH);
    const other = make('fix: unrelated', '', FEAT_HASH);

    const result = applyReverts([revert, other]);
    expect(result.commits).toEqual([revert, other]);
    expect(result.pairs).toEqual([]);
  });

  it('does not match a different commit with the same subject text', () => {
    const feat = make('feat: add globs', '', FEAT_HASH);
    // Hash is present but points elsewhere, so the subject must not rescue it.
    const revert = make('revert: feat: add globs', `This reverts commit ${'9'.repeat(40)}.`, FIX_HASH);

    const result = applyReverts([revert, feat]);
    expect(result.commits).toEqual([revert, feat]);
  });

  it('pairs each revert with a distinct commit', () => {
    const a = make('feat: thing', '', '1'.repeat(40));
    const b = make('feat: thing', '', '2'.repeat(40));
    const revertA = make('revert: feat: thing', `This reverts commit ${'1'.repeat(40)}.`, '3'.repeat(40));
    const revertB = make('revert: feat: thing', `This reverts commit ${'2'.repeat(40)}.`, '4'.repeat(40));

    expect(applyReverts([revertA, revertB, a, b]).pairs).toHaveLength(2);
  });

  it('is a no-op when there are no reverts', () => {
    const commits = [make('feat: a'), make('fix: b')];
    const result = applyReverts(commits);
    expect(result.commits).toBe(commits);
    expect(result.pairs).toEqual([]);
  });

  it('keeps a reverted commit out of its type section', () => {
    const feat = make('feat: add globs', '', FEAT_HASH);
    const revert = make('revert: feat: add globs', `This reverts commit ${FEAT_HASH}.`, FIX_HASH);

    expect(groupCommits([revert, feat])).not.toEqual([]);
    expect(groupCommits(applyReverts([revert, feat]).commits)).toEqual([]);
  });
});

describe('git-style reverts reach the Reverts section', () => {
  it('groups a Revert "..." commit even though it is not conventional', () => {
    const revert = make('Revert "feat: shipped last release"', 'This reverts commit 9999999.');
    expect(revert.isConventional).toBe(false);

    const groups = groupCommits([revert]);
    expect(groups.map((g) => g.title)).toEqual(['Reverts']);
    expect(groups[0]!.commits[0]!.description).toBe('feat: shipped last release');
  });

  it('does not need --include-all to surface it', () => {
    expect(groupCommits([make('Revert "feat: x"')], { includeAll: false })).toHaveLength(1);
  });

  it('still sends genuinely unparseable commits to Other Changes', () => {
    const groups = groupCommits([make('wip')], { includeAll: true });
    expect(groups.map((g) => g.title)).toEqual(['Other Changes']);
  });

  it('respects a config that hides the revert type', () => {
    const groups = groupCommits([make('Revert "feat: x"')], {
      types: [{ type: 'revert', title: 'Reverts', hidden: true }],
    });
    expect(groups).toEqual([]);
  });
})
