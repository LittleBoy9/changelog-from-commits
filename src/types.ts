/** A commit as read from `git log`, before any Conventional Commits parsing. */
export interface RawCommit {
  /** Full 40-character SHA. */
  hash: string;
  /** Abbreviated SHA, as git chose to abbreviate it. */
  shortHash: string;
  authorName: string;
  authorEmail: string;
  /** Author date, ISO 8601 (strict). */
  date: string;
  /** First line of the commit message. */
  subject: string;
  /** Everything after the subject line, trimmed. May be empty. */
  body: string;
  /** True when the commit has more than one parent. */
  isMerge: boolean;
}

/** A commit after Conventional Commits parsing. */
export interface ParsedCommit extends RawCommit {
  /**
   * The conventional type, lowercased (`feat`, `fix`, ...), or `null` when the
   * subject did not match the Conventional Commits header grammar.
   */
  type: string | null;
  /** The scope inside parentheses, or `null` when the commit had no scope. */
  scope: string | null;
  /** The header description, with any trailing `(#123)` PR suffix removed. */
  description: string;
  /** True when the header used `!` or the body carried a `BREAKING CHANGE:` footer. */
  breaking: boolean;
  /**
   * The text following a `BREAKING CHANGE:` footer. When a commit is marked
   * breaking with `!` and carries no footer, this falls back to `description`.
   */
  breakingDescription: string | null;
  /** Pull request number, from a `(#123)` subject suffix or a merge subject. */
  pr: number | null;
  /** Issue numbers from `Closes #1, Fixes #2` style footers. */
  references: number[];
  /** Whether the header matched the Conventional Commits grammar. */
  isConventional: boolean;
  /**
   * A gitmoji-style prefix stripped from the subject before parsing, such as
   * `✨` or `:sparkles:`. `null` when the subject had none.
   */
  emoji: string | null;
  /**
   * Set when this commit reverts another one, from either a `revert:` type, a
   * `Revert "..."` subject, or a `This reverts commit <sha>.` body.
   */
  revertOf: RevertTarget | null;
}

/** What a revert commit points back at. Either field may be unknown. */
export interface RevertTarget {
  /** SHA from a `This reverts commit <sha>.` body. */
  hash: string | null;
  /** The reverted commit's original subject line. */
  subject: string | null;
}

/** Commits of a single type, ready to render as one section. */
export interface CommitGroup {
  /** The conventional type this group was built from. */
  type: string;
  /** Human-readable section heading, e.g. `Bug Fixes`. */
  title: string;
  commits: ParsedCommit[];
}

/** Everything the renderer needs to emit one release section. */
export interface ChangelogContext {
  /** Version heading text, e.g. `1.4.0` or `Unreleased`. */
  version: string;
  /** Release date as `YYYY-MM-DD`. */
  date: string;
  groups: CommitGroup[];
  breaking: ParsedCommit[];
  /** Resolved links for the host, or `null` when no remote could be detected. */
  links: RepoLinks | null;
  /** Ref the range started at, used to build a compare link. */
  previousTag: string | null;
  /** Ref the range ended at, used to build a compare link. */
  currentTag: string | null;
}

/** URL builders for the detected git host. */
export interface RepoLinks {
  /** Web URL of the repository root, without a trailing slash. */
  repoUrl: string;
  host: 'github' | 'gitlab' | 'bitbucket' | 'unknown';
  commit(hash: string): string;
  pull(number: number): string;
  issue(number: number): string;
  compare(from: string, to: string): string;
}

/** Type ordering and section titles for the renderer. */
export interface TypeConfig {
  type: string;
  title: string;
  /** When true, commits of this type are parsed but not rendered. */
  hidden?: boolean;
}

/** Fully resolved options, after merging defaults, config file, and CLI flags. */
export interface ResolvedOptions {
  cwd: string;
  from: string | null;
  to: string;
  output: string;
  dryRun: boolean;
  version: string | null;
  tagPrefix: string;
  includeAll: boolean;
  /** Only include commits touching these paths. Empty means the whole repo. */
  paths: string[];
  /** Drop a revert and its original when both fall inside the range. */
  pairReverts: boolean;
  /**
   * How prerelease tags affect the range start.
   *
   * `auto` starts from the last stable tag when the target version is stable,
   * and from the nearest tag of any kind when the target is itself a
   * prerelease. `skip` always ignores prerelease tags; `include` restores the
   * plain `git describe` behavior.
   */
  prereleaseTags: 'auto' | 'skip' | 'include';
  /** Append `closes #12` from issue footers. */
  showReferences: boolean;
  /** Extra type spellings folded onto canonical types, over the defaults. */
  aliases: Record<string, string>;
  /** Keep a gitmoji prefix at the front of each entry. */
  keepEmoji: boolean;
  /** Regenerate a section for every tag instead of one release. */
  all: boolean;
  /** Allow `--all` to overwrite a non-empty changelog. */
  force: boolean;
  types: TypeConfig[];
  repoUrl: string | null;
  linkReferences: boolean;
  /** Heading used for the "Other Changes" section under `--include-all`. */
  otherTitle: string;
}

/** The subset of options a config file may set. */
export type ChangelogConfig = Partial<
  Pick<
    ResolvedOptions,
    | 'from'
    | 'to'
    | 'output'
    | 'version'
    | 'tagPrefix'
    | 'includeAll'
    | 'paths'
    | 'pairReverts'
    | 'prereleaseTags'
    | 'showReferences'
    | 'aliases'
    | 'keepEmoji'
    | 'types'
    | 'repoUrl'
    | 'linkReferences'
    | 'otherTitle'
  >
>;
