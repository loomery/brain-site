# Brain dashboard home page — design

Date: 2026-08-13
Status: approved for planning
Package: `@loomery/brain-site` (ships as v1.4.0)

## Problem

A brain's home page today is `HomeEmitter`: a structural listing of top-level pages and
folders, emitted only when the brain has no `docs/index.md`. It answers "what files exist
here" and nothing else. Someone opening a brain cannot see what phase the project is in,
how long is left, what is late, who is doing what, or what changed since they last looked.

The information needed to answer those questions is a mix of two kinds:

- **Deterministic** — the engagement's end date, its milestones, which have passed, how
  many days remain, which docs changed most recently.
- **Probabilistic** — a RAG judgement, what needs attention and why, what each person is
  currently working on, what a newcomer should read first.

Mixing the two without marking which is which produces a page that reads as authoritative
while containing model guesses. The design's central constraint is that a reader can
always tell one from the other.

## Non-goals

- **No live tool reads at build time.** The Quartz build is offline and credential-free.
  Reading Linear, Jira, Slack or Granola during a build is out of scope permanently, not
  deferred. Those reads belong to `/brain sync`, which persists its findings into the
  brain repo; the build only ever renders what is already on disk.
- **No analytics.** "Popular articles" cannot be honestly implemented — a local static
  site has no traffic data. It is replaced by two distinct things: *recently updated*
  (deterministic, from git) and *key reads* (an explicit LLM nomination, labelled as such).
- **No `/brain sync` prompt changes.** Teaching each brain's `brain` skill to regenerate
  the status file is a follow-up in the brain repos. This spec defines the contract that
  work will target.
- **No new `brain-site.yaml` keys.** The dashboard's files are discovered by convention.

## Data contract

Two tracked files at the brain's repository root, alongside `brain-site.yaml`. Named as a
pair so that `git diff` makes provenance immediately legible.

### `dashboard.yaml` — human-owned

Ground truth. Never written by an LLM. Every key is optional, including `project` — when it
is absent the page heading falls back to `pageTitle` from `brain-site.yaml`, which always
exists. A brain with no `dashboard.yaml` at all is valid and renders the Explore module
only.

```yaml
project: Secret Escapes
subtitle: AI Champions & Hack Week
start: 2026-07-20
end: 2026-09-14

phases:                      # optional -> "phase 2 of 4"
  - { name: Preparation, start: 2026-07-20 }
  - { name: Pre-work, start: 2026-08-04 }
  - { name: Hack Week, start: 2026-09-07 }
  - { name: Follow-up, start: 2026-09-12 }

milestones:
  - date: 2026-08-05
    name: Kickoff
    done: true
    label: "Kickoff held — success metrics agreed"   # optional longer text
  - date: 2026-09-07
    end: 2026-09-11                                  # optional range
    name: Hack Week
    owner: Milly                                     # optional

commitments:                 # optional; dated obligations that aren't big beats
  - { date: 2026-08-14, text: Survey responses due, owner: Milly }

effort:                      # optional -> Effort module
  soldDays: 50
  usedDays: 32
  inFlightDays: 4

people:                      # optional; the roster only — stable facts
  - { name: Milly Allatson, role: PM, org: Loomery }
  - { name: Tom Holmes, role: Engineer, org: Loomery }
```

### `dashboard.status.yaml` — LLM-owned

Regenerated wholesale at each `/brain sync`. Because it is never partially edited, sync
cannot corrupt ground truth: the two concerns do not share a file.

```yaml
generatedAt: 2026-08-13
since: 2026-08-06            # anchor for the delta module

status:
  rag: amber                 # green | amber | red
  headline: Venue unconfirmed 5 weeks out; survey returns pending

delta: |
  Survey went out to the whole champions channel on the 7th, responses due
  tomorrow. Venue is now leaning to Secret Escapes' own Holborn office.

attention:
  - { text: Holborn office availability, detail: travel blocked behind it, severity: high }
  - { text: Internal AI policy docs, detail: blocks custom guidelines, severity: medium }

decisions:
  - { text: "Hack Week 7–11 Sep, in person", by: Gianni, date: 2026-08-06 }

people:                      # keyed by name; must match the dashboard.yaml roster
  - { name: Milly Allatson, focus: Champions comms & survey,
      detail: Chasing returns before tomorrow's cutoff, state: on-track }
  - { name: Tom Holmes, focus: Training content & AI policy,
      detail: Waiting on policy docs from Efe, state: blocked }

keyReads:
  - { slug: engagement, why: why Loomery is here and what phase we're in }

sources:
  - { name: Slack, state: wired }        # wired | partial | absent
  - { name: Miro, state: partial, note: grounded from screenshots, not a live read }
```

`state` for a person is one of `on-track | awaiting | blocked | idle`.

### Provenance is per-field, not per-module

The people roster is stated; each person's current focus is assessed. The engagement end
date is stated; the RAG judgement about it is assessed. This is why the split is by field
rather than by module, and it is what lets every module carry an accurate label.

Rendered labels: **stated** (from `dashboard.yaml`, git, or content frontmatter) and
**assessed** (from `dashboard.status.yaml`, with `generatedAt` shown).

### Counters are derived, never authored

The three summary counters do not appear in either file:

- **done** — milestones with `done: true`
- **behind** — milestones whose date has passed without `done: true`
- **attention** — `length(status.attention)`

Deriving them removes the failure mode where the counters and the timeline disagree.

## Modules

Presence-driven: the skin ships a fixed set in a fixed order, and each module renders
itself from one slice of the model, returning nothing when that slice is absent. A brain
with only `dashboard.yaml` gets timeline, what's next and explore, and nothing broken. No
per-brain module configuration exists.

| Order | Module | Source | Label |
| --- | --- | --- | --- |
| 1 | Summary strip | `end` + today, `status.rag`, derived counters | mixed, per value |
| 2 | Since you last looked | `status.delta`, `status.since` | assessed |
| 3 | Timeline (fisheye) | `milestones`, `start`, `end`, today | stated |
| 4 | What's next | upcoming `milestones` + `commitments` | stated |
| 5 | Effort | `effort` | stated |
| 6 | Who's on it | `people` roster x `status.people` | mixed |
| 7 | Needs attention | `status.attention` | assessed |
| 8 | Recent decisions | `status.decisions` | assessed |
| 9 | Recent activity | timeline-source filenames + `git log -1` per doc | stated |
| 10 | Onboarding | existing `roles:` / `onboarding.prerequisites` frontmatter | stated |
| 11 | Brain health | `status.sources`, doc count, `generatedAt` | mixed |
| 12 | Explore the brain | today's `HomeEmitter` listing | stated |

Notes on individual modules:

- **Recent activity** merges two columns answering one question ("where is this brain
  moving?"): the latest session logs from the timeline source directory, and the most
  recently changed docs by `git log -1 --format=%cI` per file, falling back to mtime when
  git is unavailable (a tarball checkout, or a brain that is not a repo).
- **Onboarding** links into the existing `/onboarding/<role>` pages and reuses
  `buildRolePath` from `src/lib/onboarding/paths.mjs`. It does not reimplement path
  building, and it is absent until some doc carries `roles:`.
- **Explore the brain** preserves today's behaviour as a quiet chip row, so a brain with
  no dashboard data is byte-equivalent in substance to what it has now.

## Home page precedence

`HomeEmitter` becomes `DashboardEmitter`, and the existing structural listing becomes
module 12 inside it. Precedence is unchanged from today, with one tier not three:

1. A brain's own `docs/index.md` wins — `@quartz-community/content-page` emits it, and the
   dashboard emitter returns `[]` without touching `index.html`.
2. Otherwise the dashboard is emitted at `/`.

Because the listing is now a module, `/` always renders something useful and there is no
third fallback path to reason about. The `donorExclude: ["index"]` argument to `emitPage`
carries over verbatim — the chrome-donor circularity it guards against is unchanged.

## Code structure

```
assets/plugins/dashboard-emitter.ts      # thin: load -> model -> render modules -> emitPage
assets/plugins/dashboard/
  index.ts                               # the ordered module registry
  summary.ts  delta.ts  timeline.ts  next.ts  effort.ts
  people.ts  attention.ts  decisions.ts  activity.ts
  onboarding.ts  health.ts  explore.ts
assets/styles/_dashboard.scss            # cards, fisheye, people grid
src/lib/dashboard/schema.mjs             # allowlist validation for both files
src/lib/dashboard/model.mjs              # pure (facts, status, docs, gitDates, today) -> vm
src/lib/dashboard/load.mjs               # I/O: read YAML, resolve git dates
```

Each module exports `{ id, title, provenance, render(vm): string | null }`. Adding one is
a new file plus a line in the registry — no brain edits, no schema change, no config key.

`model.mjs` is a pure function with no I/O, which is where all the derivation lives: days
remaining, current phase, the three counters, and the fisheye's segment widths. The
fisheye maths is the one genuinely fiddly piece in this design, and isolating it here is
what makes it testable without a build.

`schema.mjs` follows `src/config/schema.mjs` exactly: an allowlist, where an unrecognised
key is a hard error rather than a silently ignored line.

Paths reach the emitter as **absolute values injected by `setup`**, the same mechanism
`sections.timeline.source` already uses. The package continues to know a brain's
conventions and never its paths.

## Fisheye timeline

A horizontal flex row whose `flex-basis` percentages are computed server-side in
`model.mjs`. The segment between the previous and next milestone is given a fixed **35%**
of the width regardless of its true duration; past and future segments compress to share
the remaining 65% proportionally by duration. Today's marker is positioned inside the
magnified segment at its true proportional offset, labelled `day N of M`.

Three edge cases, defined rather than left to fall out:

- **Today before the first milestone** — the magnified segment runs `start` -> first
  milestone; there is no compressed past.
- **Today after the last milestone** — the magnified segment runs last milestone -> `end`,
  and the legend's "next" side reads `Ends in N days` rather than naming a milestone. If
  `end` has also passed, the whole bar renders complete with an `Overran by N days` legend.
- **Fewer than two milestones** — magnification is meaningless, so the bar degrades to a
  plain `start` -> `end` progress bar with today marked and no segment boundaries.

The effect: relative position within the current gap is legible ("day 8 of 9, one day to
the survey deadline") while the whole engagement stays visible and correctly ordered.

One markup, three widths:

- **>= 1100px** (full-bleed) — every milestone with its name and date.
- **800-1100px** — names drop, dates remain. If even dates will not fit, the strip becomes
  `overflow-x: auto` with the current gap scrolled into view on load.
- **< 800px** — flips to the vertical spine, current gap expanded in place. Same
  magnification idea, rotated; the page scrolls vertically as normal.

## Collapsible chrome

The dashboard wants width; Quartz's default page spends 640px of it on two sidebars. The
home page therefore renders with chrome collapsed by default and a toggle to restore it.

Implementation is a `data-chrome="collapsed|expanded"` attribute on the page root plus a
small inline script that flips it and persists the choice to `localStorage`. Collapsing is
a CSS grid-template override in `_dashboard.scss`; no Quartz internal module is imported
and no other page is affected. Below 800px both states render the same single column.

When collapsed, the search / explore / theme affordances the sidebar would have provided
appear as chips top-right, so nothing becomes unreachable.

## Failure behaviour

**A dashboard data problem never fails the build.** Missing file, malformed YAML, an
unparseable date, a `status.people` entry naming nobody in the roster, `usedDays` greater
than `soldDays` — each produces a `console.warn` naming the file and the problem, and
results in an absent module or a dropped row. The page still emits.

This mirrors `LogsTimelineEmitter`, which already warns and continues when its source
directory is unreadable. `npx brain-site validate` is where these become loud, non-zero
errors, extended to cover both dashboard files alongside the existing frontmatter checks.

Today's date is read at build time, so a build is not byte-reproducible across days. That
is inherent to a countdown and is accepted, not worked around.

## Testing

`node --test`, no new framework.

- **Schema** — valid files; unknown key; wrong type; malformed date; unknown `state` or
  `severity` enum value; `status.people` name absent from the roster.
- **Model** — the cases that actually break countdowns and fisheyes: today before `start`;
  today after `end`; no milestones; exactly one milestone; every milestone in the past;
  two milestones on the same date; a milestone range spanning today; `phases` absent.
- **Modules** — each `render` returns `null` for its empty slice, and non-null for a
  minimal populated one.
- **Fixture brain** under `test/fixtures/` that a build asserts against, covering both the
  fully-populated and facts-only cases.

## Delivery

1. Land the work in `brain-site`; bump `1.3.0` -> `1.4.0` and tag `v1.4.0`. Minor, not
   major: no brain-side change is forced, and a brain with no data files renders what it
   renders today.
2. Both brains pin `github:loomery/brain-site#semver:^1.0.0`, so each picks the skin up
   with `npm update @loomery/brain-site && npx brain-site serve`. `setup` re-copies assets
   into `.brain-site/`.
3. Seed Secret Escapes: hand-author both files from what is already grounded in its
   `docs/`, and verify the built page against real data.

**The data does not propagate.** Eque2-Chalkstring will receive the new frontend and show
only the Explore-the-brain listing until its two files are written — equivalent to its
current home page, so a no-op rather than a regression. Seeding it is a deliberate
follow-up, as is adding `roles:` frontmatter to Secret Escapes docs so its Onboarding
module becomes non-empty.
