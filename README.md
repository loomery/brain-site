# @loomery/brain-site

The shared Quartz v5 frontend for Loomery project brains. This package ships the skin —
theme, layout, plugins, and CLI scaffolding — while each brain repository owns its own
content and file structure. Brains depend on this package rather than vendoring their own
copy of the frontend, so improvements to the shared skin propagate to every brain.

The boundary that keeps this shared: **this package may know a brain's frontmatter
conventions, but never a brain's paths.** Every path comes from the consuming brain's
`brain-site.yaml`.

## Installing in a brain

Two tracked files in the brain, and nothing else:

`package.json` — pin a **semver range**, not a branch and not a bare tag:

```json
{
  "private": true,
  "dependencies": {
    "@loomery/brain-site": "github:loomery/brain-site#semver:^1.2.0"
  }
}
```

A range means `npm update @loomery/brain-site` picks up skin fixes without touching the
`package.json`, while a major bump stays an explicit, reviewed decision. (A bare tag pins
a brain to one release forever; a branch gives no reproducibility at all.)

`brain-site.yaml` — the override. Every key is optional; the file itself is not.

```yaml
pageTitle: Acme Brain          # the site's title, in the header and <title>
content: docs                  # the directory Quartz builds pages from
static: assets/static          # optional: brain-owned images, served at /static/**
sections:
  timeline:
    source: logs               # defaults to logs/; omit `timeline` entirely to disable
    route: /logs               # the URL the timeline page is emitted at
```

Those are the **only** recognised keys — validation is an allowlist, so a typo or an
invented key is a hard error rather than a silently ignored line. All paths are relative
to the repository root, where `brain-site.yaml` itself lives; `setup` resolves them before
anything downstream sees them. There is currently **no** key for adding brain-local
plugins, and none for enabling the `AudienceFilter`.

Then, from the repository root:

```bash
npm i && npx brain-site serve
```

Needs Node >= 22 (Quartz v5's own requirement); the CLI refuses to run on anything older.

## Commands

All four run from the brain's repository root and read `brain-site.yaml` from there.

| Command | What it does |
| --- | --- |
| `npx brain-site setup` | Fetches Quartz, lays down `.brain-site/`, copies this package's assets and the brain's `static:`, writes the merged config, installs dependencies and plugins. Safe to re-run. |
| `npx brain-site build` | `setup`, then a one-shot Quartz build into `.brain-site/public/`. |
| `npx brain-site serve` | `setup`, then a watch-mode build on `localhost:8080`, rebuilding on content edits. Config edits need a restart. |
| `npx brain-site validate` | Checks every doc's frontmatter (`audience`, `roles`, `onboarding.prerequisites`). Defaults to the `content:` directory from `brain-site.yaml`; `--docs <dir>` overrides it. |

`setup` never writes to either tracked file. Everything it generates lands in
`.brain-site/` at the repository root, which is disposable: delete it, re-run `setup`, and
you get it back.

## Why `.git/info/exclude`, not `.gitignore`

`setup` registers `.brain-site/` in the repository's `.git/info/exclude` — written before
the directory is created, and idempotent across runs. It never edits `.gitignore`, and it
**exits non-zero** if it finds `.brain-site/` listed there.

That is not a stylistic preference. Quartz's `Static` emitter copies `quartz/static/**`
with `globby(..., { gitignore: true })`. globby reads `.gitignore` files and nothing else.
With `.brain-site/` in `.gitignore`, every file beneath it matches an ignore rule and
globby returns nothing — so the fonts, favicon, OG image and every brain-owned image
silently vanish from the build while sitting on disk untouched. `.git/info/exclude` gets
git the same "don't track this" result with no file for globby to read.

In a linked worktree the exclude entry goes to the repository's **common** git directory
(`git rev-parse --git-common-dir`), which is the only place git reads exclude patterns
from — not the per-worktree `.git/worktrees/<name>/info/exclude`, which git ignores
entirely.

## Local-only by default

The shipped config has the `AudienceFilter` — the fail-closed gate that keeps
`audience: [internal]` content out of a client-facing build — **disabled**, and there is
no override key to enable it yet. Any brain using this package should treat the site as
local-only until that changes.

## Development

```bash
node --test
```

No build step; the package is plain ESM.
