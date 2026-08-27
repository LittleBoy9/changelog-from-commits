# changelog-from-commits

A zero-dependency CLI that generates a `CHANGELOG.md` from git history following
[Conventional Commits](https://www.conventionalcommits.org).

- **npm:** https://www.npmjs.com/package/changelog-from-commits
- **Docs/landing page:** https://littleboy9.github.io/changelog-from-commits/ (served from `index.html` at repo root)
- **Repo:** https://github.com/LittleBoy9/changelog-from-commits

## Commands

```bash
npm test              # vitest run — the full suite
npm run test:watch    # vitest in watch mode
npm run test:coverage # vitest + v8 coverage
npm run typecheck     # tsc --noEmit
npm run build         # tsup -> dist/ (CJS + ESM + .d.ts)
```

`prepublishOnly` runs typecheck + test + build, so a broken build cannot be published.

Run a single test file with `npx vitest run test/parser.test.ts`.

## Hard constraints

These are not preferences. Breaking one is a defect.

1. **Zero runtime dependencies.** `dependencies` in `package.json` must stay empty.
   `git log` is invoked directly via `node:child_process`; the argument parser is
   hand-rolled. Do not add `commander`, `simple-git`, `semver`, or anything else
   to `dependencies`. devDependencies are fine.
2. **Node >= 18**, CommonJS + ESM dual build, TypeScript declarations shipped.
3. **`strict` TypeScript** with `noUncheckedIndexedAccess`. Typecheck must pass.
4. The published tarball is limited by the `files` field to `dist`, `README.md`,
   `LICENSE`. Site files (`index.html`, `og-image.png`, `llms.txt`, `robots.txt`,
   `sitemap.xml`) live in the repo but must never ship to npm.

## Architecture

Data flows in one direction: **git → parse → group → render → write**.

| Module | Responsibility |
| --- | --- |
| `src/git.ts` | All `git` subprocess calls. `\x1f`-delimited `--pretty` format, tag lookup, remote URL normalization, per-host link builders. |
| `src/parser.ts` | `RawCommit` → `ParsedCommit`. Conventional Commits grammar, gitmoji prefix stripping, breaking-change detection, PR/issue extraction, revert targets. |
| `src/render.ts` | Grouping (`groupCommits`), revert pairing (`applyReverts`), breaking collection, and the Angular-format renderer. Owns `DEFAULT_TYPES` and `DEFAULT_ALIASES`. |
| `src/changelog.ts` | Orchestration. Range/version resolution, `generateChangelog`, `generateAll` (backfill), and the prepend splicing (`applyToChangelog`). |
| `src/config.ts` | Config file discovery and validation. |
| `src/options.ts` | Merges defaults < config file < CLI flags into `ResolvedOptions`. |
| `src/args.ts` | Hand-rolled flag parser + `HELP_TEXT`. Knows every flag, so typos error. |
| `src/run.ts` | The CLI body: `run(argv) => exit code`. Testable in-process. |
| `src/cli.ts` | 13-line executable shim. Only wiring — put no logic here. |
| `src/types.ts` | All shared types. |
| `src/index.ts` | Public API barrel. Adding an export here is a public API change. |

### Invariants worth knowing

- **`generateChangelog` resolves the range; `buildRelease` does not.** `buildRelease`
  takes an already-decided `{from, to, version}`. `from: null` there means "start
  of history", *not* "look up the last tag". `generateAll` depends on this — an
  earlier version re-resolved `from` and silently dropped the oldest release.
- **The parsed `type` is never rewritten.** Alias folding (`feature` → `feat`)
  happens at grouping time only, so `commit.type` always reflects what the author wrote.
- **Reverts cancel before grouping**, so a reverted feature never reaches a section.
- **Merge commits are always dropped**; their contents are already listed.
- **`--dry-run`, `--all`, and `--force` are flag-only.** A config file must never
  be able to suppress a write or trigger a full rewrite.
- **Non-conventional commits are skipped but never silently** — the count goes to stderr.

## Conventions

- Match the surrounding style: comments explain *why*, not *what*. Existing
  comments justify non-obvious decisions; keep that bar.
- Errors the user can cause (`GitError`, `ConfigError`, `ArgError`) are caught in
  `run.ts` and printed as a plain message with exit code 1 — never a stack trace.
- Regexes live at module top with a comment explaining the grammar they encode.
- Prefer adding a config key over a CLI flag. The CLI is at 18 flags; each new one
  costs docs, tests, and a landing-page sync.

## Testing

15 files, ~300 tests. Two styles, both required:

- **Unit** — parser, renderer, args, config, splicing. Pure and fast.
- **Integration** — `git-errors`, `paths`, `prerelease`, `backfill`, `integration`,
  `run` build **real temporary git repositories** in `os.tmpdir()`, commit into
  them, and run the actual code. Always clean up in `afterEach`/`afterAll`.

`test/fixtures/` holds a captured `git log` (with real `\x1f`/`\x1e` control
bytes) and two golden changelog outputs. **If a golden fixture changes, diff it
and confirm the delta is exactly what you intended before updating it.**

Test the CLI through `run()` from `src/run.ts` (in-process, gives coverage), not
by spawning `dist/cli.js`. `test/integration.test.ts` does spawn the built binary
on purpose, and skips itself when `dist/` is absent.

### Verify against reality

This project has a history of bugs that only appeared under real conditions —
`--all` dropping the oldest release, gitmoji producing an empty changelog, a
force-push missing a remote-only branch. When you change behaviour, **run the
built CLI against a real temp git repo** and read the output. Do not conclude
from unit tests alone.

## Keeping surfaces in sync

Three files repeat facts about the package. When behaviour changes, update all
of them, and say explicitly which ones you touched:

1. **`README.md`** — flag list, sections table, config table, FAQ.
2. **`index.html`** — the landing page. It reimplements the parser in JS for the
   live playground, so a parser change may need porting there too. It also
   contains the `FLAGS` array, the type→section map, `DEFAULT_ALIASES`, the
   feature cards, and the FAQ (mirrored in `FAQPage` JSON-LD).
3. **`llms.txt`** — the plain-text summary for AI crawlers.

### Facts on the landing page that go stale

These are hardcoded and drift silently. Check them every release:

- The version pill in the header and the footer (`v0.1.1`)
- The test/coverage badge (`304 tests · 97% stmts`) in the hero and footer
- `softwareVersion` in the `SoftwareApplication` JSON-LD

### Landing page constraints

- **Single self-contained file.** No CDN, no web fonts, no external images, no
  `fetch`. Verify with `performance.getEntriesByType('resource')` returning `[]`.
  `og-image.png` is referenced only in a `<meta>` tag — crawlers fetch it, the
  page does not.
- Light/dark theming: full palette on bare `:root`, redefined under
  `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`,
  and again under `:root[data-theme="dark"]`. Never define a color only inside a
  media query. Use `--accent-ink` for text on an accent background.
- When measuring computed styles in a browser to check contrast, **disable CSS
  transitions first** — otherwise you read mid-animation values.

## Releasing

```bash
npm run typecheck && npm test && npm run build
# bump the version pill + test badge in index.html first
npm version patch          # or minor / major
npm publish                # prepublishOnly re-runs the checks
git push && git push --tags
```

npm metadata (`homepage`, `keywords`, `description`) is baked into the published
tarball — editing `package.json` does nothing on npm until the next publish.

## Git identity

This is a **personal** repo under `github.com/LittleBoy9`. `~/.gitconfig` uses
`includeIf` rules: anything under `~/PERSONAL/` commits as
`Sounak <60914738+LittleBoy9@users.noreply.github.com>`, anything under `~/VITRA/`
uses the work identity. Do not commit here with a work email, and do not add a
global `user.email` back to `~/.gitconfig`.

## Design decisions already made

Do not relitigate these without being asked:

- **Angular / conventional-changelog output format**, not Keep a Changelog.
- **`--version <semver>` sets the changelog heading**; the tool's own version is
  `--cli-version` / `-v`. A deliberate deviation from CLI convention.
- **Version heading** resolves: `--version` → nearest `package.json` version →
  `Unreleased`. Inferring a semver bump from commit types was explicitly rejected
  as a default; an opt-in `--print-bump` remains unbuilt.
- **`chore` and `style` are hidden** by default; every other known type renders.
- **Markdown in descriptions is not escaped**, matching conventional-changelog.

## Known gaps

Suggested and not built: `--print-bump`, `--check` (CI gate for a stale
changelog), `--format release-notes`, `--json` output, contributor attribution,
bot-commit filtering, cherry-pick deduplication, sort-by-scope within sections.
