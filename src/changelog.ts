import { readFileSync } from 'node:fs';
import { dirname, join, parse as parsePath } from 'node:path';
import {
  buildLinks,
  detectRepoUrl,
  getCommits,
  getLastTag,
  hasCommits,
  isGitRepo,
  listTags,
  resolveRef,
} from './git.js';
import { parseCommits } from './parser.js';
import { applyReverts, collectBreaking, groupCommits, renderRelease } from './render.js';
import type { ChangelogContext, ParsedCommit, ResolvedOptions } from './types.js';

/** Default header written at the top of a brand new changelog file. */
export const CHANGELOG_HEADER = [
  '# Changelog',
  '',
  'All notable changes to this project are documented in this file.',
  '',
  'This project adheres to [Conventional Commits](https://www.conventionalcommits.org)',
  'and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
].join('\n');

export interface GenerateResult {
  /** The rendered release section, ending in a newline. */
  section: string;
  context: ChangelogContext;
  /** Every commit in range, including ones that were filtered out. */
  commits: ParsedCommit[];
  /** Non-conventional commits that were dropped (empty when `includeAll`). */
  skipped: ParsedCommit[];
  /** Revert/original pairs that cancelled out and were both removed. */
  revertedPairs: { revert: ParsedCommit; reverted: ParsedCommit }[];
  /** The range actually used, for reporting. */
  range: { from: string | null; to: string };
}

/**
 * Read the commit range, parse it, and render a single release section.
 *
 * This does no file I/O beyond reading `package.json` for a version fallback —
 * writing is `applyToChangelog` plus the caller.
 */
export function generateChangelog(options: ResolvedOptions): GenerateResult {
  const { cwd } = options;

  assertUsableRepo(cwd);

  const from = resolveFrom(options);
  const to = options.to;

  if (!resolveRef(cwd, to)) {
    throw new Error(`Unknown git ref: ${to}`);
  }
  if (from && !resolveRef(cwd, from)) {
    throw new Error(`Unknown git ref: ${from}`);
  }

  return buildRelease(options, { from, to, version: resolveVersion(options) });
}

interface ExplicitRange {
  /** `null` means walk back to the first commit — not "resolve a tag for me". */
  from: string | null;
  to: string;
  version: string;
}

/**
 * Render one release over an already-decided range.
 *
 * Range resolution is deliberately the caller's job: a backfill knows exactly
 * which tag pair it wants, and must not have `from: null` re-interpreted as
 * "look up the latest tag".
 */
function buildRelease(options: ResolvedOptions, range: ExplicitRange): GenerateResult {
  const { cwd } = options;
  const { from, to, version } = range;

  const commits = parseCommits(getCommits(cwd, { from, to, paths: options.paths }));

  // Reverts cancel before grouping, so a reverted feature never reaches a section.
  const pairing = options.pairReverts
    ? applyReverts(commits)
    : { commits, pairs: [] as GenerateResult['revertedPairs'] };
  const effective = pairing.commits;

  const groups = groupCommits(effective, {
    types: options.types,
    includeAll: options.includeAll,
    otherTitle: options.otherTitle,
    aliases: options.aliases,
  });

  const repoUrl = options.repoUrl ?? detectRepoUrl(cwd);
  const context: ChangelogContext = {
    version,
    date: today(commits),
    groups,
    breaking: collectBreaking(effective),
    links: repoUrl ? buildLinks(repoUrl) : null,
    previousTag: from,
    currentTag: resolveCurrentTag(options, to, version),
  };

  return {
    section: renderRelease(context, {
      linkReferences: options.linkReferences,
      showReferences: options.showReferences,
      keepEmoji: options.keepEmoji,
    }),
    context,
    commits,
    skipped: options.includeAll ? [] : effective.filter((c) => !c.isConventional && !c.isMerge),
    revertedPairs: pairing.pairs,
    range: { from, to },
  };
}

function assertUsableRepo(cwd: string): void {
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  if (!hasCommits(cwd)) {
    throw new Error('This repository has no commits yet.');
  }
}

/** The lower bound of the range: explicit `--from`, else the last matching tag. */
function resolveFrom(options: ResolvedOptions): string | null {
  if (options.from) return options.from;

  const tag = getLastTag(options.cwd, options.tagPrefix, options.to, {
    excludePrerelease: shouldSkipPrereleaseTags(options),
  });

  // Only prerelease tags exist, so there is no stable point to start from and
  // the full history is the honest answer.
  return tag;
}

/**
 * Whether prerelease tags should be ignored when picking the range start.
 *
 * Releasing 1.1.0 after tagging 1.1.0-beta.1 must still describe everything that
 * went into the beta, otherwise those commits are silently lost. But a changelog
 * *for* 1.1.0-beta.2 should start at beta.1, not at the last stable release.
 */
function shouldSkipPrereleaseTags(options: ResolvedOptions): boolean {
  if (options.prereleaseTags === 'skip') return true;
  if (options.prereleaseTags === 'include') return false;
  return !isPrerelease(resolveVersion(options));
}

/**
 * True for a semver version carrying a prerelease identifier.
 *
 * Build metadata (`+build.1`) is not a prerelease, so anything after a `+` is
 * ignored before looking for the `-`.
 */
export function isPrerelease(version: string): boolean {
  const core = version.split('+')[0]!;
  return /-/.test(core.replace(/^[^0-9]*/, ''));
}

/**
 * The upper bound as a tag name, for the compare link.
 *
 * When `--to` is already a tag we use it directly; otherwise we prefer the
 * version heading (as a tag name) since that is the tag the user is about to
 * create. Falls back to the raw ref.
 */
function resolveCurrentTag(
  options: ResolvedOptions,
  to: string,
  version: string,
): string | null {
  if (to !== 'HEAD') return to;
  // `Unreleased` is not a tag, and `vUnreleased` is not a URL anyone can follow.
  return isVersionLike(version) ? `${options.tagPrefix}${version}` : null;
}

/** Loose semver check — enough to know whether a heading names a real tag. */
function isVersionLike(version: string): boolean {
  return /^\d+\.\d+/.test(version);
}

/** `--version`, else the nearest package.json version, else `Unreleased`. */
function resolveVersion(options: ResolvedOptions): string {
  if (options.version) return options.version;
  return readPackageVersion(options.cwd) ?? 'Unreleased';
}

/** Walk up from `cwd` looking for a package.json with a version field. */
export function readPackageVersion(cwd: string): string | null {
  let dir = cwd;

  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        version?: unknown;
      };
      if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
    } catch {
      // Missing or malformed package.json — keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir || dir === parsePath(dir).root) return null;
    dir = parent;
  }
}

/** Date for the heading: the newest commit's date, falling back to today. */
function today(commits: ParsedCommit[]): string {
  const newest = commits[0]?.date;
  const date = newest ? new Date(newest) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/**
 * Splice a new release section into an existing changelog.
 *
 * The section goes after the file's preamble (title and any prose) but before
 * the first existing release heading, so the newest release stays on top.
 * When `existing` is empty, a standard header is written first.
 */
export function applyToChangelog(existing: string | null, section: string): string {
  const body = section.trimEnd();

  if (!existing || !existing.trim()) {
    return `${CHANGELOG_HEADER}\n\n${body}\n`;
  }

  const normalized = existing.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstRelease = lines.findIndex((line) => /^##\s/.test(line));

  if (firstRelease === -1) {
    return `${normalized.trimEnd()}\n\n${body}\n`;
  }

  const preamble = lines.slice(0, firstRelease).join('\n').trimEnd();
  const rest = lines.slice(firstRelease).join('\n').trimStart();

  // A file that opens straight into a release heading has no preamble, and must
  // not gain leading blank lines.
  const head = preamble ? `${preamble}\n\n` : '';

  return `${head}${body}\n\n${rest.trimEnd()}\n`;
}

/** True when the changelog already contains a heading for this version. */
export function hasVersionHeading(existing: string | null, version: string): boolean {
  if (!existing) return false;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `$` so a heading with no trailing newline at end of file still counts.
  return new RegExp(`^##\\s+\\[?${escaped}\\]?(?:[\\s(]|$)`, 'm').test(existing);
}

export interface GenerateAllResult {
  /** One rendered section per release, newest first. */
  sections: string[];
  /** The full document, header included. */
  document: string;
  /** Versions rendered, newest first. */
  versions: string[];
}

/**
 * Rebuild a changelog covering every tag in the history.
 *
 * Walks consecutive tag pairs oldest-to-newest and renders a section for each,
 * plus a leading section for anything committed after the newest tag. This is
 * what makes the tool adoptable on a repository that already has releases.
 */
export function generateAll(options: ResolvedOptions): GenerateAllResult {
  const { cwd } = options;

  assertUsableRepo(cwd);

  if (!resolveRef(cwd, options.to)) {
    throw new Error(`Unknown git ref: ${options.to}`);
  }

  const tags = listTags(cwd, options.tagPrefix, options.to);
  const sections: string[] = [];
  const versions: string[] = [];

  /** Render one range, dropping releases that turned out to have nothing in them. */
  const push = (from: string | null, to: string, version: string): void => {
    const result = buildRelease(options, { from, to, version });
    if (result.context.groups.length === 0 && result.context.breaking.length === 0) return;
    sections.push(result.section);
    versions.push(result.context.version);
  };

  // Newest first: anything after the last tag, then each tag pair walking back.
  const newest = tags.at(-1);
  if (newest) {
    push(newest, options.to, options.version ?? 'Unreleased');
  }

  for (let i = tags.length - 1; i >= 0; i--) {
    push(i > 0 ? tags[i - 1]! : null, tags[i]!, stripTagPrefix(tags[i]!, options.tagPrefix));
  }

  if (tags.length === 0) {
    // Never tagged, so the whole history is a single unreleased section.
    push(null, options.to, options.version ?? 'Unreleased');
  }

  const document = `${CHANGELOG_HEADER}\n\n${sections.join('\n').trimEnd()}\n`;
  return { sections, document, versions };
}

/** `web-v1.2.0` -> `1.2.0`. Leaves a tag alone when it lacks the prefix. */
export function stripTagPrefix(tag: string, tagPrefix: string): string {
  return tagPrefix && tag.startsWith(tagPrefix) ? tag.slice(tagPrefix.length) : tag;
}
