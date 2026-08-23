import { resolve } from 'node:path';
import { DEFAULT_TYPES } from './render.js';
import type { ChangelogConfig, ResolvedOptions } from './types.js';
import type { CliArgs } from './args.js';

/** Option values used when neither a config file nor a flag says otherwise. */
export const DEFAULT_OPTIONS: Omit<ResolvedOptions, 'cwd'> = {
  from: null,
  to: 'HEAD',
  output: 'CHANGELOG.md',
  dryRun: false,
  version: null,
  tagPrefix: '',
  includeAll: false,
  paths: [],
  pairReverts: true,
  prereleaseTags: 'auto',
  showReferences: true,
  aliases: {},
  keepEmoji: false,
  all: false,
  force: false,
  types: DEFAULT_TYPES,
  repoUrl: null,
  linkReferences: true,
  otherTitle: 'Other Changes',
};

/**
 * Merge defaults, config file, and CLI flags into the options the generator uses.
 *
 * Precedence is flags > config file > defaults. `--dry-run` is flag-only on
 * purpose: a config file that silently suppressed writes would be a trap.
 */
export function resolveOptions(args: CliArgs, config: ChangelogConfig = {}): ResolvedOptions {
  const cwd = resolve(args.cwd ?? process.cwd());

  return {
    cwd,
    from: pick(args.from, config.from, DEFAULT_OPTIONS.from),
    to: pick(args.to, config.to, DEFAULT_OPTIONS.to),
    output: pick(args.output, config.output, DEFAULT_OPTIONS.output),
    dryRun: args.dryRun ?? DEFAULT_OPTIONS.dryRun,
    version: pick(args.version, config.version, DEFAULT_OPTIONS.version),
    tagPrefix: pick(args.tagPrefix, config.tagPrefix, DEFAULT_OPTIONS.tagPrefix),
    includeAll: pick(args.includeAll, config.includeAll, DEFAULT_OPTIONS.includeAll),
    paths: args.paths?.length ? args.paths : (config.paths ?? DEFAULT_OPTIONS.paths),
    pairReverts: pick(undefined, config.pairReverts, DEFAULT_OPTIONS.pairReverts),
    prereleaseTags: pick(
      args.prereleaseTags as ResolvedOptions['prereleaseTags'] | undefined,
      config.prereleaseTags,
      DEFAULT_OPTIONS.prereleaseTags,
    ),
    showReferences: pick(
      args.showReferences,
      config.showReferences,
      DEFAULT_OPTIONS.showReferences,
    ),
    aliases: config.aliases ?? DEFAULT_OPTIONS.aliases,
    keepEmoji: pick(undefined, config.keepEmoji, DEFAULT_OPTIONS.keepEmoji),
    // Actions, not preferences: a config file must not trigger a full rewrite.
    all: args.all ?? DEFAULT_OPTIONS.all,
    force: args.force ?? DEFAULT_OPTIONS.force,
    types: config.types?.length ? config.types : DEFAULT_OPTIONS.types,
    repoUrl: pick(args.repoUrl, config.repoUrl, DEFAULT_OPTIONS.repoUrl),
    linkReferences: pick(
      args.linkReferences,
      config.linkReferences,
      DEFAULT_OPTIONS.linkReferences,
    ),
    otherTitle: pick(undefined, config.otherTitle, DEFAULT_OPTIONS.otherTitle),
  };
}

function pick<T>(fromArgs: T | undefined, fromConfig: T | undefined | null, fallback: T): T {
  if (fromArgs !== undefined) return fromArgs;
  if (fromConfig !== undefined && fromConfig !== null) return fromConfig;
  return fallback;
}
