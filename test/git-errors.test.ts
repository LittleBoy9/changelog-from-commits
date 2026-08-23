import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateChangelog } from '../src/changelog.js';
import {
  detectRepoUrl,
  getLastTag,
  getRemoteUrl,
  getRepoRoot,
  git,
  GitError,
  hasCommits,
  isGitRepo,
  normalizeRemoteUrl,
  resolveRef,
} from '../src/git.js';
import { resolveOptions } from '../src/options.js';

const dirs: string[] = [];

function tempRepo(init = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfc-err-'));
  dirs.push(dir);
  if (init) {
    execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
  }
  return dir;
}

function commit(dir: string, message: string): void {
  writeFileSync(join(dir, 'f.txt'), message);
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', message], { cwd: dir });
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('repository detection', () => {
  it('reports a non-repository', () => {
    expect(isGitRepo(tempRepo(false))).toBe(false);
  });

  it('reports a repository', () => {
    expect(isGitRepo(tempRepo())).toBe(true);
  });

  it('finds the repository root from a subdirectory', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    // macOS temp dirs are symlinked via /private, so compare the basenames.
    expect(getRepoRoot(dir).endsWith(dir.split('/').pop()!)).toBe(true);
  });

  it('reports an empty repository as having no commits', () => {
    expect(hasCommits(tempRepo())).toBe(false);
  });

  it('errors clearly on a repository with no commits', () => {
    expect(() => generateChangelog(resolveOptions({ positionals: [], cwd: tempRepo() }))).toThrow(
      /no commits yet/,
    );
  });
});

describe('git() error handling', () => {
  it('throws GitError with git stderr for a failing command', () => {
    const dir = tempRepo();
    try {
      git(['rev-parse', '--verify', 'nope'], dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GitError);
      expect((error as Error).message).toBeTruthy();
    }
  });

  it('resolveRef returns null instead of throwing', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    expect(resolveRef(dir, 'no-such-ref')).toBeNull();
    expect(resolveRef(dir, 'HEAD')).toHaveLength(40);
  });
});

describe('remotes', () => {
  it('returns null when there is no origin', () => {
    const dir = tempRepo();
    expect(getRemoteUrl(dir)).toBeNull();
    expect(detectRepoUrl(dir)).toBeNull();
  });

  it('reads and normalizes a configured origin', () => {
    const dir = tempRepo();
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: dir });
    expect(detectRepoUrl(dir)).toBe('https://github.com/acme/w');
  });

  it('returns null for a remote that is neither scp-style nor a URL', () => {
    expect(normalizeRemoteUrl('::::')).toBeNull();
  });

  it('renders without links when no remote is configured', () => {
    const dir = tempRepo();
    commit(dir, 'feat: standalone');
    const result = generateChangelog(resolveOptions({ positionals: [], cwd: dir, version: '1.0.0' }));
    expect(result.context.links).toBeNull();
    expect(result.section).not.toContain('https://');
    expect(result.section).toMatch(/\* standalone \([0-9a-f]+\)/);
  });
});

describe('tag prefix resolution', () => {
  it('finds a prefixed tag', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    commit(dir, 'feat: b');
    expect(getLastTag(dir, 'v')).toBe('v1.0.0');
  });

  it('picks the right package tag in a monorepo', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    execFileSync('git', ['tag', 'api-v2.0.0'], { cwd: dir });
    commit(dir, 'feat: b');
    execFileSync('git', ['tag', 'web-v1.0.0'], { cwd: dir });
    commit(dir, 'feat: c');

    expect(getLastTag(dir, 'web-v')).toBe('web-v1.0.0');
    expect(getLastTag(dir, 'api-v')).toBe('api-v2.0.0');
  });

  it('returns null when no tag matches the prefix', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    expect(getLastTag(dir, 'release-')).toBeNull();
  });

  it('returns null in a repository with no tags', () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    expect(getLastTag(dir)).toBeNull();
  });

  it('finds the nearest ancestor tag, not the newest tag in the repo', () => {
    const dir = tempRepo();
    commit(dir, 'feat: base');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: dir });
    commit(dir, 'feat: on branch');
    // A newer tag exists on main, but it is not an ancestor of this branch.
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: dir });
    commit(dir, 'feat: on main');
    execFileSync('git', ['tag', 'v2.0.0'], { cwd: dir });
    execFileSync('git', ['checkout', '-q', 'feature'], { cwd: dir });

    expect(getLastTag(dir, 'v')).toBe('v1.0.0');
  });
});

describe('version resolution from package.json', () => {
  it('walks up to a parent package.json', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '3.1.4' }));
    commit(dir, 'feat: a');
    const nested = join(dir, 'packages', 'app');
    execFileSync('mkdir', ['-p', nested]);
    expect(generateChangelog(resolveOptions({ positionals: [], cwd: nested })).context.version).toBe(
      '3.1.4',
    );
  });

  it('ignores a malformed package.json and falls back to Unreleased', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'package.json'), '{ broken');
    commit(dir, 'feat: a');
    expect(generateChangelog(resolveOptions({ positionals: [], cwd: dir })).context.version).toBe(
      'Unreleased',
    );
  });

  it('ignores a package.json with no version field', () => {
    const dir = tempRepo();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
    commit(dir, 'feat: a');
    expect(generateChangelog(resolveOptions({ positionals: [], cwd: dir })).context.version).toBe(
      'Unreleased',
    );
  });
});
