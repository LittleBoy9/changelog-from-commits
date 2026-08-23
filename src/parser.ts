import type { ParsedCommit, RawCommit, RevertTarget } from './types.js';

/**
 * An emoji or `:shortcode:` prefix, as gitmoji-style commits use.
 *
 * Conventional Commits has no room for this, but `✨ feat(auth): x` is a common
 * house style, and without handling it every commit in such a repo parses as
 * non-conventional and the changelog comes out empty.
 */
const EMOJI_PREFIX_RE =
  /^((?::[a-z0-9_+-]+:|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*)+)[ \t]+/u;

/**
 * Conventional Commits header: `type(scope)!: description`.
 *
 * The type is a noun, the scope is anything that is not a paren, and the `!`
 * marks a breaking change. Everything after `: ` is the description.
 */
const HEADER_RE = /^([a-zA-Z][a-zA-Z0-9_-]*)(?:\(([^()\r\n]+)\))?(!)?:[ \t]+(.+)$/;

/**
 * A `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer. The spec requires the token
 * to be uppercase, so this deliberately does not match `Breaking change:`.
 */
const BREAKING_FOOTER_RE = /^[ \t]*BREAKING[ -]CHANGE[ \t]*:[ \t]*([\s\S]*)$/m;

/**
 * Start of a new git trailer, which ends the preceding footer's text.
 *
 * Per the spec a footer token is separated from its value by either `: ` or
 * ` #`, so both `Co-authored-by: x` and `Closes #12` terminate the block.
 */
const FOOTER_TOKEN_RE = /^[A-Za-z][A-Za-z-]*(?:[ \t]*:[ \t]|[ \t]+#\d)/;

/** git's own revert subject, e.g. `Revert "feat: add thing"`. */
const REVERT_SUBJECT_RE = /^Revert\s+"(.+)"\s*$/;

/** git's own revert body line, e.g. `This reverts commit abc123.` */
const REVERT_BODY_RE = /\bThis reverts commit\s+([0-9a-f]{7,40})\b/i;

/** GitHub's squash-merge suffix, e.g. `feat: add thing (#42)`. */
const PR_SUFFIX_RE = /\s*\(#(\d+)\)\s*$/;

/** GitHub's merge commit subject, e.g. `Merge pull request #42 from user/branch`. */
const MERGE_PR_RE = /^Merge pull request #(\d+)\b/;

/** GitLab's merge commit subject, e.g. `Merge branch 'x' into 'main'` + `See merge request !42`. */
const MERGE_REQUEST_RE = /^See merge request .*!(\d+)\s*$/m;

/** `Closes #1`, `fixes #2, #3`, `Resolves: #4` — the common issue-closing footers. */
const REFERENCE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|ref|refs|references)\b[ \t:]*((?:#\d+[ \t]*,?[ \t]*)+)/gi;

/**
 * Parse one raw commit into its Conventional Commits parts.
 *
 * Commits whose subject does not match the header grammar are still returned,
 * with `isConventional: false` and `type: null`, so callers can decide whether
 * to keep them.
 */
export function parseCommit(raw: RawCommit): ParsedCommit {
  const prFromMerge = matchPrFromMerge(raw);

  const emojiMatch = EMOJI_PREFIX_RE.exec(raw.subject);
  const emoji = emojiMatch ? emojiMatch[1]!.trim() : null;
  const subject = emojiMatch ? raw.subject.slice(emojiMatch[0].length) : raw.subject;

  const header = HEADER_RE.exec(subject);

  if (!header) {
    const revertOf = parseRevert(raw, null);
    return {
      ...raw,
      type: null,
      scope: null,
      // `Revert "feat: x"` reads better as `feat: x` under a Reverts heading,
      // and matches how a conventional `revert: feat: x` renders.
      description: revertOf?.subject ?? raw.subject.trim(),
      breaking: false,
      breakingDescription: null,
      pr: prFromMerge,
      references: parseReferences(raw.body),
      isConventional: false,
      emoji,
      revertOf,
    };
  }

  const [, type, scope, bang, rest] = header;
  const prSuffix = PR_SUFFIX_RE.exec(rest!);
  const description = prSuffix ? rest!.slice(0, prSuffix.index).trim() : rest!.trim();

  const footer = BREAKING_FOOTER_RE.exec(raw.body);
  const breakingDescription = footer ? normalizeFooterText(footer[1]!) : null;
  const breaking = Boolean(bang) || breakingDescription !== null;

  return {
    ...raw,
    type: type!.toLowerCase(),
    scope: scope ? scope.trim() : null,
    description,
    breaking,
    // `feat!: x` with no footer still deserves a breaking-changes entry, so fall
    // back to the description rather than rendering an empty bullet.
    breakingDescription: breaking ? (breakingDescription ?? description) : null,
    pr: prSuffix ? Number(prSuffix[1]) : prFromMerge,
    references: parseReferences(raw.body),
    isConventional: true,
    emoji,
    revertOf: parseRevert(raw, type!.toLowerCase() === 'revert' ? description : null),
  };
}

/** Parse many commits at once. */
export function parseCommits(raws: RawCommit[]): ParsedCommit[] {
  return raws.map(parseCommit);
}

/**
 * A `BREAKING CHANGE:` footer runs until the next footer token or the end of the
 * message, so trailing footers like `Co-authored-by:` are stripped here.
 */
function normalizeFooterText(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    if (kept.length > 0 && FOOTER_TOKEN_RE.test(line)) break;
    if (kept.length > 0 && /^BREAKING[ -]CHANGE/.test(line)) break;
    kept.push(line);
  }

  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function matchPrFromMerge(raw: RawCommit): number | null {
  const github = MERGE_PR_RE.exec(raw.subject);
  if (github) return Number(github[1]);

  const gitlab = MERGE_REQUEST_RE.exec(raw.body);
  if (gitlab) return Number(gitlab[1]);

  return null;
}

/**
 * Work out what a commit reverts, if anything.
 *
 * Three shapes are recognized: a conventional `revert: <original subject>`
 * header, git's own `Revert "<original subject>"` subject, and the
 * `This reverts commit <sha>.` line git adds to the body. The hash is the
 * reliable signal; the subject is the fallback for hand-written reverts.
 */
function parseRevert(raw: RawCommit, conventionalSubject: string | null): RevertTarget | null {
  const bodyMatch = REVERT_BODY_RE.exec(raw.body);
  const subjectMatch = REVERT_SUBJECT_RE.exec(raw.subject);
  const subject = conventionalSubject ?? subjectMatch?.[1]?.trim() ?? null;

  if (!bodyMatch && !subject) return null;

  return { hash: bodyMatch ? bodyMatch[1]!.toLowerCase() : null, subject };
}

function parseReferences(body: string): number[] {
  const found = new Set<number>();
  // `lastIndex` is shared state on a module-level global regex, so reset it.
  REFERENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(body)) !== null) {
    for (const num of match[1]!.matchAll(/#(\d+)/g)) {
      found.add(Number(num[1]));
    }
  }

  return [...found].sort((a, b) => a - b);
}
