/**
 * A deliberately small flag parser.
 *
 * Supports `--flag`, `--flag value`, `--flag=value`, `--no-<flag>` for booleans,
 * and `--` to stop parsing. It knows every flag up front, so a typo is an error
 * rather than a silently ignored argument.
 */

export class ArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgError';
  }
}

export interface CliArgs {
  from?: string;
  to?: string;
  output?: string;
  dryRun?: boolean;
  version?: string;
  tagPrefix?: string;
  includeAll?: boolean;
  /** Repeatable `--path`, accumulated in order. */
  paths?: string[];
  prereleaseTags?: string;
  showReferences?: boolean;
  all?: boolean;
  force?: boolean;
  config?: string;
  repoUrl?: string;
  cwd?: string;
  linkReferences?: boolean;
  help?: boolean;
  cliVersion?: boolean;
  /** Anything after `--`, or non-flag arguments. */
  positionals: string[];
}

type FlagKind = 'string' | 'boolean' | 'list';

interface FlagSpec {
  key: Exclude<keyof CliArgs, 'positionals'>;
  kind: FlagKind;
  /** Value used when a boolean flag is passed bare. */
  negatable?: boolean;
}

/**
 * `--version` takes a semver value here, per this tool's CLI contract, so the
 * tool's own version lives behind `--cli-version` / `-v`.
 */
const FLAGS: Record<string, FlagSpec> = {
  '--from': { key: 'from', kind: 'string' },
  '--to': { key: 'to', kind: 'string' },
  '--output': { key: 'output', kind: 'string' },
  '-o': { key: 'output', kind: 'string' },
  '--version': { key: 'version', kind: 'string' },
  '--tag-prefix': { key: 'tagPrefix', kind: 'string' },
  '--config': { key: 'config', kind: 'string' },
  '-c': { key: 'config', kind: 'string' },
  '--repo-url': { key: 'repoUrl', kind: 'string' },
  '--cwd': { key: 'cwd', kind: 'string' },
  '--dry-run': { key: 'dryRun', kind: 'boolean' },
  '-d': { key: 'dryRun', kind: 'boolean' },
  '--include-all': { key: 'includeAll', kind: 'boolean' },
  '--path': { key: 'paths', kind: 'list' },
  '--prerelease-tags': { key: 'prereleaseTags', kind: 'string' },
  '--references': { key: 'showReferences', kind: 'boolean', negatable: true },
  '--all': { key: 'all', kind: 'boolean' },
  '--force': { key: 'force', kind: 'boolean' },
  '--links': { key: 'linkReferences', kind: 'boolean', negatable: true },
  '--help': { key: 'help', kind: 'boolean' },
  '-h': { key: 'help', kind: 'boolean' },
  '--cli-version': { key: 'cliVersion', kind: 'boolean' },
  '-v': { key: 'cliVersion', kind: 'boolean' },
};

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { positionals: [] };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '--') {
      args.positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith('-') || token === '-') {
      args.positionals.push(token);
      continue;
    }

    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);

    // `--no-links` turns off a negatable boolean.
    if (name.startsWith('--no-')) {
      const positive = `--${name.slice(5)}`;
      const spec = FLAGS[positive];
      if (!spec || spec.kind !== 'boolean' || !spec.negatable) {
        throw new ArgError(`Unknown option: ${name}`);
      }
      setBoolean(args, spec, false);
      continue;
    }

    const spec = FLAGS[name];
    if (!spec) {
      throw new ArgError(`Unknown option: ${name}`);
    }

    if (spec.kind === 'boolean') {
      if (inlineValue !== null) {
        if (inlineValue !== 'true' && inlineValue !== 'false') {
          throw new ArgError(`Option ${name} expects true or false, got "${inlineValue}"`);
        }
        setBoolean(args, spec, inlineValue === 'true');
      } else {
        setBoolean(args, spec, true);
      }
      continue;
    }

    const value = inlineValue ?? argv[++i];
    if (value === undefined || (inlineValue === null && value.startsWith('-'))) {
      throw new ArgError(`Option ${name} expects a value.`);
    }

    if (spec.kind === 'list') {
      appendValue(args, spec, value);
    } else {
      setValue(args, spec, value);
    }
  }

  if (
    args.prereleaseTags !== undefined &&
    !['auto', 'skip', 'include'].includes(args.prereleaseTags)
  ) {
    throw new ArgError(
      `Option --prerelease-tags expects auto, skip, or include, got "${args.prereleaseTags}"`,
    );
  }

  if (args.force && !args.all) {
    throw new ArgError('Option --force only applies together with --all.');
  }

  return args;
}

function setBoolean(args: CliArgs, spec: FlagSpec, value: boolean): void {
  assign(args, spec.key, value);
}

function setValue(args: CliArgs, spec: FlagSpec, value: string): void {
  assign(args, spec.key, value);
}

/** Repeatable flags accumulate rather than overwrite. */
function appendValue(args: CliArgs, spec: FlagSpec, value: string): void {
  const bag = args as unknown as Record<string, unknown>;
  const existing = bag[spec.key];
  if (Array.isArray(existing)) existing.push(value);
  else bag[spec.key] = [value];
}

/** The flag table guarantees key and value agree, which the type system cannot see. */
function assign(args: CliArgs, key: FlagSpec['key'], value: string | boolean): void {
  (args as unknown as Record<string, unknown>)[key] = value;
}

export const HELP_TEXT = `changelog-from-commits — generate a CHANGELOG.md from Conventional Commits

Usage
  npx changelog-from-commits [options]

Options
  --from <ref>         Start of the range, exclusive. Defaults to the last git tag.
  --to <ref>           End of the range, inclusive. Defaults to HEAD.
  -o, --output <path>  Changelog file to write. Defaults to CHANGELOG.md.
  --version <semver>   Version for the release heading. Defaults to the version
                       in package.json, or "Unreleased".
  --tag-prefix <str>   Prefix used by your release tags, e.g. "v". Default: "".
  -d, --dry-run        Print the result to stdout without writing any file.
  --include-all        Keep non-conventional commits in an "Other Changes" section.
                       By default they are skipped.
  --path <dir>         Only include commits touching this path. Repeatable.
                       Useful with --tag-prefix for monorepo packages.
  --all                Rebuild the whole changelog, one section per tag.
                       Replaces the output file; needs --force if it exists.
  --force              Allow --all to overwrite a non-empty changelog.
  --prerelease-tags <mode>
                       auto (default) starts a stable release from the last
                       stable tag so beta commits are not lost; skip always
                       ignores prerelease tags; include uses the nearest tag.
  --no-references      Omit the trailing "closes #12" issue list.
  --repo-url <url>     Repository web URL for links. Detected from origin remote.
  --no-links           Render plain text entries instead of commit/PR links.
  -c, --config <path>  Path to a config file. Searched upward by default.
  --cwd <dir>          Directory to run in. Defaults to the current directory.
  -h, --help           Show this help.
  -v, --cli-version    Print the version of this tool.

Examples
  npx changelog-from-commits
  npx changelog-from-commits --version 1.4.0 --tag-prefix v
  npx changelog-from-commits --from v1.2.0 --to v1.3.0 --dry-run
  npx changelog-from-commits --tag-prefix web-v --path packages/web
  npx changelog-from-commits --all --tag-prefix v --dry-run

Config file (changelog.config.js, .changelogrc.json, and similar) may set any of
from, to, output, version, tagPrefix, includeAll, paths, pairReverts,
prereleaseTags, showReferences, types, repoUrl, linkReferences, otherTitle.
CLI flags always win over config values.
`;
