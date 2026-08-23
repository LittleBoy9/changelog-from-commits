import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHANGELOG_HEADER, generateAll, stripTagPrefix } from '../src/changelog.js';
import { listTags } from '../src/git.js';
import { resolveOptions } from '../src/options.js';

const dirs: string[] = [];

function history(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfc-all-'));
  dirs.push(dir);
  const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
  run(['init', '-q', '--initial-branch=main']);
  run(['config', 'user.name', 'T']);
  run(['config', 'user.email', 't@e.c']);
  run(['remote', 'add', 'origin', 'git@github.com:acme/hist.git']);

  const commit = (message: string) => {
    writeFileSync(join(dir, 'f.txt'), message);
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', message]);
  };

  commit('feat: initial release');
  run(['tag', 'v1.0.0']);
  commit('fix(core): a 1.1 fix');
  commit('feat(api): a 1.1 feature (#7)');
  run(['tag', 'v1.1.0']);
  commit('feat!: breaking rework');
  run(['tag', 'v2.0.0']);
  commit('docs: an unreleased tweak');
  return dir;
}

function generate(dir: string, extra: Record<string, unknown> = {}) {
  return generateAll(resolveOptions({ positionals: [], cwd: dir, tagPrefix: 'v', ...extra }));
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('stripTagPrefix', () => {
  it('strips a matching prefix', () => {
    expect(stripTagPrefix('web-v1.2.0', 'web-v')).toBe('1.2.0');
    expect(stripTagPrefix('v1.2.0', 'v')).toBe('1.2.0');
  });

  it('leaves a tag without the prefix alone', () => {
    expect(stripTagPrefix('1.2.0', 'v')).toBe('1.2.0');
    expect(stripTagPrefix('v1.2.0', '')).toBe('v1.2.0');
  });
});

describe('listTags', () => {
  it('returns tags oldest first', () => {
    expect(listTags(history(), 'v')).toEqual(['v1.0.0', 'v1.1.0', 'v2.0.0']);
  });

  it('returns nothing for an unmatched prefix', () => {
    expect(listTags(history(), 'nope-')).toEqual([]);
  });
});

describe('generateAll', () => {
  it('renders every release, newest first', () => {
    const result = generate(history());
    expect(result.versions).toEqual(['Unreleased', '2.0.0', '1.1.0', '1.0.0']);
  });

  it('includes the oldest release, whose range starts at the first commit', () => {
    const result = generate(history());
    const oldest = result.sections.at(-1)!;
    expect(oldest).toContain('## 1.0.0');
    expect(oldest).toContain('initial release');
  });

  it('does not fabricate a compare link for the Unreleased section', () => {
    const document = generate(history()).document;
    expect(document).not.toContain('vUnreleased');
    expect(document).toContain('## Unreleased (');
  });

  it('links each tagged release to a compare view against its predecessor', () => {
    const document = generate(history()).document;
    expect(document).toContain('## [2.0.0](https://github.com/acme/hist/compare/v1.1.0...v2.0.0)');
    expect(document).toContain('## [1.1.0](https://github.com/acme/hist/compare/v1.0.0...v1.1.0)');
  });

  it('leaves the first release unlinked, having no predecessor', () => {
    expect(generate(history()).document).toMatch(/^## 1\.0\.0 \(/m);
  });

  it('orders releases newest first in the document', () => {
    const document = generate(history()).document;
    // Match headings only: a bare version string also occurs inside the compare
    // URL of the release above it.
    const headings = [...document.matchAll(/^## \[?([^\]\s(]+)/gm)].map((m) => m[1]);
    expect(headings).toEqual(['Unreleased', '2.0.0', '1.1.0', '1.0.0']);
  });

  it('writes the standard header once', () => {
    const document = generate(history()).document;
    expect(document.startsWith(CHANGELOG_HEADER)).toBe(true);
    expect(document.match(/# Changelog/g)).toHaveLength(1);
  });

  it('carries breaking changes into the right release', () => {
    const document = generate(history()).document;
    const twoAt = document.indexOf('## [2.0.0]');
    const oneOneAt = document.indexOf('## [1.1.0]');
    const breakingAt = document.indexOf('### ⚠ BREAKING CHANGES');
    expect(breakingAt).toBeGreaterThan(twoAt);
    expect(breakingAt).toBeLessThan(oneOneAt);
  });

  it('omits an Unreleased section when the newest tag is HEAD', () => {
    const dir = history();
    execFileSync('git', ['tag', 'v2.1.0'], { cwd: dir });
    expect(generate(dir).versions).not.toContain('Unreleased');
  });

  it('skips releases that contain nothing renderable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-empty-'));
    dirs.push(dir);
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
    run(['init', '-q', '--initial-branch=main']);
    run(['config', 'user.name', 'T']);
    run(['config', 'user.email', 't@e.c']);
    writeFileSync(join(dir, 'f.txt'), 'x');
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: real']);
    run(['tag', 'v1.0.0']);
    writeFileSync(join(dir, 'f.txt'), 'y');
    run(['add', '.']);
    // chore is hidden, so v1.1.0 has nothing to show.
    run(['commit', '-q', '--no-gpg-sign', '-m', 'chore: noise']);
    run(['tag', 'v1.1.0']);

    expect(generate(dir).versions).toEqual(['1.0.0']);
  });

  it('handles a repository with no tags at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-notag-'));
    dirs.push(dir);
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
    run(['init', '-q', '--initial-branch=main']);
    run(['config', 'user.name', 'T']);
    run(['config', 'user.email', 't@e.c']);
    writeFileSync(join(dir, 'f.txt'), 'x');
    run(['add', '.']);
    run(['commit', '-q', '--no-gpg-sign', '-m', 'feat: only commit']);

    const result = generate(dir);
    expect(result.versions).toEqual(['Unreleased']);
    expect(result.document).toContain('only commit');
  });

  it('respects --path so a monorepo package gets its own history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-allmono-'));
    dirs.push(dir);
    const run = (args: string[]) => execFileSync('git', args, { cwd: dir });
    run(['init', '-q', '--initial-branch=main']);
    run(['config', 'user.name', 'T']);
    run(['config', 'user.email', 't@e.c']);
    const commitIn = (sub: string, message: string) => {
      execFileSync('mkdir', ['-p', join(dir, sub)]);
      writeFileSync(join(dir, sub, 'f.txt'), message);
      run(['add', '.']);
      run(['commit', '-q', '--no-gpg-sign', '-m', message]);
    };
    commitIn('web', 'feat(web): web one');
    run(['tag', 'v1.0.0']);
    commitIn('api', 'feat(api): api one');
    run(['tag', 'v1.1.0']);

    const document = generate(dir, { paths: ['web'] }).document;
    expect(document).toContain('web one');
    expect(document).not.toContain('api one');
  });

  it('errors on an unknown --to ref', () => {
    expect(() => generate(history(), { to: 'nope' })).toThrow(/Unknown git ref/);
  });
});
