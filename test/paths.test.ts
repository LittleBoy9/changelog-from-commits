import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateChangelog } from '../src/changelog.js';
import { resolveOptions } from '../src/options.js';

let repo: string;

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo });
}

function commitIn(dir: string, message: string): void {
  mkdirSync(join(repo, dir), { recursive: true });
  writeFileSync(join(repo, dir, 'f.txt'), message + Math.random());
  git(['add', '.']);
  git(['commit', '-q', '--no-gpg-sign', '-m', message]);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'cfc-mono-'));
  git(['init', '-q', '--initial-branch=main']);
  git(['config', 'user.name', 'T']);
  git(['config', 'user.email', 't@e.c']);
  git(['remote', 'add', 'origin', 'git@github.com:acme/mono.git']);

  commitIn('packages/web', 'feat(web): initial web app');
  git(['tag', 'web-v1.0.0']);
  commitIn('packages/api', 'feat(api): initial api');
  git(['tag', 'api-v1.0.0']);

  commitIn('packages/web', 'feat(web): add dark mode');
  commitIn('packages/api', 'feat(api): add rate limiting');
  commitIn('packages/api', 'fix(api): correct a 500');
  commitIn('docs', 'docs: update the readme');
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function generate(extra: Record<string, unknown>) {
  return generateChangelog(resolveOptions({ positionals: [], cwd: repo, ...extra }));
}

describe('--path filtering', () => {
  it('includes everything when no path is given', () => {
    const result = generate({ from: null, tagPrefix: 'zzz-' });
    expect(result.commits).toHaveLength(6);
  });

  it('restricts commits to one package', () => {
    const result = generate({ paths: ['packages/api'], tagPrefix: 'api-v', version: '1.1.0' });
    expect(result.section).toContain('add rate limiting');
    expect(result.section).toContain('correct a 500');
    expect(result.section).not.toContain('dark mode');
    expect(result.section).not.toContain('update the readme');
  });

  it('scopes the tag range and the paths independently', () => {
    const result = generate({ paths: ['packages/web'], tagPrefix: 'web-v', version: '1.1.0' });
    expect(result.range.from).toBe('web-v1.0.0');
    expect(result.section).toContain('dark mode');
    expect(result.section).not.toContain('rate limiting');
  });

  it('accepts several paths at once', () => {
    const result = generate({ paths: ['packages/web', 'docs'], from: null, tagPrefix: 'zzz-' });
    const text = result.section;
    expect(text).toContain('dark mode');
    expect(text).toContain('update the readme');
    expect(text).not.toContain('rate limiting');
  });

  it('reports no notable changes for a path with nothing in range', () => {
    const result = generate({ paths: ['packages/nothing-here'], from: null, tagPrefix: 'zzz-' });
    expect(result.section).toContain('_No notable changes._');
  });

  it('does not mistake a path for a git ref', () => {
    // A directory named like a ref must still be treated as a path.
    expect(() => generate({ paths: ['main'], from: null, tagPrefix: 'zzz-' })).not.toThrow();
  });
});

describe('revert pairing against a real repository', () => {
  it('cancels a feature reverted with git revert in the same range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-rev-'));
    try {
      const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
      run(['init', '-q', '--initial-branch=main']);
      run(['config', 'user.name', 'T']);
      run(['config', 'user.email', 't@e.c']);

      writeFileSync(join(dir, 'a.txt'), 'base');
      run(['add', '.']);
      run(['commit', '-q', '--no-gpg-sign', '-m', 'chore: base']);
      run(['tag', 'v1.0.0']);

      writeFileSync(join(dir, 'b.txt'), 'feature');
      run(['add', '.']);
      run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: a doomed feature']);

      writeFileSync(join(dir, 'c.txt'), 'kept');
      run(['add', '.']);
      run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: a surviving feature']);

      // git revert writes "This reverts commit <sha>." itself.
      run(['revert', '--no-edit', '--no-gpg-sign', 'HEAD~1']);

      const result = generateChangelog(
        resolveOptions({ positionals: [], cwd: dir, version: '1.1.0' }),
      );
      expect(result.section).not.toContain('doomed');
      expect(result.section).toContain('a surviving feature');
      expect(result.revertedPairs).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a revert whose original predates the range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-rev2-'));
    try {
      const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
      run(['init', '-q', '--initial-branch=main']);
      run(['config', 'user.name', 'T']);
      run(['config', 'user.email', 't@e.c']);

      writeFileSync(join(dir, 'a.txt'), 'x');
      run(['add', '.']);
      run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: shipped last release']);
      run(['tag', 'v1.0.0']);
      run(['revert', '--no-edit', '--no-gpg-sign', 'HEAD']);

      const result = generateChangelog(
        resolveOptions({ positionals: [], cwd: dir, version: '1.0.1' }),
      );
      expect(result.revertedPairs).toEqual([]);
      expect(result.section).toContain('### Reverts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
