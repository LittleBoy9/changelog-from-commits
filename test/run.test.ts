import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/run.js';

const dirs: string[] = [];

function tempRepo(withOrigin = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfc-run-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: dir });
  if (withOrigin) {
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: dir });
  }
  return dir;
}

function commit(dir: string, message: string): void {
  writeFileSync(join(dir, 'f.txt'), message + Math.random());
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', message], { cwd: dir });
}

/** Run the CLI in-process, capturing what it writes. */
async function cli(argv: string[], cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  try {
    const code = await run([...argv, '--cwd', cwd]);
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('exit codes and messages', () => {
  it('exits 0 and prints help', async () => {
    const { code, stdout } = await cli(['--help'], tempRepo());
    expect(code).toBe(0);
    expect(stdout).toContain('Usage');
  });

  it('exits 0 and prints the tool version', async () => {
    const { code, stdout } = await cli(['--cli-version'], tempRepo());
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits 1 on an unknown flag without touching git', async () => {
    const { code, stderr } = await cli(['--bogus'], tempRepo());
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown option');
    expect(stderr).toContain('--help');
  });

  it('exits 1 on an unexpected positional argument', async () => {
    const { code, stderr } = await cli(['v1.0.0'], tempRepo());
    expect(code).toBe(1);
    expect(stderr).toContain('Unexpected argument: v1.0.0');
  });

  it('exits 1 outside a git repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfc-plain-'));
    dirs.push(dir);
    const { code, stderr } = await cli([], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('Not a git repository');
  });

  it('exits 1 on a missing config file', async () => {
    const { code, stderr } = await cli(['--config', 'nope.json'], tempRepo());
    expect(code).toBe(1);
    expect(stderr).toContain('Config file not found');
  });

  it('exits 1 on a malformed config file', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    writeFileSync(join(dir, '.changelogrc.json'), '{ broken');
    const { code, stderr } = await cli(['--dry-run'], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('Could not parse');
  });

  it('exits 1 on an unknown ref', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    const { code, stderr } = await cli(['--to', 'nope'], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown git ref');
  });
});

describe('writing', () => {
  it('writes CHANGELOG.md and reports what it did', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    commit(dir, 'fix: b');

    const { code, stdout } = await cli(['--version', '1.0.0'], dir);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Wrote 1\.0\.0 to .*CHANGELOG\.md \(2 entries/);
    // No previous tag in this repo, so the heading is plain rather than a compare link.
    const written = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    expect(written).toContain('## 1.0.0 (');
    expect(written).toContain('# Changelog');
  });

  it('links the heading to a compare view once a previous tag exists', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    commit(dir, 'feat: b');

    const { stdout } = await cli(['--dry-run', '--version', '1.1.0', '--tag-prefix', 'v'], dir);
    expect(stdout).toContain('## [1.1.0](https://github.com/acme/w/compare/v1.0.0...v1.1.0)');
  });

  it('uses the singular for a single entry', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: only one');
    const { stdout } = await cli(['--version', '1.0.0'], dir);
    expect(stdout).toContain('1 entry');
  });

  it('writes nothing on --dry-run', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    const { code, stdout } = await cli(['--dry-run', '--version', '1.0.0'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('### Features');
    expect(existsSync(join(dir, 'CHANGELOG.md'))).toBe(false);
  });

  it('honours --output, including a nested path', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    mkdirSync(join(dir, 'docs'));
    const { code } = await cli(['--version', '1.0.0', '--output', 'docs/HISTORY.md'], dir);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'docs', 'HISTORY.md'))).toBe(true);
  });

  it('reports a missing output directory rather than crashing', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    const { code, stderr } = await cli(['--version', '1.0.0', '--output', 'nope/OUT.md'], dir);
    expect(code).toBe(1);
    expect(stderr).toBeTruthy();
  });

  it('refuses to write a duplicate version heading', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    expect((await cli(['--version', '1.0.0'], dir)).code).toBe(0);

    const { code, stderr } = await cli(['--version', '1.0.0'], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('already has a heading for 1.0.0');
    // The first release must survive the refused second write.
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8').match(/## \[?1\.0\.0/g)).toHaveLength(1);
  });

  it('warns about skipped non-conventional commits', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    commit(dir, 'wip');
    commit(dir, 'more wip');
    const { stderr } = await cli(['--dry-run'], dir);
    expect(stderr).toContain('Skipped 2 non-conventional commits');
    expect(stderr).toContain('--include-all');
  });

  it('does not warn when there is nothing to skip', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    const { stderr } = await cli(['--dry-run'], dir);
    expect(stderr).not.toContain('Skipped');
  });
});

describe('new flags', () => {
  it('filters to a path', async () => {
    const dir = tempRepo();
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(join(dir, 'web', 'f.txt'), 'x');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '--no-gpg-sign', '-m', 'feat(web): a web thing'], { cwd: dir });
    commit(dir, 'feat(root): a root thing');

    const { stdout } = await cli(['--dry-run', '--version', '1.0.0', '--path', 'web'], dir);
    expect(stdout).toContain('a web thing');
    expect(stdout).not.toContain('a root thing');
  });

  it('reports cancelled reverts on stderr', async () => {
    const dir = tempRepo();
    commit(dir, 'chore: base');
    commit(dir, 'feat: doomed');
    execFileSync('git', ['revert', '--no-edit', '--no-gpg-sign', 'HEAD'], { cwd: dir });

    const { stdout, stderr } = await cli(['--dry-run', '--version', '1.0.0'], dir);
    expect(stderr).toContain('Cancelled 1 reverted change');
    expect(stdout).not.toContain('doomed');
  });
});

describe('--all backfill', () => {
  function tagged(): string {
    const dir = tempRepo();
    commit(dir, 'feat: one');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    commit(dir, 'fix: two');
    execFileSync('git', ['tag', 'v1.1.0'], { cwd: dir });
    return dir;
  }

  it('writes every release when no file exists', async () => {
    const dir = tagged();
    const { code, stdout } = await cli(['--all', '--tag-prefix', 'v'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('2 releases');

    const written = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    expect(written).toContain('## [1.1.0]');
    expect(written).toContain('## 1.0.0');
  });

  it('refuses to overwrite an existing changelog without --force', async () => {
    const dir = tagged();
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\nHand written.\n');

    const { code, stderr } = await cli(['--all', '--tag-prefix', 'v'], dir);
    expect(code).toBe(1);
    expect(stderr).toContain('--all replaces it entirely');
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toContain('Hand written.');
  });

  it('overwrites with --force', async () => {
    const dir = tagged();
    writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\nHand written.\n');

    const { code } = await cli(['--all', '--tag-prefix', 'v', '--force'], dir);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).not.toContain('Hand written.');
  });

  it('writes nothing on --all --dry-run', async () => {
    const dir = tagged();
    const { code, stdout } = await cli(['--all', '--tag-prefix', 'v', '--dry-run'], dir);
    expect(code).toBe(0);
    expect(stdout).toContain('# Changelog');
    expect(existsSync(join(dir, 'CHANGELOG.md'))).toBe(false);
  });

  it('overwrites an empty file without needing --force', async () => {
    const dir = tagged();
    writeFileSync(join(dir, 'CHANGELOG.md'), '   \n');
    expect((await cli(['--all', '--tag-prefix', 'v'], dir)).code).toBe(0);
  });
});

describe('prerelease flags', () => {
  it('includes beta commits in a stable release', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: shipped');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: dir });
    commit(dir, 'feat: beta work');
    execFileSync('git', ['tag', 'v1.1.0-beta.1'], { cwd: dir });
    commit(dir, 'fix: after beta');

    const { stdout } = await cli(
      ['--dry-run', '--version', '1.1.0', '--tag-prefix', 'v'],
      dir,
    );
    expect(stdout).toContain('beta work');
    expect(stdout).toContain('after beta');
  });

  it('rejects an invalid --prerelease-tags value', async () => {
    const { code, stderr } = await cli(['--prerelease-tags', 'maybe'], tempRepo());
    expect(code).toBe(1);
    expect(stderr).toContain('expects auto, skip, or include');
  });
});

describe('config integration', () => {
  it('reports which config file it used', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    writeFileSync(join(dir, '.changelogrc.json'), JSON.stringify({ tagPrefix: 'v' }));
    const { stderr } = await cli(['--version', '1.0.0'], dir);
    expect(stderr).toContain('Using config');
    expect(stderr).toContain('.changelogrc.json');
  });

  it('applies a custom types table from config', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    commit(dir, 'chore: b');
    writeFileSync(
      join(dir, '.changelogrc.json'),
      JSON.stringify({ types: [{ type: 'chore', title: 'Housekeeping' }] }),
    );
    const { stdout } = await cli(['--dry-run', '--version', '1.0.0'], dir);
    expect(stdout).toContain('### Housekeeping');
    expect(stdout).not.toContain('### Features');
  });

  it('lets --no-links override a config that enables them', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    writeFileSync(join(dir, '.changelogrc.json'), JSON.stringify({ linkReferences: true }));
    const { stdout } = await cli(['--dry-run', '--version', '1.0.0', '--no-links'], dir);
    expect(stdout).not.toContain('https://');
  });

  it('uses --repo-url over the detected remote', async () => {
    const dir = tempRepo();
    commit(dir, 'feat: a');
    const { stdout } = await cli(
      ['--dry-run', '--version', '1.0.0', '--repo-url', 'https://gitlab.com/o/p'],
      dir,
    );
    expect(stdout).toContain('https://gitlab.com/o/p/-/commit/');
  });
});
