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
baseUrl: user.github.io/acme-brain  # only set this if deployed under a path, not a
                                # domain root (e.g. a GitHub Pages project site with
                                # no custom domain) — omit entirely for a brain hosted
                                # at its own root, and for local `serve`, which always
                                # ignores it
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

`baseUrl` only affects two things: the `data-basepath` attribute every page's `<body>`
carries (which the Explorer and search components read at runtime to build their own
links — see `@quartz-community/explorer`'s client script) and, indirectly, whatever else
real Quartz derives from its own `configuration.baseUrl`. It does **not** make static
asset references (`<link>`/`<script>` `href`/`src`, CSS `url()`) path-relative — those
stay root-absolute regardless, which only resolves correctly at a domain root. A brain
deploying under a path still needs its own build step to rewrite those (a post-build
text rewrite, or a reverse proxy that strips the path prefix) — `baseUrl` alone is not
enough to fully support subpath hosting.

Then, from the repository root:

```bash
npm i && npx brain-site serve
```

Needs Node >= 22 (Quartz v5's own requirement); the CLI refuses to run on anything older.

## The dashboard

`/` is a project dashboard: countdown, milestone timeline, status, who's on it,
recent activity. It is built from two **optional** files at the repository root,
both discovered by convention — there is no `brain-site.yaml` key for either,
and a brain with neither still gets a home page (a structural listing of its
pages and sections, which is what `/` was before). A brain that has written its
own `docs/index.md` keeps it; the dashboard only ever fills that one gap.

`dashboard.yaml` — human-owned ground truth. Never rewritten by a sync.

| Key | Feeds |
| --- | --- |
| `project`, `subtitle` | the page heading (falls back to `pageTitle`) |
| `clientLogo` | the client's mark, paired with Loomery's in the header |
| `start`, `end` | the countdown and the timeline's bounds |
| `phases[]` | "phase 2 of 4" |
| `milestones[]` | the timeline, and the done/behind counters |
| `commitments[]` | What's next, alongside upcoming milestones |
| `effort{}` | the Effort bar — omit it and the module is absent |
| `people[]` | the roster in Who's on it |

`dashboard.status.yaml` — LLM-owned, regenerated wholesale at each sync:
`generatedAt`, `since`, `status{rag,headline}`, `delta`, `attention[]`,
`decisions[]`, `people[]`, `keyReads[]`, `sources[]`.

Both are allowlist-validated: an unrecognised key is an error, not a silently
ignored line. Every module labels itself **stated** (from `dashboard.yaml`, git,
or frontmatter) or **assessed** (from `dashboard.status.yaml`), so a reader can
always tell a fact from a judgement.

A module whose data is missing renders nothing — no configuration selects them.
Nothing is read from Linear, Jira or any other live tool at build time: the
build is offline and credential-free, and those reads belong to `/brain sync`,
which persists what it finds into `dashboard.status.yaml`.

A build never fails over these files. A missing, malformed or invalid one warns
and drops the affected module; `npx brain-site validate` is where it is a
non-zero error.

### Keeping the status file current

This package bundles a `dashboard` skill that tells an agent how to regenerate
`dashboard.status.yaml` — the ownership split, how to pick a RAG rating, and
what to ground each field in. Link it once, and it updates with the skin:

```bash
ln -s ../node_modules/@loomery/brain-site/assets/skills/dashboard skills/dashboard
```

Commit that symlink. It resolves through a brain's own `.claude/skills ->
../skills`, so Claude Code picks the skill up, and `npm update
@loomery/brain-site` refreshes its content with nothing further to do. `setup`
never creates the link — it lands in the brain's tracked `skills/` directory,
and `setup` writes nothing tracked — but it does print this command when it
notices the link is missing.

Then reference the skill from your brain skill's own sync procedure, so a
`/brain sync` refreshes the dashboard as part of the run.

## Commands

All four run from the brain's repository root and read `brain-site.yaml` from there.

| Command | What it does |
| --- | --- |
| `npx brain-site setup` | Fetches Quartz, lays down `.brain-site/`, copies this package's assets and the brain's `static:`, writes the merged config, installs dependencies and plugins. Safe to re-run. |
| `npx brain-site build` | `setup`, then a one-shot Quartz build into `.brain-site/public/`. |
| `npx brain-site serve` | `setup`, then a watch-mode build on `localhost:8080`, rebuilding on content edits. Config edits need a restart. |
| `npx brain-site validate` | Checks every doc's frontmatter (`audience`, `roles`, `onboarding.prerequisites`) and, if present, `dashboard.yaml` and `dashboard.status.yaml`. Defaults to the `content:` directory from `brain-site.yaml`; `--docs <dir>` overrides it. |

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
