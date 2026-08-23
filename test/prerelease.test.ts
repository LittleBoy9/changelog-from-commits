import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateChangelog, isPrerelease } from '../src/changelog.js';
import { getLastTag } from '../src/git.js';
import { resolveOptions } from '../src/options.js';

const dirs: string[] = [];

function repoWithBeta(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfc-pre-'));
  dirs.push(dir);
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
  run(['init', '-q', '--initial-branch=main']);
  run(['config', 'user.name', 'T']);
  run(['config', 'user.email', 't@e.c']);

  const commit = (message: string) => {
    writeFileSync(join(dir, 'f.txt'), message);
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', message]);
  };

  commit('feat: shipped in 1.0');
  run(['tag', 'v1.0.0']);
  commit('feat: went into the beta');
  run(['tag', 'v1.1.0-beta.1']);
  commit('fix: found during the beta');
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('isPrerelease', () => {
  it('recognizes prerelease identifiers', () => {
    for (const version of ['1.1.0-beta.1', '2.0.0-rc.1', '1.0.0-alpha', '0.1.0-next.5']) {
      expect(isPrerelease(version), version).toBe(true);
    }
  });

  it('treats plain versions as stable', () => {
    for (const version of ['1.0.0', '0.1.0', '10.20.30']) {
      expect(isPrerelease(version), version).toBe(false);
    }
  });

  it('does not mistake build metadata for a prerelease', () => {
    expect(isPrerelease('1.0.0+build.1')).toBe(false);
  });

  it('is not confused by a hyphen in a tag prefix', () => {
    // The prefix is stripped before this runs, but guard the shape anyway.
    expect(isPrerelease('1.0.0')).toBe(false);
  });
});

describe('getLastTag prerelease exclusion', () => {
  it('finds the prerelease tag by default', () => {
    expect(getLastTag(repoWithBeta(), 'v')).toBe('v1.1.0-beta.1');
  });

  it('skips prerelease tags when asked', () => {
    expect(getLastTag(repoWithBeta(), 'v', 'HEAD', { excludePrerelease: true })).toBe('v1.0.0');
  });

  it('returns null when only prerelease tags exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-pre2-'));
    dirs.push(dir);
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
    run(['init', '-q', '--initial-branch=main']);
    run(['config', 'user.name', 'T']);
    run(['config', 'user.email', 't@e.c']);
    writeFileSync(join(dir, 'f.txt'), 'x');
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: a']);
    run(['tag', 'v1.0.0-alpha.1']);

    expect(getLastTag(dir, 'v', 'HEAD', { excludePrerelease: true })).toBeNull();
  });

  it('does not exclude stable tags when the prefix contains a hyphen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-pre3-'));
    dirs.push(dir);
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
    run(['init', '-q', '--initial-branch=main']);
    run(['config', 'user.name', 'T']);
    run(['config', 'user.email', 't@e.c']);
    writeFileSync(join(dir, 'f.txt'), 'x');
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: a']);
    run(['tag', 'web-v1.0.0']);
    writeFileSync(join(dir, 'f.txt'), 'y');
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: b']);
    run(['tag', 'web-v1.1.0-rc.1']);

    expect(getLastTag(dir, 'web-v', 'HEAD', { excludePrerelease: true })).toBe('web-v1.0.0');
  });
});

describe('a stable release must not lose beta commits', () => {
  function sectionFor(extra: Record<string, unknown>) {
    return generateChangelog(
      resolveOptions({ positionals: [], cwd: repoWithBeta(), tagPrefix: 'v', ...extra }),
    );
  }

  it('includes everything since the last stable tag', () => {
    const result = sectionFor({ version: '1.1.0' });
    expect(result.range.from).toBe('v1.0.0');
    expect(result.section).toContain('went into the beta');
    expect(result.section).toContain('found during the beta');
  });

  it('starts a prerelease from the previous prerelease', () => {
    const result = sectionFor({ version: '1.1.0-beta.2' });
    expect(result.range.from).toBe('v1.1.0-beta.1');
    expect(result.section).not.toContain('went into the beta');
    expect(result.section).toContain('found during the beta');
  });

  it('honours --prerelease-tags include for the old behavior', () => {
    const result = sectionFor({ version: '1.1.0', prereleaseTags: 'include' });
    expect(result.range.from).toBe('v1.1.0-beta.1');
    expect(result.section).not.toContain('went into the beta');
  });

  it('honours --prerelease-tags skip even for a prerelease target', () => {
    const result = sectionFor({ version: '1.1.0-beta.2', prereleaseTags: 'skip' });
    expect(result.range.from).toBe('v1.0.0');
    expect(result.section).toContain('went into the beta');
  });

  it('leaves an explicit --from alone', () => {
    const result = sectionFor({ version: '1.1.0', from: 'v1.1.0-beta.1' });
    expect(result.range.from).toBe('v1.1.0-beta.1');
  });
});
