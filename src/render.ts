import type {
  ChangelogContext,
  CommitGroup,
  ParsedCommit,
  RepoLinks,
  TypeConfig,
} from './types.js';

/**
 * Section titles and ordering, following the Angular convention.
 *
 * `chore` and `style` are parsed but hidden by default: they are almost always
 * noise in a user-facing changelog. Override with `types` in a config file.
 */
export const DEFAULT_TYPES: TypeConfig[] = [
  { type: 'feat', title: 'Features' },
  { type: 'fix', title: 'Bug Fixes' },
  { type: 'perf', title: 'Performance Improvements' },
  { type: 'revert', title: 'Reverts' },
  { type: 'refactor', title: 'Code Refactoring' },
  { type: 'docs', title: 'Documentation' },
  { type: 'build', title: 'Build System' },
  { type: 'ci', title: 'Continuous Integration' },
  { type: 'test', title: 'Tests' },
  { type: 'style', title: 'Styles', hidden: true },
  { type: 'chore', title: 'Chores', hidden: true },
];

/**
 * Common spellings folded onto their canonical type.
 *
 * Without this a repo that mixes `feat:` and `feature:` renders "Features" and
 * "Feature" as two separate sections for the same thing. Override or extend with
 * `aliases` in a config file.
 */
export const DEFAULT_ALIASES: Record<string, string> = {
  feature: 'feat',
  features: 'feat',
  bugfix: 'fix',
  bugfixes: 'fix',
  fixes: 'fix',
  hotfix: 'fix',
  doc: 'docs',
  documentation: 'docs',
  tests: 'test',
  testing: 'test',
  chores: 'chore',
  styles: 'style',
  refactoring: 'refactor',
  performance: 'perf',
};

/** The synthetic type used for non-conventional commits under `--include-all`. */
export const OTHER_TYPE = '__other__';

export interface GroupOptions {
  types?: TypeConfig[];
  /** Keep non-conventional commits in an "Other Changes" group. */
  includeAll?: boolean;
  otherTitle?: string;
  /** Extra type spellings to fold, merged over `DEFAULT_ALIASES`. */
  aliases?: Record<string, string>;
}

/**
 * Bucket commits into renderable sections.
 *
 * Merge commits are always dropped: their content is already represented by the
 * commits they bring in. Unknown-but-conventional types (`deps: ...`) get their
 * own section titled from the type itself, so nothing conventional is lost.
 */
export function groupCommits(commits: ParsedCommit[], options: GroupOptions = {}): CommitGroup[] {
  const types = options.types ?? DEFAULT_TYPES;
  const otherTitle = options.otherTitle ?? 'Other Changes';
  const configByType = new Map(types.map((t) => [t.type, t]));
  const aliases = { ...DEFAULT_ALIASES, ...options.aliases };

  const buckets = new Map<string, ParsedCommit[]>();
  const extraTypes: string[] = [];

  for (const commit of commits) {
    if (commit.isMerge) continue;

    if (!commit.isConventional) {
      // `git revert` writes `Revert "..."`, which is not Conventional Commits
      // syntax but is unambiguously a revert, and too notable to drop.
      if (commit.revertOf && !configByType.get('revert')?.hidden) {
        push(buckets, 'revert', commit);
        if (!configByType.has('revert') && !extraTypes.includes('revert')) {
          extraTypes.push('revert');
        }
        continue;
      }
      if (!options.includeAll) continue;
      push(buckets, OTHER_TYPE, commit);
      continue;
    }

    // The parsed type stays whatever the author wrote; only the bucket is folded.
    const type = aliases[commit.type!] ?? commit.type!;
    const config = configByType.get(type);
    if (config?.hidden) continue;
    if (!config && !extraTypes.includes(type)) extraTypes.push(type);
    push(buckets, type, commit);
  }

  const groups: CommitGroup[] = [];

  // Configured types first, in configured order, then anything unrecognized.
  for (const config of types) {
    const commitsOfType = buckets.get(config.type);
    if (config.hidden || !commitsOfType?.length) continue;
    groups.push({ type: config.type, title: config.title, commits: commitsOfType });
  }

  for (const type of extraTypes.sort()) {
    groups.push({ type, title: titleize(type), commits: buckets.get(type)! });
  }

  const other = buckets.get(OTHER_TYPE);
  if (other?.length) groups.push({ type: OTHER_TYPE, title: otherTitle, commits: other });

  return groups;
}

function push(buckets: Map<string, ParsedCommit[]>, key: string, commit: ParsedCommit): void {
  const existing = buckets.get(key);
  if (existing) existing.push(commit);
  else buckets.set(key, [commit]);
}

/** `deps-update` -> `Deps Update`, for conventional types we have no title for. */
function titleize(type: string): string {
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface RenderOptions {
  /** Render commit/PR links. Set false for a link-free changelog. */
  linkReferences?: boolean;
  /** Append `closes #12` from the commit's issue footers. Defaults to true. */
  showReferences?: boolean;
  /** Keep a gitmoji prefix at the front of the entry. Defaults to false. */
  keepEmoji?: boolean;
}

/**
 * Render one release section in the Angular / conventional-changelog format.
 *
 * The returned string has no leading blank line and ends with a single newline,
 * so sections concatenate cleanly.
 */
export function renderRelease(context: ChangelogContext, options: RenderOptions = {}): string {
  const linkReferences = options.linkReferences ?? true;
  const showReferences = options.showReferences ?? true;
  const keepEmoji = options.keepEmoji ?? false;
  const links = linkReferences ? context.links : null;
  const lines: string[] = [];

  lines.push(renderHeading(context, links));
  lines.push('');

  if (context.breaking.length > 0) {
    lines.push('### ⚠ BREAKING CHANGES');
    lines.push('');
    for (const commit of context.breaking) {
      lines.push(renderBreakingEntry(commit, links));
    }
    lines.push('');
  }

  for (const group of context.groups) {
    lines.push(`### ${group.title}`);
    lines.push('');
    for (const commit of group.commits) {
      lines.push(renderEntry(commit, links, showReferences, keepEmoji));
    }
    lines.push('');
  }

  if (context.breaking.length === 0 && context.groups.length === 0) {
    lines.push('_No notable changes._');
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderHeading(context: ChangelogContext, links: RepoLinks | null): string {
  const { version, date, previousTag, currentTag } = context;
  const canCompare = links && previousTag && currentTag;
  const title = canCompare
    ? `[${version}](${links.compare(previousTag, currentTag)})`
    : version;

  return date ? `## ${title} (${date})` : `## ${title}`;
}

function renderBreakingEntry(commit: ParsedCommit, links: RepoLinks | null): string {
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  const text = commit.breakingDescription ?? commit.description;
  const suffix = renderLinks(commit, links);
  return `* ${scope}${text}${suffix}`;
}

function renderEntry(
  commit: ParsedCommit,
  links: RepoLinks | null,
  showReferences: boolean,
  keepEmoji: boolean,
): string {
  const emoji = keepEmoji && commit.emoji ? `${commit.emoji} ` : '';
  const scope = commit.scope ? `**${commit.scope}:** ` : '';
  const suffix = renderLinks(commit, links);
  return `* ${emoji}${scope}${commit.description}${suffix}${renderReferences(commit, links, showReferences)}`;
}

/**
 * Trailing `closes #12` list from the commit's issue footers.
 *
 * The PR number is filtered out: when a commit says `Closes #142` and #142 is
 * also its pull request, repeating it adds nothing.
 */
function renderReferences(
  commit: ParsedCommit,
  links: RepoLinks | null,
  showReferences: boolean,
): string {
  if (!showReferences) return '';

  const issues = commit.references.filter((number) => number !== commit.pr);
  if (issues.length === 0) return '';

  const rendered = issues.map((number) =>
    links ? `[#${number}](${links.issue(number)})` : `#${number}`,
  );

  return `, closes ${rendered.join(' ')}`;
}

/**
 * Trailing reference for an entry: the PR when we know it, otherwise the commit.
 *
 * Preferring the PR keeps a squash-merged history readable — the PR page has the
 * discussion, the commit page just has the diff.
 */
function renderLinks(commit: ParsedCommit, links: RepoLinks | null): string {
  if (!links) {
    return commit.pr ? ` (#${commit.pr})` : ` (${commit.shortHash})`;
  }

  if (commit.pr) {
    return ` ([#${commit.pr}](${links.pull(commit.pr)}))`;
  }

  return ` ([${commit.shortHash}](${links.commit(commit.hash)}))`;
}

export interface RevertPairing {
  /** Commits left after reverted pairs were removed. */
  commits: ParsedCommit[];
  /** The pairs that cancelled out, for reporting. */
  pairs: { revert: ParsedCommit; reverted: ParsedCommit }[];
}

/**
 * Cancel out reverts whose original commit is also in the range.
 *
 * A feature added and then reverted before release never shipped, so listing it
 * under Features is simply wrong. When the original is *not* in range it was
 * released earlier, so the revert is kept and shows up under Reverts.
 *
 * Matching prefers the `This reverts commit <sha>` hash and falls back to the
 * original subject line, which is all a hand-written `revert:` commit gives us.
 */
export function applyReverts(commits: ParsedCommit[]): RevertPairing {
  const reverts = commits.filter((commit) => commit.revertOf);
  if (reverts.length === 0) return { commits, pairs: [] };

  const removed = new Set<ParsedCommit>();
  const pairs: RevertPairing['pairs'] = [];

  for (const revert of reverts) {
    if (removed.has(revert)) continue;

    const target = commits.find(
      (candidate) =>
        candidate !== revert && !removed.has(candidate) && matchesRevert(revert, candidate),
    );
    if (!target) continue;

    removed.add(revert);
    removed.add(target);
    pairs.push({ revert, reverted: target });
  }

  return { commits: commits.filter((commit) => !removed.has(commit)), pairs };
}

function matchesRevert(revert: ParsedCommit, candidate: ParsedCommit): boolean {
  const target = revert.revertOf!;

  if (target.hash) {
    const a = target.hash;
    const b = candidate.hash.toLowerCase();
    // One side may be abbreviated, so compare on the shorter length.
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }

  // Only fall back to subject matching when there is no hash to trust.
  if (!target.hash && target.subject) {
    return target.subject === candidate.subject;
  }

  return false;
}

/** Collect breaking commits in the order they should be listed. */
export function collectBreaking(commits: ParsedCommit[]): ParsedCommit[] {
  return commits.filter((commit) => commit.breaking && !commit.isMerge);
}
