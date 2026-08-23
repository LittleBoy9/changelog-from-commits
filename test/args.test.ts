import { describe, expect, it } from 'vitest';
import { ArgError, parseArgs } from '../src/args.js';
import { DEFAULT_OPTIONS, resolveOptions } from '../src/options.js';

describe('parseArgs', () => {
  it('returns defaults for an empty argv', () => {
    expect(parseArgs([])).toEqual({ positionals: [] });
  });

  it('parses space-separated values', () => {
    expect(parseArgs(['--from', 'v1.0.0']).from).toBe('v1.0.0');
  });

  it('parses equals-separated values', () => {
    expect(parseArgs(['--from=v1.0.0']).from).toBe('v1.0.0');
  });

  it('parses boolean flags', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--include-all']).includeAll).toBe(true);
  });

  it('parses short aliases', () => {
    const args = parseArgs(['-d', '-o', 'OUT.md', '-c', 'cfg.json']);
    expect(args).toMatchObject({ dryRun: true, output: 'OUT.md', config: 'cfg.json' });
  });

  it('supports --no- for negatable booleans', () => {
    expect(parseArgs(['--no-links']).linkReferences).toBe(false);
  });

  it('rejects --no- on a non-negatable boolean', () => {
    expect(() => parseArgs(['--no-dry-run'])).toThrow(ArgError);
  });

  it('accepts an explicit boolean value', () => {
    expect(parseArgs(['--dry-run=false']).dryRun).toBe(false);
    expect(() => parseArgs(['--dry-run=maybe'])).toThrow(/expects true or false/);
  });

  it('treats --version as a semver value, not a request for the tool version', () => {
    expect(parseArgs(['--version', '1.4.0']).version).toBe('1.4.0');
    expect(parseArgs(['--cli-version']).cliVersion).toBe(true);
    expect(parseArgs(['-v']).cliVersion).toBe(true);
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option: --nope/);
  });

  it('rejects a value flag with no value', () => {
    expect(() => parseArgs(['--from'])).toThrow(/expects a value/);
    expect(() => parseArgs(['--from', '--dry-run'])).toThrow(/expects a value/);
  });

  it('allows a dash-leading value when passed with =', () => {
    expect(parseArgs(['--tag-prefix=-rc']).tagPrefix).toBe('-rc');
  });

  it('accumulates a repeatable --path', () => {
    expect(parseArgs(['--path', 'packages/web', '--path', 'docs']).paths).toEqual([
      'packages/web',
      'docs',
    ]);
  });

  it('accepts --path with = syntax', () => {
    expect(parseArgs(['--path=packages/web']).paths).toEqual(['packages/web']);
  });

  it('leaves paths undefined when --path is not passed', () => {
    expect(parseArgs(['--dry-run']).paths).toBeUndefined();
  });

  it('parses --all and --force together', () => {
    const args = parseArgs(['--all', '--force']);
    expect(args.all).toBe(true);
    expect(args.force).toBe(true);
  });

  it('rejects --force without --all', () => {
    expect(() => parseArgs(['--force'])).toThrow(/only applies together with --all/);
  });

  it('validates --prerelease-tags values', () => {
    expect(parseArgs(['--prerelease-tags', 'skip']).prereleaseTags).toBe('skip');
    expect(parseArgs(['--prerelease-tags', 'include']).prereleaseTags).toBe('include');
    expect(parseArgs(['--prerelease-tags', 'auto']).prereleaseTags).toBe('auto');
    expect(() => parseArgs(['--prerelease-tags', 'nonsense'])).toThrow(/expects auto, skip, or include/);
  });

  it('supports --no-references', () => {
    expect(parseArgs(['--no-references']).showReferences).toBe(false);
  });

  it('collects positionals and everything after --', () => {
    const args = parseArgs(['extra', '--dry-run', '--', '--not-a-flag']);
    expect(args.positionals).toEqual(['extra', '--not-a-flag']);
    expect(args.dryRun).toBe(true);
  });

  it('parses a full realistic invocation', () => {
    const args = parseArgs([
      '--from', 'v1.2.0',
      '--to', 'HEAD',
      '--output', 'docs/CHANGELOG.md',
      '--version', '1.3.0',
      '--tag-prefix', 'v',
      '--include-all',
      '--dry-run',
    ]);
    expect(args).toEqual({
      from: 'v1.2.0',
      to: 'HEAD',
      output: 'docs/CHANGELOG.md',
      version: '1.3.0',
      tagPrefix: 'v',
      includeAll: true,
      dryRun: true,
      positionals: [],
    });
  });
});

describe('resolveOptions', () => {
  it('falls back to defaults', () => {
    const options = resolveOptions({ positionals: [] });
    expect(options).toMatchObject({
      from: DEFAULT_OPTIONS.from,
      to: 'HEAD',
      output: 'CHANGELOG.md',
      dryRun: false,
      version: null,
      tagPrefix: '',
      includeAll: false,
      linkReferences: true,
    });
  });

  it('applies config file values over defaults', () => {
    const options = resolveOptions({ positionals: [] }, { tagPrefix: 'v', output: 'HISTORY.md' });
    expect(options.tagPrefix).toBe('v');
    expect(options.output).toBe('HISTORY.md');
  });

  it('lets CLI flags win over config file values', () => {
    const options = resolveOptions(
      { positionals: [], tagPrefix: 'release-' },
      { tagPrefix: 'v' },
    );
    expect(options.tagPrefix).toBe('release-');
  });

  it('lets a false flag win over a true config value', () => {
    const options = resolveOptions(
      { positionals: [], linkReferences: false },
      { linkReferences: true },
    );
    expect(options.linkReferences).toBe(false);
  });

  it('ignores dryRun from config, since suppressing writes must be explicit', () => {
    const options = resolveOptions({ positionals: [] }, { includeAll: true } as never);
    expect(options.dryRun).toBe(false);
    expect(options.includeAll).toBe(true);
  });

  it('resolves cwd to an absolute path', () => {
    expect(resolveOptions({ positionals: [], cwd: '.' }).cwd).toBe(process.cwd());
  });

  it('prefers --path over config paths', () => {
    const options = resolveOptions(
      { positionals: [], paths: ['from-flag'] },
      { paths: ['from-config'] },
    );
    expect(options.paths).toEqual(['from-flag']);
  });

  it('falls back to config paths when no flag is given', () => {
    expect(resolveOptions({ positionals: [] }, { paths: ['pkg'] }).paths).toEqual(['pkg']);
  });

  it('pairs reverts by default and honours the config opt-out', () => {
    expect(resolveOptions({ positionals: [] }).pairReverts).toBe(true);
    expect(resolveOptions({ positionals: [] }, { pairReverts: false }).pairReverts).toBe(false);
  });

  it('defaults prereleaseTags to auto and takes config or flag overrides', () => {
    expect(resolveOptions({ positionals: [] }).prereleaseTags).toBe('auto');
    expect(resolveOptions({ positionals: [] }, { prereleaseTags: 'skip' }).prereleaseTags).toBe('skip');
    expect(
      resolveOptions({ positionals: [], prereleaseTags: 'include' }, { prereleaseTags: 'skip' })
        .prereleaseTags,
    ).toBe('include');
  });

  it('ignores all and force from config, since they are actions', () => {
    const options = resolveOptions({ positionals: [] }, { all: true, force: true } as never);
    expect(options.all).toBe(false);
    expect(options.force).toBe(false);
  });

  it('ignores an empty types array from config', () => {
    expect(resolveOptions({ positionals: [] }, { types: [] }).types).toBe(DEFAULT_OPTIONS.types);
  });
});
