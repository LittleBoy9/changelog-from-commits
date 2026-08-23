import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateChangelog } from '../src/changelog.js';
import { getLastTag } from '../src/git.js';
import { resolveOptions } from '../src/options.js';

let repo: string;

function run(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Commit with a fixed date so the rendered heading is deterministic. */
function commit(message: string, date = '2026-08-21T12:00:00+00:00'): void {
  writeFileSync(join(repo, 'file.txt'), `${message}\n${Math.random()}`);
  run(['add', '.']);
  run([
    '-c', 'user.name=Test',
    '-c', 'user.email=test@example.com',
    'commit',
    '--no-gpg-sign',
    '--date', date,
    '-m', message,
  ]);
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'cfc-repo-'));
  run(['init', '--initial-branch=main']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'commit.gpgsign', 'false']);
  run(['remote', 'add', 'origin', 'git@github.com:acme/widgets.git']);

  commit('chore: initial commit');
  commit('feat: the first feature');
  run(['tag', 'v1.0.0']);

  commit('feat(auth): add OAuth support (#12)');
  commit('fix(parser): stop crashing on empty bodies');
  commit('wip on something');
  commit(
    'feat(api)!: require an API key\n\nBREAKING CHANGE: every request now needs an X-Api-Key header.\n\nCloses #20',
  );
  commit('chore: bump deps');
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe('generateChangelog against a real repository', () => {
  it('defaults the range to the last tag', () => {
    expect(getLastTag(repo)).toBe('v1.0.0');
    const result = generateChangelog(resolveOptions({ positionals: [], cwd: repo }));
    expect(result.range.from).toBe('v1.0.0');
    expect(result.commits).toHaveLength(5);
  });

  it('respects a tag prefix that matches nothing', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, tagPrefix: 'release-' }),
    );
    // No matching tag, so the range walks the whole history.
    expect(result.range.from).toBeNull();
    expect(result.commits).toHaveLength(7);
  });

  it('detects the GitHub remote and links entries', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, version: '1.1.0' }),
    );
    expect(result.context.links?.host).toBe('github');
    expect(result.section).toContain('([#12](https://github.com/acme/widgets/pull/12))');
    expect(result.section).toMatch(/\[[0-9a-f]{7,}\]\(https:\/\/github\.com\/acme\/widgets\/commit\//);
  });

  it('renders a compare link between the last tag and the new version', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, version: '1.1.0', tagPrefix: 'v' }),
    );
    expect(result.section).toContain(
      '## [1.1.0](https://github.com/acme/widgets/compare/v1.0.0...v1.1.0)',
    );
  });

  it('groups, hides chores, and surfaces breaking changes', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, version: '1.1.0' }),
    );
    expect(result.section).toContain('### ⚠ BREAKING CHANGES');
    expect(result.section).toContain('* **api:** every request now needs an X-Api-Key header.');
    expect(result.section).toContain('* **auth:** add OAuth support');
    expect(result.section).toContain('* **parser:** stop crashing on empty bodies');
    expect(result.section).not.toContain('bump deps');
  });

  it('skips non-conventional commits and reports them', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, version: '1.1.0' }),
    );
    expect(result.section).not.toContain('wip on something');
    expect(result.skipped.map((c) => c.subject)).toEqual(['wip on something']);
  });

  it('keeps non-conventional commits under includeAll', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, version: '1.1.0', includeAll: true }),
    );
    expect(result.section).toContain('### Other Changes');
    expect(result.section).toContain('* wip on something');
    expect(result.skipped).toEqual([]);
  });

  it('honours an explicit range', () => {
    const result = generateChangelog(
      resolveOptions({ positionals: [], cwd: repo, from: 'v1.0.0', to: 'HEAD~2' }),
    );
    expect(result.section).toContain('add OAuth support');
    expect(result.section).not.toContain('require an API key');
  });

  it('falls back to Unreleased with no package.json and no --version', () => {
    const result = generateChangelog(resolveOptions({ positionals: [], cwd: repo }));
    expect(result.context.version).toBe('Unreleased');
  });

  it('reads the version from package.json when present', () => {
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'w', version: '2.5.1' }));
    try {
      const result = generateChangelog(resolveOptions({ positionals: [], cwd: repo }));
      expect(result.context.version).toBe('2.5.1');
    } finally {
      rmSync(join(repo, 'package.json'));
    }
  });

  it('errors on an unknown ref', () => {
    expect(() =>
      generateChangelog(resolveOptions({ positionals: [], cwd: repo, to: 'no-such-ref' })),
    ).toThrow(/Unknown git ref/);
  });

  it('errors outside a git repository', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'cfc-plain-'));
    try {
      expect(() => generateChangelog(resolveOptions({ positionals: [], cwd: notRepo }))).toThrow(
        /Not a git repository/,
      );
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });
});

describe('cli end to end', () => {
  const cli = join(__dirname, '..', 'dist', 'cli.js');
  const built = existsSync(cli);
  const maybe = built ? it : it.skip;

  function cfc(args: string[], cwd = repo): { stdout: string; stderr: string; code: number } {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
      return { stdout, stderr: '', code: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 };
    }
  }

  maybe('prints help', () => {
    const { stdout, code } = cfc(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage');
    expect(stdout).toContain('--tag-prefix');
  });

  maybe('prints its own version', () => {
    const { stdout, code } = cfc(['--cli-version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  maybe('rejects an unknown flag', () => {
    const { stderr, code } = cfc(['--nope']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown option');
  });

  maybe('writes nothing on --dry-run', () => {
    const { stdout, code } = cfc(['--dry-run', '--version', '1.1.0']);
    expect(code).toBe(0);
    expect(stdout).toContain('## [1.1.0]');
    expect(existsSync(join(repo, 'CHANGELOG.md'))).toBe(false);
  });

  maybe('writes and then prepends to CHANGELOG.md', () => {
    expect(cfc(['--version', '1.1.0', '--tag-prefix', 'v']).code).toBe(0);
    const first = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(first).toContain('# Changelog');
    expect(first).toContain('## [1.1.0]');

    expect(cfc(['--version', '1.2.0', '--from', 'v1.0.0']).code).toBe(0);
    const second = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(second.indexOf('## [1.2.0]')).toBeLessThan(second.indexOf('## [1.1.0]'));
    expect(second.startsWith('# Changelog')).toBe(true);
  });

  maybe('refuses to write a duplicate version heading', () => {
    const { stderr, code } = cfc(['--version', '1.1.0']);
    expect(code).toBe(1);
    expect(stderr).toContain('already has a heading');
  });

  maybe('reads a config file', () => {
    writeFileSync(join(repo, '.changelogrc.json'), JSON.stringify({ tagPrefix: 'v', includeAll: true }));
    try {
      const { stdout } = cfc(['--dry-run', '--version', '9.9.9']);
      expect(stdout).toContain('### Other Changes');
      expect(stdout).toContain('compare/v1.0.0...v9.9.9');
    } finally {
      rmSync(join(repo, '.changelogrc.json'));
    }
  });

  maybe('lets a flag override the config file', () => {
    writeFileSync(join(repo, '.changelogrc.json'), JSON.stringify({ includeAll: true }));
    try {
      const { stdout } = cfc(['--dry-run', '--version', '9.9.9', '--include-all=false']);
      expect(stdout).not.toContain('### Other Changes');
    } finally {
      rmSync(join(repo, '.changelogrc.json'));
    }
  });
});
