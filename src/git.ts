import { execFileSync } from 'node:child_process';
import type { RawCommit, RepoLinks } from './types.js';

/** Unit separator between fields, record separator between commits. */
const FIELD = '\x1f';
const RECORD = '\x1e';

/** Field order must stay in sync with `parseLogRecord`. */
export const LOG_FORMAT = [
  '%H', // full hash
  '%h', // abbreviated hash
  '%an', // author name
  '%ae', // author email
  '%aI', // author date, strict ISO 8601
  '%P', // parent hashes, space separated
  '%s', // subject
  '%b', // body
].join(FIELD) + RECORD;

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

/** Run a git command and return trimmed stdout. Throws `GitError` on failure. */
export function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      // Commit bodies in a large range can be many megabytes.
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new GitError(stderr || `git ${args.join(' ')} failed`);
  }
}

/** True when `cwd` is inside a git working tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
  } catch {
    return false;
  }
}

/** Absolute path to the repository root. */
export function getRepoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

/**
 * The most recent tag reachable from `ref`, optionally filtered by prefix.
 *
 * Uses `git describe` rather than `git tag --sort`, so that on a branch we get
 * the nearest *ancestor* tag instead of the newest tag in the whole repo.
 */
export function getLastTag(
  cwd: string,
  tagPrefix = '',
  ref = 'HEAD',
  options: { excludePrerelease?: boolean } = {},
): string | null {
  const args = ['describe', '--tags', '--abbrev=0'];
  if (tagPrefix) args.push('--match', `${tagPrefix}*`);
  // A semver prerelease always carries a hyphen after the version core, and the
  // prefix is included so a prefix that itself contains a hyphen (`web-v`) does
  // not exclude every one of its own stable tags.
  if (options.excludePrerelease) args.push('--exclude', `${tagPrefix}*-*`);
  args.push(ref);

  try {
    return git(args, cwd) || null;
  } catch {
    // No tags reachable from this ref — the caller should walk the full history.
    return null;
  }
}

/**
 * Every tag reachable from `ref`, oldest first.
 *
 * `--merged` keeps tags from other branches out, so a backfill only walks the
 * history that actually leads to `ref`.
 */
export function listTags(cwd: string, tagPrefix = '', ref = 'HEAD'): string[] {
  const args = ['tag', '--list', '--sort=creatordate', '--merged', ref];
  if (tagPrefix) args.push(`${tagPrefix}*`);

  try {
    return git(args, cwd).split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** True when the repository has at least one commit. */
export function hasCommits(cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', 'HEAD'], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a ref to a full SHA, or `null` when it does not exist. */
export function resolveRef(cwd: string, ref: string): string | null {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`], cwd);
  } catch {
    return null;
  }
}

export interface LogRange {
  /** Exclusive lower bound. When `null`, walks back to the first commit. */
  from?: string | null;
  /** Inclusive upper bound. Defaults to `HEAD`. */
  to?: string;
  /** Restrict to commits touching these paths. Empty or absent means all. */
  paths?: string[];
}

/** Read commits in `(from, to]` in reverse-chronological order. */
export function getCommits(cwd: string, range: LogRange = {}): RawCommit[] {
  const to = range.to ?? 'HEAD';
  const revs = range.from ? `${range.from}..${to}` : to;

  const args = ['log', `--format=${LOG_FORMAT}`, '--no-color', revs];
  // `--` keeps git from mistaking a path for a ref.
  if (range.paths?.length) args.push('--', ...range.paths);

  return parseLog(git(args, cwd));
}

/**
 * Parse raw `git log --format=LOG_FORMAT` output into commits.
 *
 * Exported so tests can feed in captured log output without a real repository.
 */
export function parseLog(output: string): RawCommit[] {
  if (!output.trim()) return [];

  return output
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map(parseLogRecord);
}

function parseLogRecord(record: string): RawCommit {
  const [hash, shortHash, authorName, authorEmail, date, parents, subject, ...bodyParts] =
    record.split(FIELD);

  return {
    hash: hash ?? '',
    shortHash: shortHash ?? '',
    authorName: authorName ?? '',
    authorEmail: authorEmail ?? '',
    date: date ?? '',
    subject: (subject ?? '').trim(),
    // A body containing \x1f would otherwise be truncated, so rejoin the tail.
    body: bodyParts.join(FIELD).trim(),
    isMerge: (parents ?? '').trim().split(/\s+/).filter(Boolean).length > 1,
  };
}

/** Raw `remote.origin.url`, or `null` when there is no origin. */
export function getRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return git(['config', '--get', `remote.${remote}.url`], cwd) || null;
  } catch {
    return null;
  }
}

/**
 * Normalize any git remote URL to an https web URL.
 *
 * Handles `git@host:owner/repo.git`, `ssh://git@host/owner/repo.git`,
 * `https://user:token@host/owner/repo.git` and plain https.
 */
export function normalizeRemoteUrl(remote: string): string | null {
  const trimmed = remote.trim();
  if (!trimmed) return null;

  // scp-style: git@github.com:owner/repo.git
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+?)(?:\.git)?\/?$/.exec(trimmed);
  if (scp) return `https://${scp[1]}/${stripGit(scp[2]!)}`;

  try {
    const url = new URL(trimmed);
    const host = url.host;
    const path = stripGit(url.pathname.replace(/^\/+/, ''));
    if (!host || !path) return null;
    return `https://${host}/${path}`;
  } catch {
    return null;
  }
}

function stripGit(path: string): string {
  return path.replace(/\.git$/, '').replace(/\/+$/, '');
}

/** Build host-aware URL builders for a repository web URL. */
export function buildLinks(repoUrl: string): RepoLinks {
  const base = repoUrl.replace(/\/+$/, '');
  const host = detectHost(base);

  switch (host) {
    case 'gitlab':
      return {
        repoUrl: base,
        host,
        commit: (hash) => `${base}/-/commit/${hash}`,
        pull: (n) => `${base}/-/merge_requests/${n}`,
        issue: (n) => `${base}/-/issues/${n}`,
        compare: (from, to) => `${base}/-/compare/${from}...${to}`,
      };
    case 'bitbucket':
      return {
        repoUrl: base,
        host,
        commit: (hash) => `${base}/commits/${hash}`,
        pull: (n) => `${base}/pull-requests/${n}`,
        issue: (n) => `${base}/issues/${n}`,
        compare: (from, to) => `${base}/branches/compare/${to}%0D${from}`,
      };
    default:
      // GitHub's URL shape is also what most self-hosted forges (Gitea, Forgejo)
      // use, so it is the safest fallback for an unknown host.
      return {
        repoUrl: base,
        host,
        commit: (hash) => `${base}/commit/${hash}`,
        pull: (n) => `${base}/pull/${n}`,
        issue: (n) => `${base}/issues/${n}`,
        compare: (from, to) => `${base}/compare/${from}...${to}`,
      };
  }
}

function detectHost(repoUrl: string): RepoLinks['host'] {
  const host = safeHost(repoUrl);
  if (!host) return 'unknown';
  if (host.includes('github')) return 'github';
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('bitbucket')) return 'bitbucket';
  return 'unknown';
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Detect the repository's web URL from its origin remote. */
export function detectRepoUrl(cwd: string): string | null {
  const remote = getRemoteUrl(cwd);
  return remote ? normalizeRemoteUrl(remote) : null;
}
