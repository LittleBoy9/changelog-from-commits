# changelog-from-commits

Generate a polished `CHANGELOG.md` from your git history, following the
[Conventional Commits](https://www.conventionalcommits.org) spec.

Zero config, **zero runtime dependencies**.

```bash
npx changelog-from-commits
```

That reads every commit since your last git tag, groups them by type, links each
entry to its PR or commit, and prepends a new release section to `CHANGELOG.md`.

## Example output

```markdown
## [1.4.0](https://github.com/acme/widgets/compare/v1.3.0...v1.4.0) (2026-08-21)

### ⚠ BREAKING CHANGES

* **auth:** `login()` returns a Promise<Token> instead of writing a cookie. ([#142](https://github.com/acme/widgets/pull/142))

### Features

* **auth:** replace session cookies with JWT ([#142](https://github.com/acme/widgets/pull/142))
* **cli:** add --tag-prefix flag ([#140](https://github.com/acme/widgets/pull/140))

### Bug Fixes

* **parser:** handle commits with an empty body ([2c8f1b7](https://github.com/acme/widgets/commit/2c8f1b7))
```

## Install

Use it ad hoc with `npx`, or add it to your release script:

```bash
npm install --save-dev changelog-from-commits
```

```json
{
  "scripts": {
    "release": "npm version minor && changelog-from-commits --tag-prefix v"
  }
}
```

Requires Node 18 or newer, and `git` on your `PATH`.

## CLI

```
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
```

> **Note on `--version`.** It sets the version *heading*, as listed in the spec
> for this tool. The tool's own version is `--cli-version` / `-v`.

### Examples

```bash
# Everything since the last tag, written to CHANGELOG.md
npx changelog-from-commits

# Adopt the tool on an existing repo: backfill every past release
npx changelog-from-commits --all --tag-prefix v --dry-run
npx changelog-from-commits --all --tag-prefix v

# Preview a release without touching any file
npx changelog-from-commits --version 1.4.0 --dry-run

# Regenerate the notes for one historical release
npx changelog-from-commits --from v1.2.0 --to v1.3.0 --version 1.3.0 --dry-run

# A monorepo package whose tags look like `web-v1.2.0`
npx changelog-from-commits \
  --tag-prefix web-v \
  --path packages/web \
  --output packages/web/CHANGELOG.md
```

### Backfilling an existing repository

`--all` rebuilds the entire changelog, emitting one section per tag plus an
`Unreleased` section for anything after the newest tag. This is how you adopt the
tool on a repo that already has releases, instead of hand-computing
`--from`/`--to`/`--version` for every past version.

Because it replaces the file rather than prepending to it, `--all` refuses to
overwrite a non-empty changelog unless you pass `--force`. Preview with
`--dry-run` first.

Releases that would render empty (only hidden `chore`/`style` commits, say) are
skipped rather than emitted as empty sections.

### Monorepos

`--tag-prefix` and `--path` do two different jobs and you usually want both:

- `--tag-prefix web-v` scopes the *range* — the changelog starts at the last
  `web-v*` tag rather than whatever tag happens to be newest.
- `--path packages/web` scopes the *commits* — only commits that touched that
  directory are included.

Without `--path`, a package's changelog lists every commit in the repo since its
last tag, including other packages' work.

## How it works

**Range.** By default the range is `<last tag>..HEAD`, resolved with
`git describe --tags --abbrev=0`, so on a branch you get the nearest *ancestor*
tag rather than the newest tag in the repo. With no tags at all, it walks the
entire history. `--from` and `--to` override this.

**Version heading.** `--version` wins; otherwise the `version` field from the
nearest `package.json`; otherwise `Unreleased`.

**Prereleases.** By default (`--prerelease-tags auto`), a *stable* release starts
from the last *stable* tag, so releasing `1.1.0` after tagging `1.1.0-beta.1`
still describes everything that went into the beta. A *prerelease* target starts
from the nearest tag of any kind, so `1.1.0-beta.2` covers only what changed
since `beta.1`. Use `skip` to always ignore prerelease tags, or `include` to
start from whatever tag is nearest.

**Issue references.** `Closes #12` / `Fixes #3` footers are appended to the entry
as `, closes [#12](...)`. The PR number is not repeated when it is also listed as
a reference. Turn the whole thing off with `--no-references`.

**Links.** The repository URL is detected from your `origin` remote, and
scp-style (`git@host:owner/repo.git`), `ssh://`, and `https://` remotes are all
understood. GitHub, GitLab, and Bitbucket URL shapes are built correctly;
anything else falls back to the GitHub shape, which most self-hosted forges use.
Each entry links to its PR when one is known, and to the commit otherwise.
Override with `--repo-url`, or turn links off with `--no-links`.

**PR detection.** A trailing `(#123)` in the subject (how GitHub writes squash
merges) and `Merge pull request #123` / `See merge request !123` subjects are all
recognized.

**Breaking changes.** Both `feat!:` and a `BREAKING CHANGE:` footer are detected.
Breaking commits appear twice on purpose: once in the prominent
`⚠ BREAKING CHANGES` section at the top — using the footer text when there is one,
since that is where the migration note lives — and once in their own type section.

**Merge commits** are always dropped; the commits they bring in are already
listed.

**Reverts are paired off.** If a commit and its revert are both in the range, the
feature never shipped, so both are removed rather than listed as a Feature and a
Revert. Matching prefers the `This reverts commit <sha>` line git writes, and
falls back to the original subject for hand-written `revert:` commits. When the
original was released earlier and only the revert is in range, the revert is kept
and appears under Reverts. `git revert`'s own `Revert "..."` subject is
recognized too, even though it is not Conventional Commits syntax. Set
`pairReverts: false` in a config file to list both sides instead.

**Gitmoji is understood.** A leading emoji or `:shortcode:` — `✨ feat(auth): add
OAuth`, `:sparkles: feat: ...` — is stripped before parsing, so a repo that
prefixes every commit still gets a full changelog instead of an empty one. Set
`keepEmoji: true` in a config file to keep the emoji at the front of each entry.

**Type spellings are folded.** `feature:` groups with `feat:`, `bugfix:` with
`fix:`, and so on, so a repo that mixes conventions does not end up with
"Features" and "Feature" as separate sections. Extend or override with `aliases`.

**Non-conventional commits** (`wip`, `fixed stuff`) are skipped, and the CLI
reports how many it dropped. Pass `--include-all` to collect them into an
"Other Changes" section instead.

**Writing.** Without `--all`, a new section is spliced in *after* the file's preamble and *before*
the newest existing release, so the file stays newest-first and your header prose
survives. If a heading for that version already exists, nothing is written and the
command exits non-zero.

## Sections

| Type | Section |
| --- | --- |
| `feat` | Features |
| `fix` | Bug Fixes |
| `perf` | Performance Improvements |
| `revert` | Reverts |
| `refactor` | Code Refactoring |
| `docs` | Documentation |
| `build` | Build System |
| `ci` | Continuous Integration |
| `test` | Tests |
| `style` | *hidden by default* |
| `chore` | *hidden by default* |

Common alternate spellings (`feature`, `bugfix`, `doc`, `tests`, `performance`, …)
are folded onto the canonical type automatically. Any other conventional type gets
its own section, titled from the type itself, so nothing is silently lost. Override the whole table with `types` in a config file.

## Configuration

Optional. A config file is searched for upward from the working directory, in
this order:

```
changelog.config.js    changelog.config.mjs    changelog.config.cjs
changelog.config.json  .changelogrc.js         .changelogrc.mjs
.changelogrc.cjs       .changelogrc.json       .changelogrc
```

**CLI flags always win over config file values.** `--dry-run`, `--all`, and
`--force` are flag-only by design — a config file that silently suppressed writes,
or triggered a full rewrite, would be a trap.

```js
// changelog.config.js
module.exports = {
  tagPrefix: 'v',
  output: 'CHANGELOG.md',
  includeAll: false,
  paths: [],
  pairReverts: true,
  prereleaseTags: 'auto',
  showReferences: true,
  keepEmoji: false,
  aliases: { enhancement: 'feat' },
  linkReferences: true,
  otherTitle: 'Other Changes',
  types: [
    { type: 'feat', title: '🚀 Features' },
    { type: 'fix', title: '🐛 Bug Fixes' },
    { type: 'perf', title: '⚡ Performance' },
    { type: 'chore', title: 'Chores', hidden: true },
  ],
};
```

ESM and a function export both work:

```js
// changelog.config.mjs
export default () => ({ tagPrefix: `v`, output: 'docs/CHANGELOG.md' });
```

| Key | Type | Default |
| --- | --- | --- |
| `from` | `string` | last git tag |
| `to` | `string` | `"HEAD"` |
| `output` | `string` | `"CHANGELOG.md"` |
| `version` | `string` | package.json version, else `"Unreleased"` |
| `tagPrefix` | `string` | `""` |
| `includeAll` | `boolean` | `false` |
| `paths` | `string[]` | `[]` (whole repo) |
| `pairReverts` | `boolean` | `true` |
| `prereleaseTags` | `'auto' \| 'skip' \| 'include'` | `'auto'` |
| `showReferences` | `boolean` | `true` |
| `aliases` | `Record<string, string>` | common spellings (see above) |
| `keepEmoji` | `boolean` | `false` |
| `linkReferences` | `boolean` | `true` |
| `repoUrl` | `string` | detected from `origin` |
| `otherTitle` | `string` | `"Other Changes"` |
| `types` | `{ type, title?, hidden? }[]` | see table above |

## Programmatic API

The package ships CommonJS, ESM, and type declarations.

```ts
import { generateChangelog, generateAll, resolveOptions, applyToChangelog } from 'changelog-from-commits';

const result = generateChangelog(resolveOptions({ positionals: [], cwd: process.cwd() }));

console.log(result.section);        // the rendered markdown
console.log(result.context.groups); // grouped commits
console.log(result.skipped);        // non-conventional commits that were dropped

const updated = applyToChangelog(existingMarkdown, result.section);

// Or rebuild the whole file from every tag:
const { document, versions } = generateAll(resolveOptions({ positionals: [], cwd: process.cwd() }));
```

The lower-level pieces are exported too, if you want to render your own format:

```ts
import { parseCommit, parseLog, groupCommits, collectBreaking, applyReverts, buildLinks } from 'changelog-from-commits';

const commits = parseLog(rawGitLogOutput).map(parseCommit);
const { commits: effective, pairs } = applyReverts(commits);
const groups = groupCommits(effective, { includeAll: true });
const breaking = collectBreaking(effective);
```

## Design notes

- **No runtime dependencies.** `git log` is invoked directly through
  `child_process` with a `\x1f`/`\x1e` delimited `--pretty` format. `simple-git`
  would shell out to the same command while adding a dependency tree.
- **The arg parser is hand-rolled** (~130 lines) and knows every flag up front,
  so a typo is an error instead of a silently ignored argument.
- **Exit codes** are `0` on success, `1` on any error — including a duplicate
  version heading — so it composes in release scripts.

## Development

```bash
npm install
npm test           # vitest, including real temp-repo integration suites
npm run test:coverage
npm run typecheck
npm run build      # tsup -> dist/ (CJS + ESM + .d.ts)
```

Tests cover the parser, renderer, arg parser, config loader, and file splicing as
units; `test/fixtures/` holds a captured `git log` and its expected changelog
output; and `test/integration.test.ts` builds a throwaway git repository and runs
the built CLI against it.

## License

MIT © Sounak Das
