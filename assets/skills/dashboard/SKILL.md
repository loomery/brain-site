---
name: dashboard
description: >-
  Regenerate a project brain's dashboard status — the RAG rating, what needs
  attention, recent decisions, who is working on what, and the "since you last
  looked" summary shown on the brain site's home page. Use whenever `/brain
  sync` runs, whenever asked to update or refresh the dashboard, and whenever
  new project context has just been ingested and the home page would now be
  out of date.
---

# Updating a brain's dashboard

The brain site's home page (`/`) reads two files at the repository root. They have
different owners, and the whole value of the dashboard rests on not confusing them.

| File | Owner | Your permission |
| --- | --- | --- |
| `dashboard.yaml` | Humans | **Read only.** Never write to it. |
| `dashboard.status.yaml` | You | Regenerate wholesale. |

`dashboard.yaml` holds ground truth: the engagement's start and end dates, its
milestones, its phases, the people roster, days sold. Those are commitments someone
made deliberately. If you believe one is wrong or stale — a milestone slipped, a
person left — **say so and propose the edit; do not make it.** A dashboard whose
dates an agent quietly rewrote is worth nothing.

`dashboard.status.yaml` is yours. Rewrite it completely each time rather than
patching it, so a stale entry from three syncs ago cannot survive.

## Before you write anything

1. **Read `dashboard.yaml`** — you need the milestone list and the people roster.
   Every name in your `people:` block must match a `name:` in that roster exactly.
   A name that matches nothing is a validation error, not a new person.
2. **Read the brain's own docs** — whatever the brain's playbook lists as its
   grounded context (typically an engagement doc, stakeholders, meeting notes,
   session logs). Everything you write must trace to one of them.
3. **Find the previous `generatedAt`** in the existing `dashboard.status.yaml`, if
   there is one. That date becomes your `since:`, and the window it opens is what
   the `delta:` field summarises.

## What to write

Every field is optional. **Omit a field you cannot ground rather than filling it
with something plausible.** An absent module is honest; an invented one is not, and
the page labels this file's output as `assessed` precisely so a reader can weigh it.

```yaml
generatedAt: 2026-08-13        # today
since: 2026-08-06              # the previous generatedAt

status:
  rag: amber                   # green | amber | red
  headline: One line on why it is that colour

delta: |
  What changed since `since:`. Two to four sentences, concrete and dated.
  This is the most-read thing on the page — write it for someone returning
  after a week away, not as a changelog.

attention:                     # what a human needs to act on
  - text: Short label
    detail: why it matters and who is holding it
    severity: high             # high | medium | low

decisions:                     # what got settled, so it is not re-litigated
  - { text: What was decided, by: Who, date: 2026-08-06 }

people:                        # names MUST match dashboard.yaml's roster
  - name: Milly Allatson
    focus: What they are on right now
    detail: the specific open thread
    state: on-track            # on-track | awaiting | blocked | idle

keyReads:                      # 3-5 docs a newcomer should read first
  - { slug: engagement, why: one line on why this one }

sources:                       # what this brain is wired to
  - { name: Slack, state: wired }        # wired | partial | absent
  - { name: Miro, state: partial, note: why it is only partial }
```

### What belongs in `sources:`

**Derive this list from the brain's own `sources.yaml`, and keep its order.** That
file is the register of what this brain is actually wired to; `.mcp.json` tells you
which of those have a project-scoped MCP server. Between them they are the truth,
and the dashboard should agree with them rather than with anyone's recollection.

The three states mean:

- `wired` — declared in `sources.yaml` and readable.
- `partial` — declared, but you cannot fully read it, or what is in the docs came
  from somewhere other than a live read. Say which in `note:` — that is the whole
  value of this state.
- `absent` — declared in `sources.yaml` (or clearly expected for this engagement)
  but **not** connected yet. This is a gap someone should close.

**Do not list a tool merely because the project does not use it.** A brain's
onboarding notes often record tools that were considered and ruled out — "Linear,
Notion, Figma and Monday.com are not in use on this engagement". Those are settled
decisions, not gaps, and rendering them as `absent` chips makes a healthy brain
look half-connected. If it is not in `sources.yaml` and nobody expects it, leave it
out entirely.

### Choosing a RAG rating

Rate delivery risk, not mood. `green` — nothing needs a decision this week.
`amber` — something is slipping or unresolved and a human should look. `red` — a
date or commitment is already at risk. Put the *reason* in `headline`, not a
restatement of the colour; "Amber" beside "Some risks exist" tells a reader
nothing.

### Severity

`high` is for things blocking other work or with a date attached. `medium` needs
attention but nothing is waiting on it. `low` is a known gap worth recording.
If everything is `high`, nothing is.

### Person state

`blocked` means they cannot proceed — always pair it with what they are waiting
on, in `detail`. `awaiting` means someone else holds the next move. `idle` means no
open action, which is information, not criticism. Omit `people:` entirely rather
than guessing what someone is doing.

## Where the content comes from

Read from whatever the brain actually has wired — its playbook lists the sources.
In practice: meeting notes give you decisions and who owns what; team channels give
you blockers and the current week's focus; session logs give you what changed. A
project tracker (Linear, Jira) is the best source for `people:` when the brain has
one — read open issues per assignee and summarise each person's current focus.

Nothing is read at build time. The site build is offline and has no credentials, so
whatever you write here is exactly what the page will show until the next sync. If
you cannot reach a source, say which one in the relevant `sources:` note rather
than silently writing a status that looks fresher than it is.

## Finish

Validate before you finish:

```bash
npx brain-site validate
```

It checks both files against an allowlist — an unknown key, a bad enum value, or a
`people:` name missing from the roster is an error. Fix what it reports; do not
leave a file that fails validation, because the site build will silently drop the
affected module rather than failing.

Then say what you changed: the new RAG rating and why, anything added to or cleared
from `attention:`, and any `dashboard.yaml` edit you are proposing but did not make.
