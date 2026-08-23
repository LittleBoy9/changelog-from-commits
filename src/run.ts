import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ArgError, HELP_TEXT, parseArgs } from './args.js';
import {
  applyToChangelog,
  generateAll,
  generateChangelog,
  hasVersionHeading,
} from './changelog.js';
import { ConfigError, loadConfig } from './config.js';
import { GitError } from './git.js';
import { resolveOptions } from './options.js';
import type { ResolvedOptions } from './types.js';

const VERSION = typeof __CFC_VERSION__ === 'string' ? __CFC_VERSION__ : '0.0.0-dev';

export async function run(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof ArgError) {
      process.stderr.write(`${error.message}\nRun with --help to see available options.\n`);
      return 1;
    }
    throw error;
  }

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (args.cliVersion) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  if (args.positionals.length > 0) {
    process.stderr.write(
      `Unexpected argument: ${args.positionals[0]}\nThis command takes options only.\n`,
    );
    return 1;
  }

  try {
    const cwd = resolve(args.cwd ?? process.cwd());
    const { config, filepath } = await loadConfig(cwd, args.config);
    const options = resolveOptions(args, config);

    if (filepath && !options.dryRun) {
      process.stderr.write(`Using config ${filepath}\n`);
    }

    if (options.all) return runBackfill(options);

    const result = generateChangelog(options);

    if (result.skipped.length > 0) {
      const noun = result.skipped.length === 1 ? 'commit' : 'commits';
      process.stderr.write(
        `Skipped ${result.skipped.length} non-conventional ${noun}. ` +
          `Use --include-all to keep them.\n`,
      );
    }

    if (result.revertedPairs.length > 0) {
      const n = result.revertedPairs.length;
      process.stderr.write(
        `Cancelled ${n} reverted ${n === 1 ? 'change' : 'changes'} against ${n === 1 ? 'its' : 'their'} revert ${n === 1 ? 'commit' : 'commits'}.\n`,
      );
    }

    if (options.dryRun) {
      process.stdout.write(result.section);
      return 0;
    }

    const path = outputPath(options);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;

    if (hasVersionHeading(existing, result.context.version)) {
      process.stderr.write(
        `${path} already has a heading for ${result.context.version}. ` +
          `Nothing written — pass a different --version, or use --dry-run to preview.\n`,
      );
      return 1;
    }

    writeFileSync(path, applyToChangelog(existing, result.section), 'utf8');

    const count = result.context.groups.reduce((sum, group) => sum + group.commits.length, 0);
    const range = result.range.from
      ? `${result.range.from}..${result.range.to}`
      : result.range.to;
    process.stdout.write(
      `Wrote ${result.context.version} to ${path} ` +
        `(${count} ${count === 1 ? 'entry' : 'entries'} from ${range}).\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ConfigError || error instanceof GitError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

/** Resolve `--output` against the working directory. */
function outputPath(options: ResolvedOptions): string {
  return isAbsolute(options.output) ? options.output : resolve(options.cwd, options.output);
}

/**
 * `--all`: rebuild the entire changelog from every tag.
 *
 * This replaces the file rather than prepending to it, so an existing non-empty
 * changelog is only overwritten with `--force`. Hand-written release notes are
 * not something to destroy on a typo.
 */
function runBackfill(options: ResolvedOptions): number {
  const result = generateAll(options);

  if (result.sections.length === 0) {
    process.stderr.write('No releases found to write.\n');
    return 1;
  }

  if (options.dryRun) {
    process.stdout.write(result.document);
    return 0;
  }

  const path = outputPath(options);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;

  if (existing?.trim() && !options.force) {
    process.stderr.write(
      `${path} already exists and --all replaces it entirely.\n` +
        `Re-run with --force to overwrite, or --dry-run to preview.\n`,
    );
    return 1;
  }

  writeFileSync(path, result.document, 'utf8');
  const count = result.versions.length;
  process.stdout.write(
    `Rebuilt ${path} with ${count} ${count === 1 ? 'release' : 'releases'} ` +
      `(${result.versions.join(', ')}).\n`,
  );
  return 0;
}
