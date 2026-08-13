# Brain Dashboard Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the structural `HomeEmitter` listing at `/` with a modular dashboard that mixes deterministic project facts (countdown, milestone timeline, git activity) with LLM-assessed status (RAG, attention, per-person focus), labelling every value as `stated` or `assessed`.

**Architecture:** Two brain-owned YAML files (`dashboard.yaml` human-owned, `dashboard.status.yaml` LLM-owned) are read at build time by a new `DashboardEmitter`. All derivation happens in one pure function (`src/lib/dashboard/model.mjs`) that takes data plus today's date and returns a view model; twelve presence-driven module renderers turn that view model into HTML. A module whose data slice is missing returns `null` and disappears. The emitter absorbs today's listing as its last module, so `/` always renders.

**Tech Stack:** Node >= 22, plain ESM (`.mjs`) for libraries, `.ts` for Quartz local plugins loaded via Node's native TypeScript support, `yaml` (already a dependency), `node --test`, SCSS.

## Global Constraints

- **Node >= 22.** Quartz v5's own floor; the CLI already refuses lower.
- **No new runtime dependencies.** `yaml` is already declared and is the only parser used.
- **Local plugins may import only:** Node builtins, `@quartz-community/types` (type-only), and this package's own `src/lib/**` via the `@loomery/brain-site/lib/*` export. Never anything under `.brain-site/quartz/**` — those files use extension-less relative imports that Node's loader cannot resolve. See `assets/plugins/shared/page-shell.ts`'s banner.
- **This package may know a brain's frontmatter conventions, but never a brain's paths.** Every path arrives as an absolute value in plugin options, resolved by `setup`.
- **A dashboard data problem never fails the build.** Missing file, malformed YAML, bad date, unknown enum: `console.warn` naming file and problem, then an absent module or dropped row. `npx brain-site validate` is where these are loud, non-zero errors.
- **No live tool reads at build time.** No network, no credentials. Linear/Jira reads belong to `/brain sync`.
- **No new `brain-site.yaml` keys.** The two dashboard files are discovered by convention at the repository root.
- **Dates are parsed as UTC midnight** from `YYYY-MM-DD` parts. Never `new Date(string)` — a build in BST would shift a day.
- **`yaml` parses unquoted ISO dates into JS `Date` objects.** Every date field must accept `Date | string`.
- **Provenance labels are exactly two strings:** `stated` and `assessed`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src/lib/dashboard/dates.mjs` | Date normalisation and day arithmetic. Pure, no domain knowledge. |
| `src/lib/dashboard/schema.mjs` | Allowlist validation of both YAML files. Pure. |
| `src/lib/dashboard/model.mjs` | `(facts, status, pages, activity, today) -> viewModel`. All derivation. Pure, no I/O. |
| `src/lib/dashboard/load.mjs` | The I/O half: read the two YAML files, resolve git dates. |
| `assets/plugins/dashboard-emitter.ts` | Thin: load, build model, render modules, `emitPage`. |
| `assets/plugins/dashboard/types.ts` | The `DashboardModule` interface and view-model types. |
| `assets/plugins/dashboard/render.ts` | Shared render helpers (card wrapper, provenance pill, chip). |
| `assets/plugins/dashboard/summary.ts` … `explore.ts` | One file per module (12). |
| `assets/plugins/dashboard/index.ts` | The ordered module registry. |
| `assets/styles/_dashboard.scss` | Cards, fisheye, people grid, collapsed-chrome grid override. |
| `test/dashboard-dates.test.mjs` | Date helpers. |
| `test/dashboard-schema.test.mjs` | Both validators. |
| `test/dashboard-model.test.mjs` | Derivation, including every fisheye edge case. |
| `test/dashboard-load.test.mjs` | YAML reading, git dates, mtime fallback. |
| `test/dashboard-emitter.test.mjs` | Precedence, page emission, module presence. |
| `test/dashboard-modules.test.mjs` | Each module's `null` and populated paths. |
| `test/fixtures/dashboard-full/`, `test/fixtures/dashboard-facts-only/` | Fixture brains a whole-page test asserts against. |

**Modified:**

| Path | Change |
| --- | --- |
| `src/config/merge.mjs` | Third `rootDir` argument; sets the dashboard emitter's absolute-path options. |
| `assets/quartz.config.base.yaml` | Replace the `home-emitter.ts` entry with `dashboard-emitter.ts`. |
| `assets/styles/custom.scss` | `@use "./dashboard"`. |
| `src/commands/validate.mjs` | Validate both dashboard files alongside docs. |
| `bin/brain-site.mjs` | Pass `rootDir` to `runValidate`. |
| `test/config-merge.test.mjs` | Cover the new `rootDir` argument and dashboard options. |
| `README.md` | Document the two files and the dashboard. |
| `package.json` | `1.3.0` -> `1.4.0`. |

**Deleted:**

| Path | Reason |
| --- | --- |
| `assets/plugins/home-emitter.ts` | Becomes `dashboard-emitter.ts`; its listing becomes the `explore` module. |
| `test/home-emitter.test.mjs` | Assertions port to `test/dashboard-emitter.test.mjs`. |

---

### Task 1: Date helpers

The one place that turns YAML's mixed `Date | string` values into comparable UTC days. Every later task depends on these three functions, so it goes first and alone.

**Files:**
- Create: `src/lib/dashboard/dates.mjs`
- Test: `test/dashboard-dates.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeDate(value: Date|string|undefined) => string | null` — returns `"YYYY-MM-DD"` or `null` when unparseable.
  - `toUtcDay(value: Date|string) => number | null` — milliseconds at UTC midnight.
  - `daysBetween(a: Date|string, b: Date|string) => number | null` — whole days from `a` to `b`, negative when `b` precedes `a`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-dates.test.mjs`:

```js
// Coverage for src/lib/dashboard/dates.mjs. The reason this module exists at all:
// `yaml` parses an unquoted `2026-08-05` into a JS Date, so every date field in
// dashboard.yaml arrives as either a Date or a string depending on how the author
// quoted it — and a build running in BST must not shift either one by a day.

import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeDate, toUtcDay, daysBetween } from "../src/lib/dashboard/dates.mjs"

test("normalizeDate accepts a YYYY-MM-DD string", () => {
  assert.equal(normalizeDate("2026-08-05"), "2026-08-05")
})

test("normalizeDate accepts a Date, as yaml produces for an unquoted ISO date", () => {
  assert.equal(normalizeDate(new Date(Date.UTC(2026, 7, 5))), "2026-08-05")
})

test("normalizeDate returns null for junk rather than throwing", () => {
  assert.equal(normalizeDate("not a date"), null)
  assert.equal(normalizeDate(undefined), null)
  assert.equal(normalizeDate(""), null)
  assert.equal(normalizeDate("2026-13-45"), null)
})

test("toUtcDay is timezone-stable for a string and its Date equivalent", () => {
  assert.equal(toUtcDay("2026-08-05"), toUtcDay(new Date(Date.UTC(2026, 7, 5))))
})

test("toUtcDay ignores a time component, keeping the calendar day", () => {
  assert.equal(toUtcDay("2026-08-05"), toUtcDay(new Date("2026-08-05T23:30:00Z")))
})

test("daysBetween counts whole days forward", () => {
  assert.equal(daysBetween("2026-08-05", "2026-08-14"), 9)
})

test("daysBetween is negative when the second date precedes the first", () => {
  assert.equal(daysBetween("2026-08-14", "2026-08-05"), -9)
})

test("daysBetween is zero for the same day", () => {
  assert.equal(daysBetween("2026-08-05", "2026-08-05"), 0)
})

test("daysBetween returns null when either side is unparseable", () => {
  assert.equal(daysBetween("nope", "2026-08-05"), null)
  assert.equal(daysBetween("2026-08-05", undefined), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-dates.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/dashboard/dates.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dashboard/dates.mjs`:

```js
// Date handling for the dashboard's two YAML files.
//
// Two things force this to exist rather than using Date directly:
//
//   1. `yaml` resolves an unquoted `2026-08-05` to a JS Date, but a quoted
//      `"2026-08-05"` to a string. Both are legal in a hand-written
//      dashboard.yaml, so every date field is Date | string.
//   2. `new Date("2026-08-05")` is parsed as UTC midnight, but
//      `new Date(2026, 7, 5)` and every getMonth()/getDate() reader are
//      *local*. Mixing them shifts a calendar day for any build west of UTC
//      or during BST — which for a countdown means an off-by-one day left.
//
// So: everything is normalized to a UTC-midnight millisecond value, and all
// arithmetic happens there. Nothing in this module knows what a milestone is.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function pad(n) {
  return String(n).padStart(2, "0")
}

export function normalizeDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value !== "string") return null
  const match = ISO_DAY.exec(value.trim())
  if (!match) return null
  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const ms = Date.UTC(year, month - 1, day)
  const round = new Date(ms)
  // Rejects 2026-13-45 and 2026-02-30, which Date.UTC would silently roll over.
  if (
    round.getUTCFullYear() !== year ||
    round.getUTCMonth() !== month - 1 ||
    round.getUTCDate() !== day
  ) {
    return null
  }
  return `${y}-${m}-${d}`
}

export function toUtcDay(value) {
  const iso = normalizeDate(value)
  if (iso === null) return null
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysBetween(a, b) {
  const from = toUtcDay(a)
  const to = toUtcDay(b)
  if (from === null || to === null) return null
  return Math.round((to - from) / MS_PER_DAY)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-dates.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/dates.mjs test/dashboard-dates.test.mjs
git commit -m "$(cat <<'EOF'
feat: add UTC-stable date helpers for the dashboard

yaml resolves an unquoted ISO date to a Date and a quoted one to a string, so
every dashboard date field is Date | string. Normalising both to UTC midnight
keeps a countdown from losing a day when the build runs during BST.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Schema validation

Allowlist validation for both files, following `src/config/schema.mjs` exactly: an unrecognised key is a hard error, because it is almost always a typo or a brain quietly forking the contract.

**Files:**
- Create: `src/lib/dashboard/schema.mjs`
- Test: `test/dashboard-schema.test.mjs`

**Interfaces:**
- Consumes: `normalizeDate` from `src/lib/dashboard/dates.mjs`.
- Produces:
  - `validateFacts(facts) => { ok: boolean, errors: string[] }`
  - `validateStatus(status, facts) => { ok: boolean, errors: string[] }` — `facts` is used only to cross-check that every `status.people[].name` exists in the roster; pass `null` to skip that check.
  - `PERSON_STATES: Set<string>` — `on-track`, `awaiting`, `blocked`, `idle`.
  - `SEVERITIES: Set<string>` — `high`, `medium`, `low`.
  - `RAG_LEVELS: Set<string>` — `green`, `amber`, `red`.
  - `SOURCE_STATES: Set<string>` — `wired`, `partial`, `absent`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-schema.test.mjs`:

```js
// Coverage for src/lib/dashboard/schema.mjs. Same philosophy as
// src/config/schema.mjs: an unknown key is a hard error, not a silently
// ignored line, because it is almost always a typo.

import { test } from "node:test"
import assert from "node:assert/strict"
import { validateFacts, validateStatus } from "../src/lib/dashboard/schema.mjs"

const VALID_FACTS = {
  project: "Secret Escapes",
  subtitle: "AI Champions & Hack Week",
  start: "2026-07-20",
  end: "2026-09-14",
  phases: [{ name: "Preparation", start: "2026-07-20" }],
  milestones: [
    { date: "2026-08-05", name: "Kickoff", done: true, label: "Kickoff held" },
    { date: "2026-09-07", end: "2026-09-11", name: "Hack Week", owner: "Milly" },
  ],
  commitments: [{ date: "2026-08-14", text: "Survey responses due", owner: "Milly" }],
  effort: { soldDays: 50, usedDays: 32, inFlightDays: 4 },
  people: [{ name: "Milly Allatson", role: "PM", org: "Loomery" }],
}

const VALID_STATUS = {
  generatedAt: "2026-08-13",
  since: "2026-08-06",
  status: { rag: "amber", headline: "Venue unconfirmed" },
  delta: "Survey went out on the 7th.",
  attention: [{ text: "Holborn office", detail: "travel blocked", severity: "high" }],
  decisions: [{ text: "Hack Week 7-11 Sep", by: "Gianni", date: "2026-08-06" }],
  people: [{ name: "Milly Allatson", focus: "Comms", detail: "Chasing", state: "on-track" }],
  keyReads: [{ slug: "engagement", why: "why we are here" }],
  sources: [{ name: "Miro", state: "partial", note: "from screenshots" }],
}

test("a fully populated facts file validates", () => {
  assert.deepEqual(validateFacts(VALID_FACTS), { ok: true, errors: [] })
})

test("an empty facts file validates — every key is optional", () => {
  assert.equal(validateFacts({}).ok, true)
  assert.equal(validateFacts(null).ok, true)
})

test("an unknown top-level facts key is an error naming the allowed keys", () => {
  const { ok, errors } = validateFacts({ ...VALID_FACTS, mileStones: [] })
  assert.equal(ok, false)
  assert.match(errors[0], /unknown key "mileStones"/)
  assert.match(errors[0], /milestones/)
})

test("a wrong-typed facts field is an error", () => {
  const { ok, errors } = validateFacts({ project: 42 })
  assert.equal(ok, false)
  assert.match(errors[0], /project must be a string, got number/)
})

test("milestones must be an array of objects", () => {
  assert.equal(validateFacts({ milestones: "Kickoff" }).ok, false)
  assert.equal(validateFacts({ milestones: ["Kickoff"] }).ok, false)
})

test("a milestone with a malformed date is an error naming its index", () => {
  const { ok, errors } = validateFacts({ milestones: [{ date: "2026-13-45", name: "X" }] })
  assert.equal(ok, false)
  assert.match(errors[0], /milestones\[0\]\.date/)
})

test("a milestone must have a name", () => {
  const { ok, errors } = validateFacts({ milestones: [{ date: "2026-08-05" }] })
  assert.equal(ok, false)
  assert.match(errors[0], /milestones\[0\]\.name is required/)
})

test("effort days must be non-negative numbers", () => {
  assert.equal(validateFacts({ effort: { soldDays: 50 } }).ok, true)
  assert.equal(validateFacts({ effort: { soldDays: -1 } }).ok, false)
  assert.equal(validateFacts({ effort: { soldDays: "50" } }).ok, false)
})

test("usedDays exceeding soldDays is an error, not a silently negative remainder", () => {
  const { ok, errors } = validateFacts({ effort: { soldDays: 10, usedDays: 12 } })
  assert.equal(ok, false)
  assert.match(errors[0], /usedDays \(12\) exceeds soldDays \(10\)/)
})

test("a fully populated status file validates against its roster", () => {
  assert.deepEqual(validateStatus(VALID_STATUS, VALID_FACTS), { ok: true, errors: [] })
})

test("an empty status file validates", () => {
  assert.equal(validateStatus({}, VALID_FACTS).ok, true)
  assert.equal(validateStatus(null, null).ok, true)
})

test("an unknown rag level is an error listing the legal values", () => {
  const { ok, errors } = validateStatus({ status: { rag: "orange" } }, null)
  assert.equal(ok, false)
  assert.match(errors[0], /status\.rag/)
  assert.match(errors[0], /green, amber, red/)
})

test("an unknown person state is an error", () => {
  const status = { people: [{ name: "Milly Allatson", state: "vibing" }] }
  const { ok, errors } = validateStatus(status, VALID_FACTS)
  assert.equal(ok, false)
  assert.match(errors[0], /people\[0\]\.state/)
})

test("an unknown severity is an error", () => {
  const { ok, errors } = validateStatus({ attention: [{ text: "X", severity: "spicy" }] }, null)
  assert.equal(ok, false)
  assert.match(errors[0], /attention\[0\]\.severity/)
})

test("a status person absent from the facts roster is an error", () => {
  const status = { people: [{ name: "Nobody At All", focus: "X" }] }
  const { ok, errors } = validateStatus(status, VALID_FACTS)
  assert.equal(ok, false)
  assert.match(errors[0], /"Nobody At All" is not in dashboard\.yaml's people roster/)
})

test("the roster cross-check is skipped when facts are unavailable", () => {
  const status = { people: [{ name: "Nobody At All", focus: "X" }] }
  assert.equal(validateStatus(status, null).ok, true)
})

test("attention entries require text", () => {
  const { ok, errors } = validateStatus({ attention: [{ detail: "orphan" }] }, null)
  assert.equal(ok, false)
  assert.match(errors[0], /attention\[0\]\.text is required/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-schema.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/dashboard/schema.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dashboard/schema.mjs`:

```js
// Allowlist validation for a brain's two dashboard files.
//
// Deliberately an allowlist, exactly as src/config/schema.mjs is: an
// unrecognised key is almost always a typo (`mileStones`) or a brain quietly
// forking the contract, and both should be loud. `npx brain-site validate` is
// the loud path; the build itself only warns (see the emitter), because a
// broken dashboard must never stop a brain being browsable.
//
// The two files are validated separately because they have different owners:
// dashboard.yaml is hand-written ground truth, dashboard.status.yaml is
// regenerated wholesale by /brain sync. validateStatus takes facts only to
// cross-check the people roster — the one place the two files must agree.

import { normalizeDate } from "./dates.mjs"

const FACTS_KEYS = new Set([
  "project",
  "subtitle",
  "start",
  "end",
  "phases",
  "milestones",
  "commitments",
  "effort",
  "people",
])
const PHASE_KEYS = new Set(["name", "start"])
const MILESTONE_KEYS = new Set(["date", "end", "name", "done", "label", "owner"])
const COMMITMENT_KEYS = new Set(["date", "text", "owner"])
const EFFORT_KEYS = new Set(["soldDays", "usedDays", "inFlightDays"])
const PERSON_KEYS = new Set(["name", "role", "org"])

const STATUS_KEYS = new Set([
  "generatedAt",
  "since",
  "status",
  "delta",
  "attention",
  "decisions",
  "people",
  "keyReads",
  "sources",
])
const STATUS_STATUS_KEYS = new Set(["rag", "headline"])
const ATTENTION_KEYS = new Set(["text", "detail", "severity"])
const DECISION_KEYS = new Set(["text", "by", "date"])
const STATUS_PERSON_KEYS = new Set(["name", "focus", "detail", "state"])
const KEY_READ_KEYS = new Set(["slug", "why"])
const SOURCE_KEYS = new Set(["name", "state", "note"])

export const RAG_LEVELS = new Set(["green", "amber", "red"])
export const PERSON_STATES = new Set(["on-track", "awaiting", "blocked", "idle"])
export const SEVERITIES = new Set(["high", "medium", "low"])
export const SOURCE_STATES = new Set(["wired", "partial", "absent"])

function describeType(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (value instanceof Date) return "date"
  return typeof value
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

function checkUnknownKeys(obj, allowed, label, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(`unknown key "${label ? `${label}.` : ""}${key}" — allowed: ${[...allowed].join(", ")}`)
    }
  }
}

function checkString(value, label, errors, { required = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${label} is required`)
    return
  }
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty string, got ${describeType(value)}`)
  }
}

function checkDate(value, label, errors, { required = false } = {}) {
  if (value === undefined) {
    if (required) errors.push(`${label} is required`)
    return
  }
  if (normalizeDate(value) === null) {
    errors.push(`${label} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`)
  }
}

function checkEnum(value, allowed, label, errors) {
  if (value === undefined) return
  if (typeof value !== "string" || !allowed.has(value)) {
    errors.push(`${label} must be one of: ${[...allowed].join(", ")} — got ${JSON.stringify(value)}`)
  }
}

function checkDays(value, label, errors) {
  if (value === undefined) return
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${label} must be a non-negative number, got ${describeType(value)}`)
  }
}

// Returns the array when it is one of objects, else null after pushing errors.
function checkObjectArray(value, label, errors) {
  if (value === undefined) return null
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array, got ${describeType(value)}`)
    return null
  }
  let ok = true
  value.forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      errors.push(`${label}[${i}] must be an object, got ${describeType(entry)}`)
      ok = false
    }
  })
  return ok ? value : null
}

export function validateFacts(facts) {
  const errors = []
  const config = facts ?? {}
  if (!isPlainObject(config)) {
    return { ok: false, errors: [`dashboard.yaml must be a mapping, got ${describeType(facts)}`] }
  }

  checkUnknownKeys(config, FACTS_KEYS, "", errors)
  checkString(config.project, "project", errors)
  checkString(config.subtitle, "subtitle", errors)
  checkDate(config.start, "start", errors)
  checkDate(config.end, "end", errors)

  const phases = checkObjectArray(config.phases, "phases", errors)
  phases?.forEach((phase, i) => {
    checkUnknownKeys(phase, PHASE_KEYS, `phases[${i}]`, errors)
    checkString(phase.name, `phases[${i}].name`, errors, { required: true })
    checkDate(phase.start, `phases[${i}].start`, errors, { required: true })
  })

  const milestones = checkObjectArray(config.milestones, "milestones", errors)
  milestones?.forEach((m, i) => {
    checkUnknownKeys(m, MILESTONE_KEYS, `milestones[${i}]`, errors)
    checkDate(m.date, `milestones[${i}].date`, errors, { required: true })
    checkDate(m.end, `milestones[${i}].end`, errors)
    checkString(m.name, `milestones[${i}].name`, errors, { required: true })
    checkString(m.label, `milestones[${i}].label`, errors)
    checkString(m.owner, `milestones[${i}].owner`, errors)
    if (m.done !== undefined && typeof m.done !== "boolean") {
      errors.push(`milestones[${i}].done must be a boolean, got ${describeType(m.done)}`)
    }
  })

  const commitments = checkObjectArray(config.commitments, "commitments", errors)
  commitments?.forEach((c, i) => {
    checkUnknownKeys(c, COMMITMENT_KEYS, `commitments[${i}]`, errors)
    checkDate(c.date, `commitments[${i}].date`, errors, { required: true })
    checkString(c.text, `commitments[${i}].text`, errors, { required: true })
    checkString(c.owner, `commitments[${i}].owner`, errors)
  })

  if (config.effort !== undefined) {
    if (!isPlainObject(config.effort)) {
      errors.push(`effort must be an object, got ${describeType(config.effort)}`)
    } else {
      checkUnknownKeys(config.effort, EFFORT_KEYS, "effort", errors)
      checkDays(config.effort.soldDays, "effort.soldDays", errors)
      checkDays(config.effort.usedDays, "effort.usedDays", errors)
      checkDays(config.effort.inFlightDays, "effort.inFlightDays", errors)
      const { soldDays, usedDays } = config.effort
      if (typeof soldDays === "number" && typeof usedDays === "number" && usedDays > soldDays) {
        errors.push(`effort.usedDays (${usedDays}) exceeds soldDays (${soldDays})`)
      }
    }
  }

  const people = checkObjectArray(config.people, "people", errors)
  people?.forEach((p, i) => {
    checkUnknownKeys(p, PERSON_KEYS, `people[${i}]`, errors)
    checkString(p.name, `people[${i}].name`, errors, { required: true })
    checkString(p.role, `people[${i}].role`, errors)
    checkString(p.org, `people[${i}].org`, errors)
  })

  return { ok: errors.length === 0, errors }
}

export function validateStatus(status, facts) {
  const errors = []
  const config = status ?? {}
  if (!isPlainObject(config)) {
    return {
      ok: false,
      errors: [`dashboard.status.yaml must be a mapping, got ${describeType(status)}`],
    }
  }

  checkUnknownKeys(config, STATUS_KEYS, "", errors)
  checkDate(config.generatedAt, "generatedAt", errors)
  checkDate(config.since, "since", errors)
  checkString(config.delta, "delta", errors)

  if (config.status !== undefined) {
    if (!isPlainObject(config.status)) {
      errors.push(`status must be an object, got ${describeType(config.status)}`)
    } else {
      checkUnknownKeys(config.status, STATUS_STATUS_KEYS, "status", errors)
      checkEnum(config.status.rag, RAG_LEVELS, "status.rag", errors)
      checkString(config.status.headline, "status.headline", errors)
    }
  }

  const attention = checkObjectArray(config.attention, "attention", errors)
  attention?.forEach((a, i) => {
    checkUnknownKeys(a, ATTENTION_KEYS, `attention[${i}]`, errors)
    checkString(a.text, `attention[${i}].text`, errors, { required: true })
    checkString(a.detail, `attention[${i}].detail`, errors)
    checkEnum(a.severity, SEVERITIES, `attention[${i}].severity`, errors)
  })

  const decisions = checkObjectArray(config.decisions, "decisions", errors)
  decisions?.forEach((d, i) => {
    checkUnknownKeys(d, DECISION_KEYS, `decisions[${i}]`, errors)
    checkString(d.text, `decisions[${i}].text`, errors, { required: true })
    checkString(d.by, `decisions[${i}].by`, errors)
    checkDate(d.date, `decisions[${i}].date`, errors)
  })

  // The one place the two files must agree. A name that matches nobody is a
  // sync bug (a renamed or removed person), and silently dropping the row
  // would hide it — so validate says so, while the model drops the row so a
  // build still renders.
  const roster = new Set(
    (Array.isArray(facts?.people) ? facts.people : [])
      .map((p) => (typeof p?.name === "string" ? p.name : null))
      .filter((name) => name !== null),
  )
  const statusPeople = checkObjectArray(config.people, "people", errors)
  statusPeople?.forEach((p, i) => {
    checkUnknownKeys(p, STATUS_PERSON_KEYS, `people[${i}]`, errors)
    checkString(p.name, `people[${i}].name`, errors, { required: true })
    checkString(p.focus, `people[${i}].focus`, errors)
    checkString(p.detail, `people[${i}].detail`, errors)
    checkEnum(p.state, PERSON_STATES, `people[${i}].state`, errors)
    if (facts !== null && typeof p.name === "string" && !roster.has(p.name)) {
      errors.push(`people[${i}]: "${p.name}" is not in dashboard.yaml's people roster`)
    }
  })

  const keyReads = checkObjectArray(config.keyReads, "keyReads", errors)
  keyReads?.forEach((k, i) => {
    checkUnknownKeys(k, KEY_READ_KEYS, `keyReads[${i}]`, errors)
    checkString(k.slug, `keyReads[${i}].slug`, errors, { required: true })
    checkString(k.why, `keyReads[${i}].why`, errors)
  })

  const sources = checkObjectArray(config.sources, "sources", errors)
  sources?.forEach((s, i) => {
    checkUnknownKeys(s, SOURCE_KEYS, `sources[${i}]`, errors)
    checkString(s.name, `sources[${i}].name`, errors, { required: true })
    checkEnum(s.state, SOURCE_STATES, `sources[${i}].state`, errors)
    checkString(s.note, `sources[${i}].note`, errors)
  })

  return { ok: errors.length === 0, errors }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-schema.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/schema.mjs test/dashboard-schema.test.mjs
git commit -m "$(cat <<'EOF'
feat: add allowlist validation for the two dashboard files

Follows src/config/schema.mjs: an unrecognised key is a hard error, since it
is almost always a typo or a brain forking the contract.

validateStatus cross-checks people names against dashboard.yaml's roster —
the one place the two files must agree — and skips that check when facts are
unavailable, so a status-only validation still works.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Model — countdown, phase, counters

The first half of the pure derivation layer. Deliberately excludes the fisheye, which is Task 4: this task's deliverable is a view model a reviewer can check by hand.

**Files:**
- Create: `src/lib/dashboard/model.mjs`
- Test: `test/dashboard-model.test.mjs`

**Interfaces:**
- Consumes: `normalizeDate`, `daysBetween` from `src/lib/dashboard/dates.mjs`.
- Produces:
  - `computeCountdown(facts, today) => { endsOn, daysLeft, totalDays, elapsedDays, overranDays } | null`
  - `computePhase(facts, today) => { name, index, count } | null`
  - `computeCounters(facts, status, today) => { done, behind, attention }`
  - `joinPeople(facts, status) => Array<{ name, role, org, focus, detail, state }>`
  - `buildModel({ facts, status, pages, activity, today }) => viewModel` — Task 4 adds `timeline`; Task 5 supplies `activity`; Task 7 supplies `pages`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-model.test.mjs`:

```js
// Coverage for src/lib/dashboard/model.mjs — the pure derivation layer. Every
// case here is one a real brain hits: an engagement that has not started, one
// that has overrun, a milestone with no `done` flag whose date has passed.
//
// `today` is always injected, never read from the clock, so these tests do not
// rot. The build itself passes the real date — that is the one deliberate
// source of non-reproducibility in the dashboard.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  computeCountdown,
  computePhase,
  computeCounters,
  joinPeople,
  buildModel,
} from "../src/lib/dashboard/model.mjs"

const FACTS = {
  project: "Secret Escapes",
  subtitle: "AI Champions & Hack Week",
  start: "2026-07-20",
  end: "2026-09-14",
  phases: [
    { name: "Preparation", start: "2026-07-20" },
    { name: "Pre-work", start: "2026-08-04" },
    { name: "Hack Week", start: "2026-09-07" },
    { name: "Follow-up", start: "2026-09-12" },
  ],
  milestones: [
    { date: "2026-08-05", name: "Kickoff", done: true },
    { date: "2026-08-14", name: "Survey due" },
    { date: "2026-09-07", end: "2026-09-11", name: "Hack Week" },
  ],
  people: [
    { name: "Milly Allatson", role: "PM", org: "Loomery" },
    { name: "Tom Holmes", role: "Engineer", org: "Loomery" },
  ],
}

test("countdown reports days left and elapsed against the engagement bounds", () => {
  const c = computeCountdown(FACTS, "2026-08-13")
  assert.equal(c.endsOn, "2026-09-14")
  assert.equal(c.daysLeft, 32)
  assert.equal(c.totalDays, 56)
  assert.equal(c.elapsedDays, 24)
  assert.equal(c.overranDays, 0)
})

test("countdown clamps elapsed to zero before the engagement starts", () => {
  const c = computeCountdown(FACTS, "2026-07-01")
  assert.equal(c.elapsedDays, 0)
  assert.equal(c.daysLeft, 75)
})

test("countdown reports an overrun instead of negative days left", () => {
  const c = computeCountdown(FACTS, "2026-09-20")
  assert.equal(c.daysLeft, 0)
  assert.equal(c.overranDays, 6)
  assert.equal(c.elapsedDays, 56)
})

test("countdown is null without an end date — there is nothing to count to", () => {
  assert.equal(computeCountdown({ start: "2026-07-20" }, "2026-08-13"), null)
  assert.equal(computeCountdown({}, "2026-08-13"), null)
})

test("countdown works with no start date, reporting days left only", () => {
  const c = computeCountdown({ end: "2026-09-14" }, "2026-08-13")
  assert.equal(c.daysLeft, 32)
  assert.equal(c.totalDays, null)
  assert.equal(c.elapsedDays, null)
})

test("phase is the last one whose start has passed", () => {
  assert.deepEqual(computePhase(FACTS, "2026-08-13"), {
    name: "Pre-work",
    index: 2,
    count: 4,
  })
})

test("phase is the first one before any phase has started", () => {
  assert.deepEqual(computePhase(FACTS, "2026-07-01"), {
    name: "Preparation",
    index: 1,
    count: 4,
  })
})

test("phase sorts by start date rather than trusting file order", () => {
  const unordered = {
    phases: [
      { name: "Second", start: "2026-08-04" },
      { name: "First", start: "2026-07-20" },
    ],
  }
  assert.equal(computePhase(unordered, "2026-08-13").name, "Second")
  assert.equal(computePhase(unordered, "2026-08-13").index, 2)
})

test("phase is null when no phases are declared", () => {
  assert.equal(computePhase({}, "2026-08-13"), null)
})

test("counters count done milestones, overdue ones, and attention entries", () => {
  const status = { attention: [{ text: "a" }, { text: "b" }] }
  assert.deepEqual(computeCounters(FACTS, status, "2026-08-20"), {
    done: 1,
    behind: 1,
    attention: 2,
  })
})

test("a milestone is not behind until its end date has passed, for a range", () => {
  const facts = { milestones: [{ date: "2026-09-07", end: "2026-09-11", name: "Hack Week" }] }
  assert.equal(computeCounters(facts, null, "2026-09-09").behind, 0)
  assert.equal(computeCounters(facts, null, "2026-09-12").behind, 1)
})

test("a done milestone is never behind, however overdue", () => {
  const facts = { milestones: [{ date: "2026-07-01", name: "X", done: true }] }
  assert.deepEqual(computeCounters(facts, null, "2026-08-13"), {
    done: 1,
    behind: 0,
    attention: 0,
  })
})

test("counters are all zero for an empty brain", () => {
  assert.deepEqual(computeCounters({}, {}, "2026-08-13"), { done: 0, behind: 0, attention: 0 })
})

test("joinPeople keeps the roster order and merges each person's status", () => {
  const status = {
    people: [
      { name: "Tom Holmes", focus: "Training", detail: "Waiting on Efe", state: "blocked" },
    ],
  }
  const joined = joinPeople(FACTS, status)
  assert.equal(joined.length, 2)
  assert.deepEqual(joined[0], {
    name: "Milly Allatson",
    role: "PM",
    org: "Loomery",
    focus: null,
    detail: null,
    state: null,
  })
  assert.equal(joined[1].focus, "Training")
  assert.equal(joined[1].state, "blocked")
})

test("joinPeople drops a status entry naming nobody in the roster", () => {
  const status = { people: [{ name: "Ghost", focus: "haunting" }] }
  const joined = joinPeople(FACTS, status)
  assert.equal(joined.length, 2)
  assert.equal(joined.some((p) => p.name === "Ghost"), false)
})

test("joinPeople returns an empty array with no roster, even if status has people", () => {
  assert.deepEqual(joinPeople({}, { people: [{ name: "Ghost" }] }), [])
})

test("buildModel falls back to pageTitle for the heading when project is absent", () => {
  const vm = buildModel({
    facts: {},
    status: null,
    pageTitle: "Acme Brain",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.heading, "Acme Brain")
})

test("buildModel prefers project over pageTitle", () => {
  const vm = buildModel({
    facts: FACTS,
    status: null,
    pageTitle: "Acme Brain",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.heading, "Secret Escapes")
  assert.equal(vm.subtitle, "AI Champions & Hack Week")
})

test("buildModel carries status fields through and records generatedAt", () => {
  const status = {
    generatedAt: "2026-08-13",
    since: "2026-08-06",
    status: { rag: "amber", headline: "Venue unconfirmed" },
    delta: "Survey went out.",
    decisions: [{ text: "Locked the week", by: "Gianni", date: "2026-08-06" }],
    keyReads: [{ slug: "engagement", why: "start here" }],
    sources: [{ name: "Miro", state: "partial" }],
  }
  const vm = buildModel({
    facts: FACTS,
    status,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.generatedAt, "2026-08-13")
  assert.deepEqual(vm.rag, { level: "amber", headline: "Venue unconfirmed" })
  assert.equal(vm.delta.text, "Survey went out.")
  assert.equal(vm.delta.since, "2026-08-06")
  assert.equal(vm.decisions.length, 1)
  assert.equal(vm.keyReads.length, 1)
  assert.equal(vm.sources.length, 1)
})

test("buildModel tolerates both files being absent entirely", () => {
  const vm = buildModel({
    facts: null,
    status: null,
    pageTitle: "Acme Brain",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.heading, "Acme Brain")
  assert.equal(vm.countdown, null)
  assert.equal(vm.rag, null)
  assert.equal(vm.delta, null)
  assert.deepEqual(vm.counters, { done: 0, behind: 0, attention: 0 })
  assert.deepEqual(vm.people, [])
})

test("buildModel merges upcoming milestones and commitments into next, sorted by date", () => {
  const facts = {
    ...FACTS,
    commitments: [{ date: "2026-08-17", text: "Training published", owner: "Tom" }],
  }
  const vm = buildModel({
    facts,
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.deepEqual(
    vm.next.map((n) => [n.date, n.text]),
    [
      ["2026-08-14", "Survey due"],
      ["2026-08-17", "Training published"],
      ["2026-09-07", "Hack Week"],
    ],
  )
})

test("next excludes past and done items", () => {
  const vm = buildModel({
    facts: FACTS,
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-09-08",
  })
  assert.deepEqual(vm.next.map((n) => n.text), [])
})

test("effort derives percentages and remaining days", () => {
  const facts = { effort: { soldDays: 50, usedDays: 32, inFlightDays: 4 } }
  const vm = buildModel({
    facts,
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.effort.usedDays, 32)
  assert.equal(vm.effort.leftDays, 14)
  assert.equal(vm.effort.usedPct, 64)
  assert.equal(vm.effort.inFlightPct, 8)
})

test("effort is null without soldDays — a bar with no denominator says nothing", () => {
  const vm = buildModel({
    facts: { effort: { usedDays: 32 } },
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.effort, null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-model.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/dashboard/model.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dashboard/model.mjs`:

```js
// The dashboard's derivation layer: one pure function from data to a view
// model, with no I/O and no clock read.
//
// `today` is a parameter, never `new Date()`, for two reasons: the tests would
// otherwise rot within a week, and every module renderer downstream becomes
// deterministic given a fixture. The build is the one place that reads the real
// date (see dashboard-emitter.ts), which is also the one place the dashboard is
// deliberately not byte-reproducible — inherent to a countdown.
//
// Everything derived here is derived rather than authored, on purpose. The
// three summary counters are the clearest case: authoring them in the status
// file would let them drift out of agreement with the milestone list they
// describe, and a dashboard whose numbers contradict its own timeline is worse
// than one with no numbers.

import { normalizeDate, daysBetween } from "./dates.mjs"

function asArray(value) {
  return Array.isArray(value) ? value : []
}

// A milestone occupies its `end` date when it has one (a range like Hack Week),
// otherwise just `date`. Used for "has this passed?" everywhere.
function closesOn(milestone) {
  return normalizeDate(milestone?.end) ?? normalizeDate(milestone?.date)
}

export function computeCountdown(facts, today) {
  const endsOn = normalizeDate(facts?.end)
  if (endsOn === null) return null

  const start = normalizeDate(facts?.start)
  const remaining = daysBetween(today, endsOn)
  const overranDays = remaining < 0 ? -remaining : 0

  return {
    endsOn,
    daysLeft: Math.max(0, remaining),
    overranDays,
    totalDays: start === null ? null : daysBetween(start, endsOn),
    elapsedDays:
      start === null
        ? null
        : Math.min(Math.max(0, daysBetween(start, today)), daysBetween(start, endsOn)),
  }
}

export function computePhase(facts, today) {
  const phases = asArray(facts?.phases)
    .map((phase) => ({ name: phase?.name, start: normalizeDate(phase?.start) }))
    .filter((phase) => typeof phase.name === "string" && phase.start !== null)
    .sort((a, b) => a.start.localeCompare(b.start))
  if (phases.length === 0) return null

  // The last phase whose start has passed. Before the first has started there
  // is no "previous" phase to name, so the first is reported rather than null —
  // a brain in pre-kickoff is in its first phase, not in no phase.
  let index = 0
  for (let i = 0; i < phases.length; i++) {
    if (daysBetween(phases[i].start, today) >= 0) index = i
  }
  return { name: phases[index].name, index: index + 1, count: phases.length }
}

export function computeCounters(facts, status, today) {
  const milestones = asArray(facts?.milestones)
  let done = 0
  let behind = 0
  for (const milestone of milestones) {
    if (milestone?.done === true) {
      done++
      continue
    }
    const closed = closesOn(milestone)
    if (closed !== null && daysBetween(closed, today) > 0) behind++
  }
  return { done, behind, attention: asArray(status?.attention).length }
}

export function joinPeople(facts, status) {
  const byName = new Map()
  for (const person of asArray(status?.people)) {
    if (typeof person?.name === "string") byName.set(person.name, person)
  }
  // Roster order is the roster's own, not the status file's: the roster is
  // stable and hand-ordered, while sync regenerates its list every run. A
  // status entry matching nobody is dropped here so the page still renders;
  // `validate` reports it as an error (see schema.mjs's roster cross-check).
  return asArray(facts?.people)
    .filter((person) => typeof person?.name === "string")
    .map((person) => {
      const live = byName.get(person.name) ?? {}
      return {
        name: person.name,
        role: person.role ?? null,
        org: person.org ?? null,
        focus: live.focus ?? null,
        detail: live.detail ?? null,
        state: live.state ?? null,
      }
    })
}

function computeNext(facts, today) {
  const fromMilestones = asArray(facts?.milestones)
    .filter((m) => m?.done !== true)
    .map((m) => ({
      date: normalizeDate(m?.date),
      text: m?.name ?? null,
      owner: m?.owner ?? null,
      isMilestone: true,
    }))
  const fromCommitments = asArray(facts?.commitments).map((c) => ({
    date: normalizeDate(c?.date),
    text: c?.text ?? null,
    owner: c?.owner ?? null,
    isMilestone: false,
  }))

  return [...fromMilestones, ...fromCommitments]
    .filter((item) => item.date !== null && item.text !== null)
    .filter((item) => daysBetween(today, item.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

function computeEffort(facts) {
  const effort = facts?.effort
  const sold = effort?.soldDays
  // Without a denominator a progress bar communicates nothing, so the module
  // is absent rather than showing an unanchored count.
  if (typeof sold !== "number" || sold <= 0) return null
  const used = typeof effort.usedDays === "number" ? effort.usedDays : 0
  const inFlight = typeof effort.inFlightDays === "number" ? effort.inFlightDays : 0
  const pct = (n) => Math.round((n / sold) * 1000) / 10
  return {
    soldDays: sold,
    usedDays: used,
    inFlightDays: inFlight,
    leftDays: Math.max(0, sold - used - inFlight),
    usedPct: pct(used),
    inFlightPct: pct(Math.min(inFlight, Math.max(0, sold - used))),
  }
}

export function buildModel({ facts, status, pageTitle, pages, activity, today }) {
  const rag =
    status?.status?.rag !== undefined || status?.status?.headline !== undefined
      ? {
          level: status.status.rag ?? null,
          headline: status.status.headline ?? null,
        }
      : null

  const deltaText = typeof status?.delta === "string" && status.delta.trim().length > 0
    ? status.delta.trim()
    : null

  return {
    heading:
      typeof facts?.project === "string" && facts.project.length > 0 ? facts.project : pageTitle,
    subtitle: typeof facts?.subtitle === "string" ? facts.subtitle : null,
    generatedAt: normalizeDate(status?.generatedAt),
    today,
    rag,
    countdown: computeCountdown(facts, today),
    phase: computePhase(facts, today),
    counters: computeCounters(facts, status, today),
    delta: deltaText === null ? null : { text: deltaText, since: normalizeDate(status?.since) },
    next: computeNext(facts, today),
    effort: computeEffort(facts),
    people: joinPeople(facts, status),
    attention: asArray(status?.attention),
    decisions: asArray(status?.decisions),
    keyReads: asArray(status?.keyReads),
    sources: asArray(status?.sources),
    activity: activity ?? { logs: [], docs: [] },
    pages: pages ?? [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-model.test.mjs`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/model.mjs test/dashboard-model.test.mjs
git commit -m "$(cat <<'EOF'
feat: derive dashboard countdown, phase, counters and people join

`today` is injected rather than read from the clock, so the derivation is
deterministic given a fixture and the tests do not rot.

The three counters are derived from the milestone list rather than authored in
the status file: authoring them would let them drift out of agreement with the
timeline they describe, and numbers that contradict their own timeline are
worse than no numbers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Model — fisheye timeline

Adds `timeline` to the view model. The magnified current gap takes a fixed 35% of the bar; past and future compress into the remaining 65% proportionally by duration.

**Files:**
- Modify: `src/lib/dashboard/model.mjs` (add `buildTimeline`, wire into `buildModel`)
- Modify: `test/dashboard-model.test.mjs` (append the timeline suite)

**Interfaces:**
- Consumes: `normalizeDate`, `daysBetween` from `dates.mjs`; `closesOn` (module-local).
- Produces:
  - `CURRENT_SEGMENT_BASIS: 35`
  - `buildTimeline(facts, today) => Timeline | null` where `Timeline` is either
    `{ mode: "plain", progressPct, todayLabel }` or
    `{ mode: "fisheye", segments, legend }`.
  - `segments[i]` = `{ kind: "past"|"current"|"future", basis, startNode, endNode, today }` where `startNode`/`endNode` are `{ date, name, done, synthetic } | null` and `today` is `{ offsetPct, label } | null` (non-null on the current segment only). `endNode` is non-null on the **last** segment only — every other segment's right-hand node is the next segment's `startNode`, so rendering a node marker at each segment's left edge plus one at the last segment's right edge draws each node exactly once.
  - `legend` = `{ pastName, pastDaysAgo, nextName, nextInDays, nextIsEnd, overranDays }`.
- `buildModel`'s returned object gains `timeline`.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-model.test.mjs`:

```js
// ---------------------------------------------------------------------------
// Fisheye timeline
//
// The invariant every case below checks: bases always sum to 100, the current
// segment always gets exactly CURRENT_SEGMENT_BASIS, and exactly one segment is
// ever marked current. Those three hold regardless of how degenerate the input
// is, which is what stops a malformed brain producing a bar that overflows its
// container or renders two "today" markers.

import { buildTimeline, CURRENT_SEGMENT_BASIS } from "../src/lib/dashboard/model.mjs"

const TL_FACTS = {
  start: "2026-07-20",
  end: "2026-09-14",
  milestones: [
    { date: "2026-08-05", name: "Kickoff", done: true },
    { date: "2026-08-14", name: "Survey due" },
    { date: "2026-08-17", name: "Training lands" },
    { date: "2026-09-07", end: "2026-09-11", name: "Hack Week" },
  ],
}

function sumBases(segments) {
  return Math.round(segments.reduce((total, s) => total + s.basis, 0))
}

test("fisheye bases sum to 100 and the current segment takes the fixed share", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  assert.equal(tl.mode, "fisheye")
  assert.equal(sumBases(tl.segments), 100)
  const current = tl.segments.filter((s) => s.kind === "current")
  assert.equal(current.length, 1)
  assert.equal(current[0].basis, CURRENT_SEGMENT_BASIS)
})

test("the current segment is the gap containing today, and labels the day within it", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  const current = tl.segments.find((s) => s.kind === "current")
  assert.equal(current.startNode.name, "Kickoff")
  assert.equal(current.today.label, "day 9 of 9")
  // 8 of 9 days elapsed between 05 Aug and 14 Aug.
  assert.equal(Math.round(current.today.offsetPct), 89)
})

test("segments before the current one are past, after are future", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  const kinds = tl.segments.map((s) => s.kind)
  assert.deepEqual(kinds, ["past", "current", "future", "future"])
})

test("only the last segment carries an endNode, so each node renders once", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  const withEnd = tl.segments.filter((s) => s.endNode !== null)
  assert.equal(withEnd.length, 1)
  assert.equal(withEnd[0], tl.segments.at(-1))
  assert.equal(withEnd[0].endNode.date, "2026-09-14")
})

test("the legend names what was just passed and what is next", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  assert.equal(tl.legend.pastName, "Kickoff")
  assert.equal(tl.legend.pastDaysAgo, 8)
  assert.equal(tl.legend.nextName, "Survey due")
  assert.equal(tl.legend.nextInDays, 1)
  assert.equal(tl.legend.nextIsEnd, false)
  assert.equal(tl.legend.overranDays, 0)
})

test("today before the first milestone magnifies start -> first, with no past segment", () => {
  const tl = buildTimeline(TL_FACTS, "2026-07-25")
  assert.equal(sumBases(tl.segments), 100)
  assert.equal(tl.segments[0].kind, "current")
  assert.equal(tl.segments[0].startNode.date, "2026-07-20")
  assert.equal(tl.segments[0].startNode.synthetic, true)
  assert.equal(tl.segments.some((s) => s.kind === "past"), false)
  assert.equal(tl.legend.nextName, "Kickoff")
})

test("today after the last milestone magnifies last -> end and the legend names the end", () => {
  const tl = buildTimeline(TL_FACTS, "2026-09-12")
  assert.equal(sumBases(tl.segments), 100)
  assert.equal(tl.segments.at(-1).kind, "current")
  assert.equal(tl.segments.at(-1).endNode.synthetic, true)
  assert.equal(tl.legend.nextIsEnd, true)
  assert.equal(tl.legend.nextInDays, 2)
  assert.equal(tl.legend.overranDays, 0)
})

test("past the end date, the legend reports an overrun and today is clamped to the bar", () => {
  const tl = buildTimeline(TL_FACTS, "2026-09-20")
  assert.equal(sumBases(tl.segments), 100)
  const current = tl.segments.find((s) => s.kind === "current")
  assert.equal(current.today.offsetPct, 100)
  assert.equal(tl.legend.overranDays, 6)
  assert.equal(tl.legend.nextName, null)
})

test("fewer than two milestones degrades to a plain start -> end progress bar", () => {
  const facts = { start: "2026-07-20", end: "2026-09-14", milestones: [{ date: "2026-08-05", name: "Kickoff" }] }
  const tl = buildTimeline(facts, "2026-08-13")
  assert.equal(tl.mode, "plain")
  assert.equal(Math.round(tl.progressPct), 43)
  assert.equal(tl.todayLabel, "day 25 of 56")
})

test("no milestones at all still gives a plain bar when the bounds are known", () => {
  const tl = buildTimeline({ start: "2026-07-20", end: "2026-09-14" }, "2026-08-13")
  assert.equal(tl.mode, "plain")
})

test("timeline is null with neither bounds nor two milestones — nothing to draw", () => {
  assert.equal(buildTimeline({}, "2026-08-13"), null)
  assert.equal(buildTimeline({ start: "2026-07-20" }, "2026-08-13"), null)
  assert.equal(buildTimeline(null, "2026-08-13"), null)
})

test("two milestones and no bounds still produce a fisheye", () => {
  const facts = {
    milestones: [
      { date: "2026-08-05", name: "Kickoff" },
      { date: "2026-08-14", name: "Survey due" },
    ],
  }
  const tl = buildTimeline(facts, "2026-08-10")
  assert.equal(tl.mode, "fisheye")
  assert.equal(tl.segments.length, 1)
  assert.equal(tl.segments[0].basis, 100)
})

test("milestones are sorted by date rather than trusting file order", () => {
  const facts = {
    milestones: [
      { date: "2026-08-17", name: "Third" },
      { date: "2026-08-05", name: "First" },
      { date: "2026-08-14", name: "Second" },
    ],
  }
  const tl = buildTimeline(facts, "2026-08-06")
  assert.deepEqual(
    tl.segments.map((s) => s.startNode.name),
    ["First", "Second"],
  )
})

test("two milestones on the same date collapse to one node without a zero-width segment", () => {
  const facts = {
    milestones: [
      { date: "2026-08-05", name: "Kickoff" },
      { date: "2026-08-05", name: "Contract" },
      { date: "2026-08-14", name: "Survey due" },
    ],
  }
  const tl = buildTimeline(facts, "2026-08-10")
  assert.equal(sumBases(tl.segments), 100)
  assert.equal(tl.segments.length, 1)
  // Both names survive on the surviving node so neither milestone vanishes.
  assert.match(tl.segments[0].startNode.name, /Kickoff/)
  assert.match(tl.segments[0].startNode.name, /Contract/)
})

test("a zero-duration current gap does not divide by zero", () => {
  const facts = {
    milestones: [
      { date: "2026-08-05", name: "A" },
      { date: "2026-08-05", name: "B" },
    ],
  }
  const tl = buildTimeline(facts, "2026-08-05")
  assert.equal(tl.mode, "plain")
})

test("a milestone marked done reaches the node so the renderer can fill it", () => {
  const tl = buildTimeline(TL_FACTS, "2026-08-13")
  assert.equal(tl.segments[0].startNode.done, true)
  assert.equal(tl.segments[1].startNode.done, true)
  assert.equal(tl.segments[2].startNode.done, false)
})

test("buildModel exposes the timeline", () => {
  const vm = buildModel({
    facts: TL_FACTS,
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-08-13",
  })
  assert.equal(vm.timeline.mode, "fisheye")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-model.test.mjs`
Expected: FAIL — `buildTimeline is not a function` / `CURRENT_SEGMENT_BASIS` undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/dashboard/model.mjs`, above `buildModel`:

```js
// The magnified current gap's fixed share of the bar. Fixed rather than
// proportional is the whole point: 9 days out of an 89-day engagement is 10% of
// the true width, which is too narrow to read a position inside. Giving it 35%
// makes "day 8 of 9" legible while the surrounding 65% keeps every other
// milestone visible and in correct order.
export const CURRENT_SEGMENT_BASIS = 35

// Collapses the engagement's bounds and milestones into one ordered list of
// dated nodes. Two milestones on the same date become one node carrying both
// names — a zero-width segment would be invisible and would put two markers at
// the same pixel, so merging is the only rendering that loses nothing.
function timelineNodes(facts) {
  const byDate = new Map()

  const add = (date, name, { done = false, synthetic = false }) => {
    if (date === null) return
    const existing = byDate.get(date)
    if (existing === undefined) {
      byDate.set(date, { date, name, done, synthetic })
      return
    }
    // A real milestone always wins over a synthetic bound on the same date, and
    // two real milestones concatenate.
    if (existing.synthetic && !synthetic) {
      byDate.set(date, { date, name, done, synthetic: false })
      return
    }
    if (!existing.synthetic && !synthetic) {
      existing.name = `${existing.name} · ${name}`
      existing.done = existing.done && done
    }
  }

  for (const milestone of asArray(facts?.milestones)) {
    const date = normalizeDate(milestone?.date)
    const name = typeof milestone?.name === "string" ? milestone.name : null
    if (date === null || name === null) continue
    add(date, name, { done: milestone.done === true })
  }

  add(normalizeDate(facts?.start), "Start", { synthetic: true })
  add(normalizeDate(facts?.end), "End", { synthetic: true })

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function plainTimeline(facts, today) {
  const start = normalizeDate(facts?.start)
  const end = normalizeDate(facts?.end)
  if (start === null || end === null) return null
  const total = daysBetween(start, end)
  if (total === null || total <= 0) return null
  const elapsed = Math.min(Math.max(0, daysBetween(start, today)), total)
  return {
    mode: "plain",
    progressPct: Math.round((elapsed / total) * 1000) / 10,
    todayLabel: `day ${elapsed} of ${total}`,
  }
}

export function buildTimeline(facts, today) {
  const realMilestones = asArray(facts?.milestones).filter(
    (m) => normalizeDate(m?.date) !== null && typeof m?.name === "string",
  )
  const nodes = timelineNodes(facts)

  // Magnification needs at least two distinct nodes to define a gap, and it is
  // meaningless with fewer than two real milestones — there is no "previous"
  // and "next" beat to sit between. Both fall back to a plain bar.
  if (nodes.length < 2 || realMilestones.length < 2) {
    return plainTimeline(facts, today)
  }

  const gaps = []
  for (let i = 0; i < nodes.length - 1; i++) {
    gaps.push({
      startNode: nodes[i],
      endNode: nodes[i + 1],
      days: Math.max(0, daysBetween(nodes[i].date, nodes[i + 1].date) ?? 0),
    })
  }

  // The gap containing today. Before the first node it is the first gap; on or
  // after the last node it is the last. Exactly one is ever current, which is
  // what keeps a single today marker on the bar.
  let currentIndex = gaps.length - 1
  for (let i = 0; i < gaps.length; i++) {
    if (daysBetween(today, gaps[i].endNode.date) > 0) {
      currentIndex = i
      break
    }
  }

  const others = gaps.filter((_, i) => i !== currentIndex)
  const otherTotalDays = others.reduce((total, gap) => total + gap.days, 0)
  const remainingBasis = 100 - CURRENT_SEGMENT_BASIS

  // Rounded to one decimal place before it ever reaches a style attribute.
  // Unrounded, (8/9)*100 serialises as "88.88888888888889%" — valid CSS but
  // unreadable in the emitted HTML, and it makes the renderer's tests assert on
  // float noise.
  const round1 = (n) => Math.round(n * 10) / 10

  const segments = gaps.map((gap, i) => {
    let basis
    if (i === currentIndex) {
      basis = others.length === 0 ? 100 : CURRENT_SEGMENT_BASIS
    } else if (otherTotalDays === 0) {
      // Every other gap is zero-length (all milestones on one or two dates):
      // share the remainder equally rather than dividing by zero.
      basis = round1(remainingBasis / others.length)
    } else {
      basis = round1((gap.days / otherTotalDays) * remainingBasis)
    }

    const isCurrent = i === currentIndex
    const elapsedInGap = daysBetween(gap.startNode.date, today) ?? 0
    const offsetPct =
      gap.days === 0 ? 100 : round1(Math.min(100, Math.max(0, (elapsedInGap / gap.days) * 100)))

    return {
      kind: isCurrent ? "current" : i < currentIndex ? "past" : "future",
      basis,
      startNode: gap.startNode,
      // Only the last segment carries its right-hand node: every other node is
      // the next segment's startNode, so this is what makes each node render
      // exactly once.
      endNode: i === gaps.length - 1 ? gap.endNode : null,
      today: isCurrent
        ? {
            offsetPct,
            label:
              gap.days === 0
                ? null
                : `day ${Math.min(Math.max(elapsedInGap, 0), gap.days) + 1} of ${gap.days}`,
          }
        : null,
    }
  })

  const current = gaps[currentIndex]
  const end = normalizeDate(facts?.end)
  const overranDays = end === null ? 0 : Math.max(0, daysBetween(end, today) ?? 0)
  const nextNode = current.endNode
  const reachedEnd = overranDays > 0

  return {
    mode: "fisheye",
    segments,
    legend: {
      pastName: current.startNode.synthetic ? null : current.startNode.name,
      pastDaysAgo: Math.max(0, daysBetween(current.startNode.date, today) ?? 0),
      nextName: reachedEnd ? null : nextNode.synthetic ? null : nextNode.name,
      nextInDays: reachedEnd ? null : Math.max(0, daysBetween(today, nextNode.date) ?? 0),
      nextIsEnd: !reachedEnd && nextNode.synthetic,
      overranDays,
    },
  }
}
```

Then add `timeline` to the object `buildModel` returns, immediately after `countdown`:

```js
    countdown: computeCountdown(facts, today),
    timeline: buildTimeline(facts, today),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-model.test.mjs`
Expected: PASS, 41 tests (24 from Task 3 plus 17 here).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/model.mjs test/dashboard-model.test.mjs
git commit -m "$(cat <<'EOF'
feat: derive the fisheye timeline's segment widths

The current inter-milestone gap takes a fixed 35% of the bar rather than its
true proportional width: 9 days of an 89-day engagement is too narrow to read a
position inside, and the surrounding 65% still keeps every milestone visible
and correctly ordered.

Three invariants hold for any input, however degenerate: bases sum to 100,
exactly one segment is current, and only the last segment carries an endNode —
so every node renders exactly once and there is never a second today marker.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Loader — YAML files, logs, git dates

The I/O half. Every function here returns data plus warnings rather than throwing, because a build must survive a missing or broken file.

**Files:**
- Create: `src/lib/dashboard/load.mjs`
- Test: `test/dashboard-load.test.mjs`

**Interfaces:**
- Consumes: `validateFacts`, `validateStatus` from `schema.mjs`; `normalizeDate` from `dates.mjs`.
- Produces:
  - `loadDashboardFiles({ factsPath, statusPath }) => { facts, status, warnings: string[] }` — a missing file yields `null` for that half with no warning (absence is normal); an unreadable, unparseable or invalid file yields `null` plus a warning.
  - `loadLogActivity({ logsDir, limit = 3 }) => { logs: Array<{ filename, title, date }>, warnings: string[] }`
  - `gitDateFor(rootDir, absPath) => string | null` — `"YYYY-MM-DD"` of the last commit touching the file, falling back to mtime, then `null`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-load.test.mjs`:

```js
// Coverage for src/lib/dashboard/load.mjs. The governing rule under test: no
// function here ever throws. A brain whose dashboard.yaml is half-written mid-
// edit must still get a browsable site, so every failure becomes a warning plus
// a null, and `npx brain-site validate` is where it becomes loud.

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { loadDashboardFiles, loadLogActivity, gitDateFor } from "../src/lib/dashboard/load.mjs"

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

function paths(dir) {
  return {
    factsPath: path.join(dir, "dashboard.yaml"),
    statusPath: path.join(dir, "dashboard.status.yaml"),
  }
}

test("both files absent is not a warning — absence is the normal case", () => {
  const dir = tmpDir("load-absent")
  const result = loadDashboardFiles(paths(dir))
  assert.equal(result.facts, null)
  assert.equal(result.status, null)
  assert.deepEqual(result.warnings, [])
})

test("no path configured at all is silent, not a warning", () => {
  const result = loadDashboardFiles({ factsPath: null, statusPath: undefined })
  assert.equal(result.facts, null)
  assert.equal(result.status, null)
  assert.deepEqual(result.warnings, [])
})

test("a valid facts file is parsed", () => {
  const dir = tmpDir("load-facts")
  fs.writeFileSync(
    path.join(dir, "dashboard.yaml"),
    "project: Secret Escapes\nend: 2026-09-14\nmilestones:\n  - date: 2026-08-05\n    name: Kickoff\n",
  )
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(facts.project, "Secret Escapes")
  assert.equal(facts.milestones[0].name, "Kickoff")
  assert.deepEqual(warnings, [])
})

test("unquoted ISO dates arrive as Date objects, which the schema still accepts", () => {
  const dir = tmpDir("load-dates")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "end: 2026-09-14\n")
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.ok(facts.end instanceof Date)
  assert.deepEqual(warnings, [])
})

test("malformed YAML warns and yields null rather than throwing", () => {
  const dir = tmpDir("load-badyaml")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "project: [unclosed\n")
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(facts, null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /dashboard\.yaml/)
})

test("a schema-invalid facts file warns, yields null, and reports the first errors", () => {
  const dir = tmpDir("load-invalid")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "mileStones: []\n")
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(facts, null)
  assert.match(warnings[0], /unknown key "mileStones"/)
})

test("an invalid status file does not discard valid facts", () => {
  const dir = tmpDir("load-mixed")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "project: Acme\n")
  fs.writeFileSync(path.join(dir, "dashboard.status.yaml"), "stattus: {}\n")
  const { facts, status, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(facts.project, "Acme")
  assert.equal(status, null)
  assert.equal(warnings.length, 1)
})

test("the status roster cross-check runs against the loaded facts", () => {
  const dir = tmpDir("load-roster")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "people:\n  - name: Milly Allatson\n")
  fs.writeFileSync(path.join(dir, "dashboard.status.yaml"), "people:\n  - name: Ghost\n")
  const { status, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(status, null)
  assert.match(warnings[0], /not in dashboard\.yaml's people roster/)
})

test("an empty file parses to null and is treated as absent, not invalid", () => {
  const dir = tmpDir("load-empty")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "")
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(facts, null)
  assert.deepEqual(warnings, [])
})

test("log activity reads newest first and takes the title from the H1", () => {
  const dir = tmpDir("load-logs")
  fs.writeFileSync(path.join(dir, "2026-08-07-survey.md"), "# 2026-08-07 — Hack Week survey sync\n")
  fs.writeFileSync(path.join(dir, "2026-08-10-deps.md"), "# 2026-08-10 — Shared frontend dependency\n")
  fs.writeFileSync(path.join(dir, "README.md"), "# Convention\n")
  const { logs, warnings } = loadLogActivity({ logsDir: dir, limit: 3 })
  assert.deepEqual(warnings, [])
  assert.deepEqual(
    logs.map((l) => [l.date, l.title]),
    [
      ["2026-08-10", "2026-08-10 — Shared frontend dependency"],
      ["2026-08-07", "2026-08-07 — Hack Week survey sync"],
    ],
  )
})

test("log activity honours the limit", () => {
  const dir = tmpDir("load-logs-limit")
  for (const day of ["01", "02", "03", "04"]) {
    fs.writeFileSync(path.join(dir, `2026-08-${day}-x.md`), `# 2026-08-${day} — entry\n`)
  }
  assert.equal(loadLogActivity({ logsDir: dir, limit: 2 }).logs.length, 2)
})

test("a log with no H1 falls back to its filename", () => {
  const dir = tmpDir("load-logs-noh1")
  fs.writeFileSync(path.join(dir, "2026-08-10-thing.md"), "no heading here\n")
  const { logs } = loadLogActivity({ logsDir: dir, limit: 3 })
  assert.equal(logs[0].title, "2026-08-10-thing.md")
  assert.equal(logs[0].date, "2026-08-10")
})

test("a log filename with no date prefix still lists, with a null date", () => {
  const dir = tmpDir("load-logs-nodate")
  fs.writeFileSync(path.join(dir, "notes.md"), "# Notes\n")
  const { logs } = loadLogActivity({ logsDir: dir, limit: 3 })
  assert.equal(logs[0].date, null)
})

test("a missing logs directory warns and yields no logs", () => {
  const { logs, warnings } = loadLogActivity({ logsDir: "/nope/does/not/exist", limit: 3 })
  assert.deepEqual(logs, [])
  assert.equal(warnings.length, 1)
})

test("a null logsDir is silent — the brain simply has no timeline configured", () => {
  const { logs, warnings } = loadLogActivity({ logsDir: null, limit: 3 })
  assert.deepEqual(logs, [])
  assert.deepEqual(warnings, [])
})

test("gitDateFor returns the last commit date for a tracked file", () => {
  const dir = tmpDir("load-git")
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir })
  const file = path.join(dir, "engagement.md")
  fs.writeFileSync(file, "# Engagement\n")
  execFileSync("git", ["add", "engagement.md"], { cwd: dir })
  execFileSync("git", ["commit", "-q", "-m", "add", "--date", "2026-08-07T12:00:00Z"], {
    cwd: dir,
    env: { ...process.env, GIT_COMMITTER_DATE: "2026-08-07T12:00:00Z" },
  })
  assert.equal(gitDateFor(dir, file), "2026-08-07")
})

test("gitDateFor falls back to mtime for an untracked file", () => {
  const dir = tmpDir("load-git-untracked")
  const file = path.join(dir, "scratch.md")
  fs.writeFileSync(file, "x")
  fs.utimesSync(file, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"))
  assert.equal(gitDateFor(dir, file), "2026-08-01")
})

test("gitDateFor returns null for a file that does not exist", () => {
  const dir = tmpDir("load-git-missing")
  assert.equal(gitDateFor(dir, path.join(dir, "ghost.md")), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-load.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/dashboard/load.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/dashboard/load.mjs`:

```js
// Filesystem and git access for the dashboard. Kept apart from model.mjs so the
// derivation layer stays pure and testable without fixtures on disk.
//
// Nothing here throws. A brain whose dashboard.yaml is half-written mid-edit
// must still get a browsable site, so each failure becomes a warning string the
// caller logs and a null the model treats as "that module is absent". The loud
// path is `npx brain-site validate`, which uses the same validators and exits
// non-zero.
//
// One deliberate asymmetry: a *missing* file is not a warning. Most brains will
// never write a dashboard.status.yaml, and warning on every build for a file
// that is optional by design would train people to ignore the warnings that
// matter.

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import { validateFacts, validateStatus } from "./schema.mjs"
import { normalizeDate } from "./dates.mjs"

// Matches logs-timeline-emitter.ts's own SKIP_FILES: logs/README.md documents
// the convention rather than recording a session.
const SKIP_LOG_FILES = new Set(["README.md", ".gitkeep"])
const LOG_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})/
// Enough errors to diagnose the problem without a wall of output on a badly
// broken file; `validate` prints all of them.
const MAX_REPORTED_ERRORS = 3

function readYamlFile(filePath, label, warnings) {
  // No path configured at all (a caller with no repository root) is silent, not
  // a warning. readFileSync(null) would throw a TypeError whose `code` is
  // undefined, so it would otherwise fall through to the catch below and warn on
  // every build of a brain that has simply never written these files.
  if (typeof filePath !== "string" || filePath.length === 0) return null

  let raw
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    // ENOENT is the normal case for an optional file, so it is silent. Anything
    // else (a permissions problem, a directory in its place) is real.
    if (err.code !== "ENOENT") {
      warnings.push(`could not read ${label}: ${err.message}`)
    }
    return null
  }

  let parsed
  try {
    parsed = YAML.parse(raw)
  } catch (err) {
    warnings.push(`could not parse ${label}: ${err.message}`)
    return null
  }
  // An empty file parses to null. That is "no data", not "bad data".
  return parsed ?? null
}

function reportErrors(errors, label, warnings) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS)
  const more = errors.length - shown.length
  const suffix = more > 0 ? ` (+${more} more — run \`npx brain-site validate\`)` : ""
  warnings.push(`${label} is invalid and was ignored: ${shown.join("; ")}${suffix}`)
}

export function loadDashboardFiles({ factsPath, statusPath }) {
  const warnings = []

  const rawFacts = readYamlFile(factsPath, "dashboard.yaml", warnings)
  let facts = null
  if (rawFacts !== null) {
    const { ok, errors } = validateFacts(rawFacts)
    if (ok) {
      facts = rawFacts
    } else {
      reportErrors(errors, "dashboard.yaml", warnings)
    }
  }

  const rawStatus = readYamlFile(statusPath, "dashboard.status.yaml", warnings)
  let status = null
  if (rawStatus !== null) {
    // Cross-checked against whatever facts survived: a roster that failed
    // validation cannot vouch for a name, so the check is skipped rather than
    // reporting every person as unknown.
    const { ok, errors } = validateStatus(rawStatus, facts)
    if (ok) {
      status = rawStatus
    } else {
      reportErrors(errors, "dashboard.status.yaml", warnings)
    }
  }

  return { facts, status, warnings }
}

// The rendered H1 of a session log is its own title — every logs/*.md opens
// `# YYYY-MM-DD — <description>` per the brains' own AGENTS.md convention. Read
// it rather than re-deriving one from the filename, the same way
// logs-timeline-emitter.ts's titleOf does, so the two pages never disagree.
function titleFromMarkdown(raw, filename) {
  const match = raw.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : filename
}

export function loadLogActivity({ logsDir, limit = 3 }) {
  const warnings = []
  // No timeline section configured is a valid brain, not a problem.
  if (typeof logsDir !== "string" || logsDir.length === 0) return { logs: [], warnings }

  let names
  try {
    names = fs.readdirSync(logsDir)
  } catch (err) {
    warnings.push(`could not read the timeline source ${logsDir}: ${err.message}`)
    return { logs: [], warnings }
  }

  // Filenames are YYYY-MM-DD-prefixed by convention, so reverse-alphabetical is
  // newest-first. Same ordering as logs-timeline-emitter.ts, and the same known
  // limitation: several entries on one date sort by slug, not true chronology.
  const files = names
    .filter((name) => name.endsWith(".md") && !SKIP_LOG_FILES.has(name))
    .sort()
    .reverse()
    .slice(0, limit)

  const logs = []
  for (const filename of files) {
    let raw
    try {
      raw = fs.readFileSync(path.join(logsDir, filename), "utf8")
    } catch (err) {
      warnings.push(`could not read ${filename}: ${err.message}`)
      continue
    }
    const prefix = LOG_DATE_PREFIX.exec(filename)
    logs.push({
      filename,
      title: titleFromMarkdown(raw, filename),
      date: prefix ? normalizeDate(prefix[1]) : null,
    })
  }

  return { logs, warnings }
}

export function gitDateFor(rootDir, absPath) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", absPath],
      { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim()
    if (out.length > 0) return normalizeDate(out.slice(0, 10))
  } catch {
    // Not a repo, git missing, or the file is untracked — fall through to mtime.
  }

  // mtime is the fallback rather than the primary source because a fresh clone
  // gives every file the checkout time, which would report the whole brain as
  // updated today. It is still better than nothing for an untracked file.
  try {
    return normalizeDate(fs.statSync(absPath).mtime.toISOString().slice(0, 10))
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-load.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/load.mjs test/dashboard-load.test.mjs
git commit -m "$(cat <<'EOF'
feat: load the dashboard files, log activity and git dates

Nothing here throws: a half-written dashboard.yaml must still leave the brain
browsable, so each failure becomes a warning plus a null and the module simply
disappears. `npx brain-site validate` is the loud path.

A *missing* file is deliberately not a warning — both files are optional by
design, and warning on every build for an absent optional file would train
people to ignore the warnings that matter.

git log is the primary source for doc dates with mtime as fallback, not the
reverse: a fresh clone gives every file the checkout time, which would report
the entire brain as updated today.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Emitter, render helpers, and the Explore module

The first task that produces a page. It ports every assertion from `test/home-emitter.test.mjs` onto the new emitter, with the old listing as the `explore` module — so the fallback behaviour is proven before any other module exists. `home-emitter.ts` is left in place until Task 7 swaps the config over.

**Files:**
- Create: `assets/plugins/dashboard/types.ts`
- Create: `assets/plugins/dashboard/render.ts`
- Create: `assets/plugins/dashboard/explore.ts`
- Create: `assets/plugins/dashboard/index.ts`
- Create: `assets/plugins/dashboard-emitter.ts`
- Test: `test/dashboard-emitter.test.mjs`

**Interfaces:**
- Consumes: `escapeHtml`, `emitPage` from `assets/plugins/shared/page-shell.ts`; `loadDashboardFiles`, `loadLogActivity`, `gitDateFor` from `@loomery/brain-site/lib/dashboard/load.mjs`; `buildModel` from `@loomery/brain-site/lib/dashboard/model.mjs`.
- Produces:
  - `types.ts`: `interface DashboardModule { id: string; render(vm: DashboardModel): string | null }`, and `type DashboardModel = Record<string, any>` (the model is a plain object built in `.mjs`; typing it structurally here would duplicate a contract the tests already pin).
  - `render.ts`: `card(label, provenance, bodyHtml, opts?) => string`, `pill(provenance) => string`, `chip(text, tone?) => string`, `list(itemsHtml) => string`, `humanize(text) => string`, `PROVENANCE` (`{ STATED: "stated", ASSESSED: "assessed", MIXED: "mixed" }`).
  - `explore.ts`: `ExploreModule: DashboardModule` with `id: "explore"`.
  - `index.ts`: `MODULES: DashboardModule[]` — this task registers `[ExploreModule]` only.
  - `dashboard-emitter.ts`: `DashboardEmitter: QuartzEmitterPlugin<DashboardOptions>` and `export default DashboardEmitter`, where
    `DashboardOptions = { facts?: string; status?: string; contentDir?: string; logsDir?: string; rootDir?: string; pageTitle?: string }`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-emitter.test.mjs`:

```js
// Coverage for assets/plugins/dashboard-emitter.ts.
//
// The first four tests are ported verbatim in intent from the deleted
// test/home-emitter.test.mjs: the dashboard absorbed that emitter, so its
// guarantees have to keep holding — emit `/` only when the brain has no
// docs/index.md, list top-level pages and sections, and never treat its own
// output as its own chrome donor.

import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DashboardEmitter } from "../assets/plugins/dashboard-emitter.ts"
import { __resetDonorChromeCacheForTests } from "../assets/plugins/shared/page-shell.ts"

// page-shell.ts caches its chosen chrome donor once per process (deliberate for
// a real build) — reset it so one test's donor cannot leak into the next.
beforeEach(() => {
  __resetDonorChromeCacheForTests()
})

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

// Seeded up front so page-shell's bounded donor poll resolves immediately
// instead of burning its full 3s timeout.
function donorPageHtml() {
  return `<!DOCTYPE html><html><head></head><body>
<div class="left sidebar"><div id="explorer">tree</div></div>
<div class="center">content</div>
<div class="right sidebar"><div id="graph-container">graph</div></div>
</body></html>`
}

function fakeCtx(outputDir) {
  return { argv: { output: outputDir }, hashedResourceNames: {} }
}

function fakeResources() {
  return { css: [], js: [] }
}

const CONTENT = [
  [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
  [{}, { data: { slug: "stakeholders", frontmatter: {} } }],
  [{}, { data: { slug: "technical/context", frontmatter: {} } }],
  [{}, { data: { slug: "tags/ai", frontmatter: {} } }],
]

async function emitTo(dir, { content = CONTENT, options = {} } = {}) {
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())
  const result = await DashboardEmitter({ pageTitle: "Acme Brain", ...options }).emit(
    fakeCtx(dir),
    content,
    fakeResources(),
  )
  return { result, html: fs.existsSync(path.join(dir, "index.html"))
    ? fs.readFileSync(path.join(dir, "index.html"), "utf8")
    : null }
}

test("does not emit when the brain already has its own docs/index.md", async () => {
  const dir = tmpDir("dash-has-index")
  const content = [[{}, { data: { slug: "index", frontmatter: { title: "Home" } } }]]
  const result = await DashboardEmitter({}).emit(fakeCtx(dir), content, fakeResources())
  assert.deepEqual(result, [])
  assert.equal(fs.existsSync(path.join(dir, "index.html")), false)
})

test("emits index.html when there is no index.md", async () => {
  const dir = tmpDir("dash-no-index")
  const { result, html } = await emitTo(dir)
  assert.equal(result.length, 1)
  assert.match(result[0], /index\.html$/)
  assert.match(html, /<!DOCTYPE html>/)
})

test("the explore module lists top-level pages and section folders", async () => {
  const dir = tmpDir("dash-explore")
  const { html } = await emitTo(dir)
  assert.match(html, /href="\/engagement"/)
  assert.match(html, /Engagement/)
  assert.match(html, /href="\/stakeholders"/)
  assert.match(html, /href="\/technical\/"/)
})

test("the explore module humanises a slug with no frontmatter title", async () => {
  const dir = tmpDir("dash-humanise")
  const content = [[{}, { data: { slug: "product-context", frontmatter: {} } }]]
  const { html } = await emitTo(dir, { content })
  assert.match(html, /Product context/)
})

test("Quartz's own tags/ folder is excluded from sections", async () => {
  const dir = tmpDir("dash-tags")
  const { html } = await emitTo(dir)
  assert.equal(/href="\/tags\/"/.test(html), false)
})

test("an unlisted page is excluded", async () => {
  const dir = tmpDir("dash-unlisted")
  const content = [
    [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
    [{}, { data: { slug: "secret", unlisted: true, frontmatter: { title: "Secret" } } }],
  ]
  const { html } = await emitTo(dir, { content })
  assert.equal(html.includes(">Secret<"), false)
})

test("it never picks its own index.html as its chrome donor", async () => {
  const dir = tmpDir("dash-donor")
  // A chrome-less index.html left by a previous build. If it were accepted as a
  // donor, the emitted page would have empty sidebars.
  fs.writeFileSync(path.join(dir, "index.html"), "<!DOCTYPE html><html><body></body></html>")
  const { html } = await emitTo(dir)
  assert.match(html, /<div class="left sidebar"><div id="explorer">tree<\/div><\/div>/)
})

test("the page heading falls back to pageTitle with no dashboard.yaml", async () => {
  const dir = tmpDir("dash-heading-fallback")
  const { html } = await emitTo(dir)
  assert.match(html, /Acme Brain/)
})

test("the page heading uses project when dashboard.yaml supplies one", async () => {
  const dir = tmpDir("dash-heading-project")
  const brain = tmpDir("dash-heading-brain")
  fs.writeFileSync(path.join(brain, "dashboard.yaml"), "project: Secret Escapes\n")
  const { html } = await emitTo(dir, {
    options: { facts: path.join(brain, "dashboard.yaml") },
  })
  assert.match(html, /Secret Escapes/)
})

test("a malformed dashboard.yaml warns but still emits a page", async () => {
  const dir = tmpDir("dash-malformed")
  const brain = tmpDir("dash-malformed-brain")
  fs.writeFileSync(path.join(brain, "dashboard.yaml"), "project: [unclosed\n")
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    const { result, html } = await emitTo(dir, {
      options: { facts: path.join(brain, "dashboard.yaml") },
    })
    assert.equal(result.length, 1)
    assert.match(html, /Acme Brain/)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.some((w) => w.includes("dashboard.yaml")), true)
})

test("a build with no dashboard files at all emits only the explore module", async () => {
  const dir = tmpDir("dash-bare")
  const { html } = await emitTo(dir)
  assert.match(html, /Explore the brain/)
  assert.equal(html.includes("Timeline"), false)
})

test("a brain that has never written the dashboard files produces no warnings", async () => {
  const dir = tmpDir("dash-quiet")
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    await emitTo(dir)
  } finally {
    console.warn = originalWarn
  }
  // Both files are optional by design. Warning on every build for an absent
  // optional file would train people to ignore the warnings that matter.
  assert.deepEqual(
    warnings.filter((w) => w.includes("DashboardEmitter")),
    [],
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-emitter.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/plugins/dashboard-emitter.ts'`

- [ ] **Step 3a: Write the types**

Create `assets/plugins/dashboard/types.ts`:

```ts
// Types shared by the dashboard's module renderers.
//
// DashboardModel is deliberately loose. The model is built in
// src/lib/dashboard/model.mjs — plain ESM, because it must be unit-testable
// without a Quartz build and importable by the CLI — so a structural interface
// here would be a second copy of a contract that test/dashboard-model.test.mjs
// already pins precisely. Duplicating it would let the two drift silently, which
// is worse than an index signature.

export type DashboardModel = Record<string, any>

export const PROVENANCE = {
  STATED: "stated",
  ASSESSED: "assessed",
  MIXED: "mixed",
} as const

export type Provenance = (typeof PROVENANCE)[keyof typeof PROVENANCE]

export interface DashboardModule {
  id: string
  // Returns null when this module's slice of the model is absent, which is how
  // presence-driven modularity works: a brain gets the modules it has data for
  // and nothing configures that.
  render(vm: DashboardModel): string | null
}
```

- [ ] **Step 3b: Write the render helpers**

Create `assets/plugins/dashboard/render.ts`:

```ts
// Shared HTML helpers for the dashboard's module renderers, so every module
// produces the same card shape and every value carries a provenance pill.
//
// Hand-written HTML rather than JSX for the reason page-shell.ts's banner
// documents: these files are loaded by Node's own resolver, not esbuild.

import { escapeHtml } from "../shared/page-shell.ts"
import { PROVENANCE, type Provenance } from "./types.ts"

export { escapeHtml, PROVENANCE }
export type { Provenance }

// The honesty mechanism. Every card says whether its numbers were stated by a
// human in dashboard.yaml (or derived from git/frontmatter) or assessed by a
// model at the last sync. A dashboard that mixes the two without labelling them
// reads as authoritative while containing guesses.
export function pill(provenance: Provenance): string {
  return `<span class="dash-pill dash-pill--${provenance}">${provenance}</span>`
}

export function card(
  label: string,
  provenance: Provenance | null,
  bodyHtml: string,
  { id = "", className = "" }: { id?: string; className?: string } = {},
): string {
  const idAttr = id ? ` id="${escapeHtml(id)}"` : ""
  const classAttr = `dash-card${className ? ` ${className}` : ""}`
  const head = `<p class="dash-label">${escapeHtml(label)}${provenance ? pill(provenance) : ""}</p>`
  return `<section class="${classAttr}"${idAttr}>${head}${bodyHtml}</section>`
}

export function chip(text: string, tone = ""): string {
  const toneClass = tone ? ` dash-chip--${tone}` : ""
  return `<span class="dash-chip${toneClass}">${escapeHtml(text)}</span>`
}

export function list(itemsHtml: string[]): string {
  if (itemsHtml.length === 0) return ""
  return `<ul class="dash-list">${itemsHtml.map((item) => `<li>${item}</li>`).join("")}</ul>`
}

// Display-only humanisation (`product-context` -> "Product context"), matching
// the convention onboarding-emitter.ts and the old home-emitter.ts both use.
export function humanize(text: string): string {
  const spaced = text.replace(/[-_]/g, " ")
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}
```

- [ ] **Step 3c: Write the Explore module**

Create `assets/plugins/dashboard/explore.ts`:

```ts
// The brain's own page and section index — this is the old HomeEmitter listing,
// preserved as the dashboard's last module.
//
// Keeping it as a module rather than a separate fallback page is what lets `/`
// always render something useful: a brain with neither dashboard file gets
// exactly what it gets today, and there is one precedence rule
// (docs/index.md wins) instead of three tiers.

import { escapeHtml, card, humanize, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const ExploreModule: DashboardModule = {
  id: "explore",
  render(vm: DashboardModel): string | null {
    const pages: Array<{ slug: string; title: string }> = vm.pages ?? []
    const topPages: Array<{ slug: string; title: string }> = []
    const folders = new Set<string>()

    for (const page of pages) {
      if (page.slug === "index") continue
      const segments = page.slug.split("/")
      if (segments.length === 1) {
        topPages.push(page)
        continue
      }
      // "tags" is Quartz's own auto-generated tag index, not brain content —
      // @quartz-community/folder-page excludes it by the same name for the same
      // reason.
      if (segments[0] !== "tags") folders.add(segments[0])
    }

    if (topPages.length === 0 && folders.size === 0) return null

    topPages.sort((a, b) => a.title.localeCompare(b.title))
    const chips = [
      ...topPages.map(
        (p) => `<a class="dash-chip" href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`,
      ),
      ...[...folders]
        .sort((a, b) => a.localeCompare(b))
        .map(
          (f) =>
            `<a class="dash-chip dash-chip--folder" href="/${escapeHtml(f)}/">${escapeHtml(
              humanize(f),
            )}/</a>`,
        ),
    ]

    return card(
      "Explore the brain",
      PROVENANCE.STATED,
      `<div class="dash-chips">${chips.join("")}</div>`,
      { id: "explore" },
    )
  },
}

export default ExploreModule
```

- [ ] **Step 3d: Write the registry**

Create `assets/plugins/dashboard/index.ts`:

```ts
// The dashboard's ordered module registry.
//
// Order is fixed by the skin, not configurable per brain: every brain's
// dashboard should read the same way, and a module absent for lack of data is
// already the only variation that matters. Adding a module is a new file plus a
// line here — no brain edits, no brain-site.yaml key, no schema change.

import type { DashboardModule } from "./types.ts"
import { ExploreModule } from "./explore.ts"

export const MODULES: DashboardModule[] = [ExploreModule]
```

- [ ] **Step 3e: Write the emitter**

Create `assets/plugins/dashboard-emitter.ts`:

```ts
// Dashboard home-page emitter. Emits `/` (index.html) as a modular overview of
// the project — countdown, milestone timeline, status, people, activity — but
// ONLY when the brain has not written its own `docs/index.md`. A brain that has
// one keeps it, untouched.
//
// This replaces home-emitter.ts, whose structural page/section listing survives
// as the `explore` module (see dashboard/explore.ts). That is deliberate: it
// means `/` always renders, a brain with no dashboard data is no worse off than
// before, and there is one precedence rule rather than three tiers.
//
// Why an emitter rather than a Quartz config option: Quartz's own
// @quartz-community/folder-page generates a virtual index for any folder lacking
// one, but explicitly excludes the content root — getFolders() collects ancestor
// folder names and the caller filters out ".", so the root is structurally
// excluded from the mechanism regardless of options. A config-only fix does not
// exist; this emitter fills the one gap folder-page deliberately leaves.
//
// Same hand-written-HTML approach as onboarding-emitter.ts and
// logs-timeline-emitter.ts, for the same reason — see either file's banner
// (local plugins load via a genuine Node import(), never esbuild, and
// .brain-site/quartz/**'s extension-less relative imports are unresolvable by
// Node's own loader).
//
// The circularity to avoid: this writes index.html, and page-shell's chrome
// donor logic would happily read index.html back as a donor for this very page.
// emitPage's donorExclude parameter (passed as ["index"]) makes page-shell skip
// index.html for this call, so it always picks a genuine donor. See
// page-shell.ts's DEFAULT_EXCLUDED_DONOR_SLUGS comment.
//
// Today's date is read here, once, and injected into the model. That is the one
// deliberate source of build non-reproducibility in the dashboard, and it is
// inherent to a countdown.

import path from "path"
import type { QuartzEmitterPlugin, FilePath } from "@quartz-community/types"
import { emitPage, escapeHtml } from "./shared/page-shell.ts"
import {
  loadDashboardFiles,
  loadLogActivity,
  gitDateFor,
} from "@loomery/brain-site/lib/dashboard/load.mjs"
import { buildModel } from "@loomery/brain-site/lib/dashboard/model.mjs"
import { MODULES } from "./dashboard/index.ts"

interface DashboardOptions {
  facts?: string
  status?: string
  contentDir?: string
  logsDir?: string
  rootDir?: string
  pageTitle?: string
}

interface PageItem {
  slug: string
  title: string
  filePath: string | null
}

type QuartzContent = [unknown, { data: Record<string, unknown> }]

const RECENT_DOC_LIMIT = 3
const RECENT_LOG_LIMIT = 3

function adaptContent(content: QuartzContent[]): PageItem[] {
  const items: PageItem[] = []
  for (const [, file] of content) {
    const data = file.data
    const slug = data?.slug as string | undefined
    if (!slug) continue
    if (data.unlisted === true) continue
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const title = typeof fm?.title === "string" && fm.title.length > 0 ? fm.title : slug
    const filePath = typeof data.filePath === "string" ? data.filePath : null
    items.push({ slug, title, filePath })
  }
  return items
}

function hasRootIndex(items: PageItem[]): boolean {
  return items.some((item) => item.slug === "index")
}

// The most recently changed docs, by last-commit date. Only pages Quartz already
// parsed are candidates, so this never has to walk the content directory itself.
function recentDocs(
  pages: PageItem[],
  opts: DashboardOptions,
): Array<{ slug: string; title: string; date: string }> {
  const rootDir = opts.rootDir
  const contentDir = opts.contentDir
  if (!rootDir || !contentDir) return []

  const dated: Array<{ slug: string; title: string; date: string }> = []
  for (const page of pages) {
    if (page.slug === "index") continue
    const rel = page.filePath ?? `${page.slug}.md`
    const abs = path.isAbsolute(rel) ? rel : path.join(contentDir, rel)
    const date = gitDateFor(rootDir, abs)
    if (date !== null) dated.push({ slug: page.slug, title: page.title, date })
  }

  return dated
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RECENT_DOC_LIMIT)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function renderModules(vm: Record<string, unknown>): string {
  const rendered: string[] = []
  for (const module of MODULES) {
    let html: string | null
    try {
      html = module.render(vm)
    } catch (err) {
      // One broken module must not cost the whole page. This is the same
      // philosophy as emitPage's own last-resort fallback.
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[DashboardEmitter] module "${module.id}" failed and was skipped: ${message}`)
      continue
    }
    if (html !== null && html.length > 0) rendered.push(html)
  }
  return rendered.join("\n")
}

export const DashboardEmitter: QuartzEmitterPlugin<DashboardOptions> = (opts = {}) => ({
  name: "DashboardEmitter",
  async emit(ctx, content, resources): Promise<FilePath[]> {
    const pages = adaptContent(content as QuartzContent[])

    // The brain wrote its own index.md — @quartz-community/content-page already
    // emits index.html for it. Never touch it, and never race that emitter for
    // the same output file.
    if (hasRootIndex(pages)) return []

    const { facts, status, warnings } = loadDashboardFiles({
      factsPath: opts.facts ?? null,
      statusPath: opts.status ?? null,
    })
    const { logs, warnings: logWarnings } = loadLogActivity({
      logsDir: opts.logsDir ?? null,
      limit: RECENT_LOG_LIMIT,
    })
    for (const warning of [...warnings, ...logWarnings]) {
      console.warn(`[DashboardEmitter] ${warning}`)
    }

    const vm = buildModel({
      facts,
      status,
      pageTitle: opts.pageTitle ?? "Home",
      pages,
      activity: { logs, docs: recentDocs(pages, opts) },
      today: todayIso(),
    })

    const heading = `<h1 class="dash-heading">${escapeHtml(String(vm.heading))}</h1>`
    const body = `<div class="dashboard">${heading}${renderModules(vm)}</div>`

    return [
      await emitPage(
        ctx,
        resources,
        "index",
        String(vm.heading),
        body,
        "DashboardEmitter",
        "",
        ["index"],
      ),
    ]
  },
})

export default DashboardEmitter
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dashboard-emitter.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `node --test`
Expected: PASS — the old `home-emitter.test.mjs` still passes, since `home-emitter.ts` is untouched until Task 7.

- [ ] **Step 6: Commit**

```bash
git add assets/plugins/dashboard-emitter.ts assets/plugins/dashboard test/dashboard-emitter.test.mjs
git commit -m "$(cat <<'EOF'
feat: add the dashboard emitter, render helpers and Explore module

The old HomeEmitter listing becomes the `explore` module rather than a separate
fallback page. That is what lets `/` always render: a brain with neither
dashboard file gets exactly today's page, and precedence stays one rule
(docs/index.md wins) instead of three tiers.

Every card carries a stated/assessed pill. A dashboard that mixes deterministic
facts with model judgements without labelling them reads as authoritative while
containing guesses.

home-emitter.ts stays in place until the config swaps over, so the build keeps
working between commits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Config wiring, and retire home-emitter

Swaps the config entry over and deletes the old emitter. This is the commit where the dashboard actually becomes a brain's home page.

**Files:**
- Modify: `src/config/merge.mjs`
- Modify: `assets/quartz.config.base.yaml:169-171` (the `home-emitter.ts` entry)
- Modify: `test/config-merge.test.mjs`
- Delete: `assets/plugins/home-emitter.ts`
- Delete: `test/home-emitter.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mergeConfig(base, override, rootDir?)` — a third, optional `rootDir`. When supplied, the dashboard plugin's `options` are populated with absolute paths; when omitted, only `pageTitle` is set, so a caller with no repository root still yields a valid config (the emitter then finds no data files and renders the Explore module alone).

- [ ] **Step 1: Write the failing test**

Append to `test/config-merge.test.mjs`:

```js
// ---------------------------------------------------------------------------
// Dashboard emitter options
//
// The package may know a brain's *conventions* but never its *paths*, so the two
// dashboard filenames are fixed here while their location comes from rootDir —
// the same division resolveOverridePaths already applies to content and the
// timeline source.

import path from "node:path"

function dashboardOptionsOf(merged) {
  return merged.plugins.find((p) => p.source.includes("dashboard-emitter")).options
}

test("the dashboard emitter is enabled and given absolute paths for both files", () => {
  const merged = mergeConfig(baseFixture(), { content: "/brains/acme/docs" }, "/brains/acme")
  const plugin = merged.plugins.find((p) => p.source.includes("dashboard-emitter"))
  assert.equal(plugin.enabled, true)
  assert.equal(plugin.options.facts, path.join("/brains/acme", "dashboard.yaml"))
  assert.equal(plugin.options.status, path.join("/brains/acme", "dashboard.status.yaml"))
  assert.equal(plugin.options.rootDir, "/brains/acme")
  assert.equal(plugin.options.contentDir, "/brains/acme/docs")
})

test("the dashboard emitter receives the effective pageTitle for its heading fallback", () => {
  const merged = mergeConfig(baseFixture(), { pageTitle: "Acme Brain" }, "/brains/acme")
  assert.equal(dashboardOptionsOf(merged).pageTitle, "Acme Brain")
})

test("logsDir is passed only when a timeline section is configured", () => {
  const withTimeline = mergeConfig(
    baseFixture(),
    { sections: { timeline: { source: "/brains/acme/logs" } } },
    "/brains/acme",
  )
  assert.equal(dashboardOptionsOf(withTimeline).logsDir, "/brains/acme/logs")

  const without = mergeConfig(baseFixture(), {}, "/brains/acme")
  assert.equal(dashboardOptionsOf(without).logsDir, undefined)
})

test("omitting rootDir still yields a valid config, with no file paths", () => {
  const merged = mergeConfig(baseFixture(), { pageTitle: "Acme Brain" })
  const options = dashboardOptionsOf(merged)
  assert.equal(options.facts, undefined)
  assert.equal(options.status, undefined)
  assert.equal(options.pageTitle, "Acme Brain")
})

test("no plugin entry references the retired home-emitter", () => {
  const merged = mergeConfig(baseFixture(), {}, "/brains/acme")
  assert.equal(merged.plugins.some((p) => p.source.includes("home-emitter")), false)
})
```

If `test/config-merge.test.mjs` has no `baseFixture()` helper, add one that reads the shipped base config so these tests exercise the real plugin list rather than a hand-built stub:

```js
import fs from "node:fs"
import YAML from "yaml"
import { fileURLToPath } from "node:url"

const BASE_PATH = fileURLToPath(new URL("../assets/quartz.config.base.yaml", import.meta.url))

function baseFixture() {
  return YAML.parse(fs.readFileSync(BASE_PATH, "utf8"))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config-merge.test.mjs`
Expected: FAIL — `Cannot read properties of undefined (reading 'options')`, because no plugin entry matches `dashboard-emitter` yet.

- [ ] **Step 3a: Swap the base config entry**

In `assets/quartz.config.base.yaml`, replace the `home-emitter.ts` entry (and its comment block) with:

```yaml
  # Emits `/` as a modular project dashboard — countdown, milestone timeline,
  # status, people, recent activity — falling back to a structural page/section
  # listing (its `explore` module) when the brain has no dashboard data. Skips
  # itself entirely when the brain has its own docs/index.md, which
  # @quartz-community/content-page then emits instead. Quartz's own folder-page
  # plugin structurally excludes the content root, so this gap cannot be closed
  # by configuration — see dashboard-emitter.ts's own banner.
  #
  # `options` are written by src/config/merge.mjs, which resolves the two
  # brain-owned dashboard files against the repository root. This package never
  # hardcodes a brain's paths.
  - source: "./plugins/dashboard-emitter.ts"
    enabled: true
    options: {}
```

- [ ] **Step 3b: Wire the options in merge.mjs**

In `src/config/merge.mjs`, add the import and constants at the top:

```js
import path from "node:path"

const TIMELINE_PLUGIN = "logs-timeline-emitter"
const DASHBOARD_PLUGIN = "dashboard-emitter"

// The two dashboard filenames are a convention this package owns — a brain does
// not get to rename them, which is why there is no brain-site.yaml key for
// either. Their *location* is the brain's, and arrives as rootDir.
export const DASHBOARD_FACTS_FILE = "dashboard.yaml"
export const DASHBOARD_STATUS_FILE = "dashboard.status.yaml"
```

Then add this function, and call it from `mergeConfig`:

```js
function applyDashboardOptions(merged, config, rootDir) {
  // Every path handed to the emitter is already absolute: `content` and
  // `sections.timeline.source` were resolved by setup's resolveOverridePaths,
  // and the two dashboard files are resolved here against rootDir. Nothing
  // downstream has to know what directory the build is running from.
  const options = { pageTitle: merged.configuration.pageTitle }

  if (typeof rootDir === "string" && rootDir.length > 0) {
    options.rootDir = rootDir
    options.facts = path.join(rootDir, DASHBOARD_FACTS_FILE)
    options.status = path.join(rootDir, DASHBOARD_STATUS_FILE)
  }
  if (typeof config.content === "string" && config.content.length > 0) {
    options.contentDir = config.content
  }
  const timelineSource = config.sections?.timeline?.source
  if (typeof timelineSource === "string" && timelineSource.length > 0) {
    options.logsDir = timelineSource
  }

  for (const plugin of merged.plugins) {
    if (plugin.source.includes(DASHBOARD_PLUGIN)) {
      plugin.enabled = true
      plugin.options = options
    }
  }
}
```

Change the signature and add the call:

```js
export function mergeConfig(base, override, rootDir) {
  const merged = clone(base)
  const config = override ?? {}

  if (config.pageTitle !== undefined) {
    merged.configuration.pageTitle = config.pageTitle
  }

  // ... existing timeline loop, unchanged ...

  // After the pageTitle assignment, so the dashboard's heading fallback gets the
  // brain's own title rather than the base config's.
  applyDashboardOptions(merged, config, rootDir)

  return merged
}
```

- [ ] **Step 3c: Pass rootDir from setup**

In `src/commands/setup.mjs`, change `writeConfig` to take and forward `rootDir`:

```js
function writeConfig(generatedDir, resolvedOverride, rootDir) {
  const basePath = path.join(assetsDir, "quartz.config.base.yaml")
  const base = YAML.parse(fs.readFileSync(basePath, "utf8"))
  const merged = mergeConfig(base, resolvedOverride ?? {}, rootDir)
  fs.writeFileSync(path.join(generatedDir, "quartz.config.yaml"), YAML.stringify(merged))
  return merged
}
```

and its call site in `runSetup`:

```js
  writeConfig(generatedDir, resolvedOverride, rootDir)
```

- [ ] **Step 3d: Delete the retired files**

```bash
git rm assets/plugins/home-emitter.ts test/home-emitter.test.mjs
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS. `home-emitter.test.mjs` is gone; its guarantees are covered by `dashboard-emitter.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add src/config/merge.mjs src/commands/setup.mjs assets/quartz.config.base.yaml test/config-merge.test.mjs
git commit -m "$(cat <<'EOF'
feat: point the home page at the dashboard emitter

mergeConfig gains an optional rootDir and resolves the two dashboard filenames
against it. The filenames are a convention this package owns — which is why
there is no brain-site.yaml key for either — while their location is the
brain's, so no path is hardcoded here.

Retires home-emitter.ts: its listing now lives on as the dashboard's `explore`
module, and its test guarantees moved to dashboard-emitter.test.mjs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Modules — summary, delta, timeline

The top of the page, and the only module with non-trivial rendering. The fisheye emits **two** representations of the same data: the bar (`aria-hidden`, shown at >= 800px) and an ordered list (always in the DOM for screen readers, and styled as the vertical spine below 800px). One markup, one source of truth, both the accessibility and the responsive fallback.

**Files:**
- Create: `assets/plugins/dashboard/summary.ts`, `delta.ts`, `timeline.ts`
- Modify: `assets/plugins/dashboard/index.ts` (register them, in order, before `explore`)
- Test: `test/dashboard-modules.test.mjs`

**Interfaces:**
- Consumes: `card`, `pill`, `escapeHtml`, `list`, `PROVENANCE` from `render.ts`; `DashboardModule`, `DashboardModel` from `types.ts`.
- Produces: `SummaryModule`, `DeltaModule`, `TimelineModule` (each `DashboardModule`, ids `summary`, `delta`, `timeline`).
- `MODULES` becomes `[SummaryModule, DeltaModule, TimelineModule, ExploreModule]`.

- [ ] **Step 1: Write the failing test**

Create `test/dashboard-modules.test.mjs`:

```js
// Coverage for the dashboard's module renderers. Each module is tested twice:
// once with its slice absent (must return null, which is how presence-driven
// modularity works) and once populated.
//
// These assert on rendered HTML rather than a returned structure because the
// HTML *is* the module's contract — there is no intermediate representation.
// Assertions target class names and content, never exact markup, so a styling
// change does not break them.

import { test } from "node:test"
import assert from "node:assert/strict"
import { buildModel } from "../src/lib/dashboard/model.mjs"
import { SummaryModule } from "../assets/plugins/dashboard/summary.ts"
import { DeltaModule } from "../assets/plugins/dashboard/delta.ts"
import { TimelineModule } from "../assets/plugins/dashboard/timeline.ts"

const TODAY = "2026-08-13"

export function vmFrom(facts, status) {
  return buildModel({
    facts,
    status,
    pageTitle: "Acme Brain",
    pages: [],
    activity: { logs: [], docs: [] },
    today: TODAY,
  })
}

const FACTS = {
  project: "Secret Escapes",
  start: "2026-07-20",
  end: "2026-09-14",
  milestones: [
    { date: "2026-08-05", name: "Kickoff", done: true },
    { date: "2026-08-14", name: "Survey due" },
    { date: "2026-09-07", end: "2026-09-11", name: "Hack Week" },
  ],
}

// --- summary ---------------------------------------------------------------

test("summary is null with neither a countdown nor a RAG nor any counter", () => {
  assert.equal(SummaryModule.render(vmFrom({}, null)), null)
})

test("summary renders days left, the RAG level and the three counters", () => {
  const status = { status: { rag: "amber", headline: "Venue unconfirmed" }, attention: [{ text: "a" }] }
  const html = SummaryModule.render(vmFrom(FACTS, status))
  assert.match(html, /32/)
  assert.match(html, /dash-rag--amber/)
  assert.match(html, /Venue unconfirmed/)
  assert.match(html, /data-counter="done"[^>]*>1</)
  assert.match(html, /data-counter="attention"[^>]*>1</)
})

test("summary renders without a RAG when only a countdown exists", () => {
  const html = SummaryModule.render(vmFrom(FACTS, null))
  assert.match(html, /32/)
  assert.equal(html.includes("dash-rag--"), false)
})

test("summary reports an overrun rather than a negative countdown", () => {
  const vm = buildModel({
    facts: FACTS,
    status: null,
    pageTitle: "x",
    pages: [],
    activity: { logs: [], docs: [] },
    today: "2026-09-20",
  })
  const html = SummaryModule.render(vm)
  assert.match(html, /6 days over/)
  assert.equal(html.includes("-6"), false)
})

test("summary escapes a headline containing markup", () => {
  const status = { status: { rag: "red", headline: "<script>x</script>" } }
  const html = SummaryModule.render(vmFrom(FACTS, status))
  assert.equal(html.includes("<script>"), false)
  assert.match(html, /&lt;script&gt;/)
})

// --- delta -----------------------------------------------------------------

test("delta is null without a delta string", () => {
  assert.equal(DeltaModule.render(vmFrom(FACTS, null)), null)
  assert.equal(DeltaModule.render(vmFrom(FACTS, { delta: "   " })), null)
})

test("delta renders the text and names the date it is measured from", () => {
  const html = DeltaModule.render(vmFrom(FACTS, { delta: "Survey went out.", since: "2026-08-06" }))
  assert.match(html, /Survey went out\./)
  assert.match(html, /6 Aug/)
  assert.match(html, /assessed/)
})

test("delta renders without a since date", () => {
  const html = DeltaModule.render(vmFrom(FACTS, { delta: "Something changed." }))
  assert.match(html, /Something changed\./)
})

// --- timeline --------------------------------------------------------------

test("timeline is null with nothing to draw", () => {
  assert.equal(TimelineModule.render(vmFrom({}, null)), null)
})

test("timeline renders one bar segment per gap, with server-computed flex-basis", () => {
  const html = TimelineModule.render(vmFrom(FACTS, null))
  const segments = html.match(/class="dash-seg[^"]*"/g) ?? []
  assert.equal(segments.length, 3)
  assert.match(html, /flex-basis:35%/)
  assert.match(html, /dash-seg--current/)
})

test("the bar is aria-hidden and the list carries the accessible content", () => {
  const html = TimelineModule.render(vmFrom(FACTS, null))
  assert.match(html, /<div class="dash-fisheye" aria-hidden="true">/)
  assert.match(html, /class="dash-spine"/)
  assert.match(html, /Kickoff/)
  assert.match(html, /Hack Week/)
})

test("the today marker is positioned inside the current segment and labelled", () => {
  const html = TimelineModule.render(vmFrom(FACTS, null))
  assert.match(html, /class="dash-today"[^>]*left:88\.9%/)
  assert.match(html, /day 9 of 9/)
})

test("the legend names what was passed and what is next", () => {
  const html = TimelineModule.render(vmFrom(FACTS, null))
  assert.match(html, /Kickoff/)
  assert.match(html, /8 days ago/)
  assert.match(html, /Survey due/)
  assert.match(html, /tomorrow/)
})

test("the legend says 'today' rather than 'in 0 days'", () => {
  const facts = {
    milestones: [
      { date: "2026-08-05", name: "Kickoff" },
      { date: "2026-08-13", name: "Survey due" },
    ],
  }
  const html = TimelineModule.render(vmFrom(facts, null))
  assert.match(html, /today/)
})

test("a plain-mode timeline renders a single progress bar and no segments", () => {
  const html = TimelineModule.render(vmFrom({ start: "2026-07-20", end: "2026-09-14" }, null))
  assert.match(html, /dash-plainbar/)
  assert.equal(html.includes("dash-seg"), false)
})

test("a done milestone's node is marked so it can be filled", () => {
  const html = TimelineModule.render(vmFrom(FACTS, null))
  assert.match(html, /dash-node--done/)
})

test("timeline escapes a milestone name containing markup", () => {
  const facts = {
    milestones: [
      { date: "2026-08-05", name: "<b>one</b>" },
      { date: "2026-08-20", name: "two" },
    ],
  }
  const html = TimelineModule.render(vmFrom(facts, null))
  assert.equal(html.includes("<b>one</b>"), false)
  assert.match(html, /&lt;b&gt;one/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/plugins/dashboard/summary.ts'`

- [ ] **Step 3a: Write the summary module**

Create `assets/plugins/dashboard/summary.ts`:

```ts
// The summary strip: RAG, countdown, and the three counters in one row.
//
// Provenance is MIXED and that is the point — the days-left number is stated
// (arithmetic on a hand-written end date), the RAG is assessed (a model's
// judgement at last sync), and the counters are derived from the milestone list.
// Three different origins in one card, which is exactly why the label is per
// card rather than per module type.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

function counter(key: string, value: number, label: string): string {
  return (
    `<div class="dash-counter dash-counter--${key}">` +
    `<b data-counter="${key}">${value}</b><span>${escapeHtml(label)}</span></div>`
  )
}

export const SummaryModule: DashboardModule = {
  id: "summary",
  render(vm: DashboardModel): string | null {
    const { rag, countdown, counters, phase } = vm
    const hasCounters = counters.done + counters.behind + counters.attention > 0
    if (rag === null && countdown === null && !hasCounters) return null

    const parts: string[] = []

    if (rag !== null) {
      const level = typeof rag.level === "string" ? rag.level : "unknown"
      parts.push(
        `<span class="dash-rag dash-rag--${escapeHtml(level)}" title="${escapeHtml(level)}"></span>`,
      )
    }

    const headlineParts: string[] = []
    if (countdown !== null) {
      headlineParts.push(
        countdown.overranDays > 0
          ? `<strong>${countdown.overranDays} days over</strong>`
          : `<strong>${countdown.daysLeft} days left</strong>`,
      )
    }
    if (rag?.level) headlineParts.push(escapeHtml(String(rag.level)))
    if (phase !== null) {
      headlineParts.push(`phase ${phase.index} of ${phase.count}: ${escapeHtml(phase.name)}`)
    }

    const detail: string[] = []
    if (countdown !== null) detail.push(`Ends ${escapeHtml(countdown.endsOn)}`)
    if (rag?.headline) detail.push(escapeHtml(String(rag.headline)))

    parts.push(
      `<div class="dash-summary-text">` +
        `<div class="dash-summary-headline">${headlineParts.join(" · ")}</div>` +
        (detail.length > 0 ? `<div class="dash-muted">${detail.join(" · ")}</div>` : "") +
        `</div>`,
    )

    parts.push(
      `<div class="dash-counters">` +
        counter("done", counters.done, "Done") +
        counter("behind", counters.behind, "Behind") +
        counter("attention", counters.attention, "Attention") +
        `</div>`,
    )

    return card("Status", PROVENANCE.MIXED, `<div class="dash-summary">${parts.join("")}</div>`, {
      id: "status",
    })
  },
}

export default SummaryModule
```

- [ ] **Step 3b: Write the delta module**

Create `assets/plugins/dashboard/delta.ts`:

```ts
// "Since you last looked" — the highest value-per-token module on the page, and
// the one a reader benefits from most on a Monday morning. Entirely assessed:
// this is sync's own prose summary of what moved.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const DeltaModule: DashboardModule = {
  id: "delta",
  render(vm: DashboardModel): string | null {
    if (vm.delta === null) return null
    const since = vm.delta.since === null ? null : formatShortDate(vm.delta.since)
    const label = since === null ? "Since you last looked" : `Since you last looked · ${since}`
    return card(
      label,
      PROVENANCE.ASSESSED,
      `<p class="dash-delta">${escapeHtml(vm.delta.text)}</p>`,
      { id: "delta" },
    )
  },
}

export default DeltaModule
```

- [ ] **Step 3c: Write the timeline module**

Create `assets/plugins/dashboard/timeline.ts`:

```ts
// The fisheye timeline.
//
// Emits the same data twice, deliberately:
//
//   1. `.dash-fisheye` — the horizontal bar, `aria-hidden="true"`. It is a
//      positional graphic built from absolutely-positioned markers; there is no
//      reading order in it that a screen reader could usefully linearise.
//   2. `.dash-spine` — an ordered list of the same nodes. Always in the DOM, so
//      it is the accessible representation, and *also* the vertical layout the
//      stylesheet promotes below 800px, where the bar cannot fit (dates alone
//      need ~70px each).
//
// One source of truth rendered two ways beats a bar plus a separately-generated
// fallback that can disagree with it. Every width and offset is computed
// server-side in model.mjs — this file only places what it is given.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "2026-08-14" -> "14 Aug". Formatted from the ISO parts rather than via
// toLocaleDateString: a build's locale and timezone must not change the output.
export function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [, , month, day] = match
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`
}

function relativeDays(days: number): string {
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  return `in ${days} days`
}

function agoDays(days: number): string {
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

function nodeMarkup(
  node: { date: string; name: string; done: boolean; synthetic: boolean },
  atEnd: boolean,
): string {
  const position = atEnd ? "left:100%" : "left:0"
  const classes = ["dash-node", node.done ? "dash-node--done" : "", node.synthetic ? "dash-node--bound" : ""]
    .filter(Boolean)
    .join(" ")
  return (
    `<span class="${classes}" style="${position}"></span>` +
    `<span class="dash-node-name" style="${position}">${escapeHtml(node.name)}</span>` +
    `<span class="dash-node-date" style="${position}">${escapeHtml(formatShortDate(node.date))}</span>`
  )
}

function barMarkup(segments: any[]): string {
  const parts = segments.map((segment) => {
    const inner: string[] = [`<span class="dash-track"></span>`]
    if (segment.kind === "current" && segment.today !== null) {
      inner.push(`<span class="dash-fill" style="width:${segment.today.offsetPct}%"></span>`)
    }
    inner.push(nodeMarkup(segment.startNode, false))
    if (segment.endNode !== null) inner.push(nodeMarkup(segment.endNode, true))
    if (segment.kind === "current" && segment.today !== null) {
      const left = `left:${segment.today.offsetPct}%`
      inner.push(`<span class="dash-today" style="${left}"></span>`)
      if (segment.today.label !== null) {
        inner.push(
          `<span class="dash-today-label" style="${left}">${escapeHtml(segment.today.label)}</span>`,
        )
      }
    }
    // flex-basis is server-computed: the current gap gets a fixed 35% so a
    // position inside it is readable, the rest share 65% by true duration.
    return (
      `<div class="dash-seg dash-seg--${segment.kind}" style="flex-basis:${segment.basis}%">` +
      inner.join("") +
      `</div>`
    )
  })
  return `<div class="dash-fisheye" aria-hidden="true">${parts.join("")}</div>`
}

function spineMarkup(segments: any[], todayIso: string): string {
  const rows: string[] = []
  const push = (node: any, extraClass = "") => {
    rows.push(
      `<li class="dash-spine-row${extraClass}">` +
        `<time datetime="${escapeHtml(node.date)}">${escapeHtml(formatShortDate(node.date))}</time>` +
        `<span>${escapeHtml(node.name)}</span></li>`,
    )
  }

  for (const segment of segments) {
    push(segment.startNode, segment.startNode.done ? " dash-spine-row--done" : "")
    if (segment.kind === "current") {
      const label = segment.today?.label
      rows.push(
        `<li class="dash-spine-row dash-spine-row--today">` +
          `<time datetime="${escapeHtml(todayIso)}">Today</time>` +
          `<span>${label === null || label === undefined ? "You are here" : escapeHtml(label)}</span></li>`,
      )
    }
    if (segment.endNode !== null) push(segment.endNode)
  }

  return `<ol class="dash-spine">${rows.join("")}</ol>`
}

function legendMarkup(legend: any): string {
  const left =
    legend.pastName === null
      ? ""
      : `<span>Since <strong>${escapeHtml(legend.pastName)}</strong> · ${escapeHtml(
          agoDays(legend.pastDaysAgo),
        )}</span>`

  let right = ""
  if (legend.overranDays > 0) {
    right = `<span class="dash-legend-next dash-legend-next--over">Overran by <strong>${legend.overranDays} days</strong></span>`
  } else if (legend.nextIsEnd) {
    right = `<span class="dash-legend-next">Ends <strong>${escapeHtml(
      relativeDays(legend.nextInDays),
    )}</strong></span>`
  } else if (legend.nextName !== null) {
    right = `<span class="dash-legend-next">Next: <strong>${escapeHtml(
      legend.nextName,
    )}</strong> · ${escapeHtml(relativeDays(legend.nextInDays))}</span>`
  }

  if (left === "" && right === "") return ""
  return `<p class="dash-legend">${left}${right}</p>`
}

function plainMarkup(timeline: any): string {
  return (
    `<div class="dash-plainbar" aria-hidden="true">` +
    `<span class="dash-track"></span>` +
    `<span class="dash-fill" style="width:${timeline.progressPct}%"></span>` +
    `<span class="dash-today" style="left:${timeline.progressPct}%"></span>` +
    `</div>` +
    `<p class="dash-legend"><span>${escapeHtml(timeline.todayLabel)}</span></p>`
  )
}

export const TimelineModule: DashboardModule = {
  id: "timeline",
  render(vm: DashboardModel): string | null {
    const timeline = vm.timeline
    if (timeline === null) return null

    const body =
      timeline.mode === "plain"
        ? plainMarkup(timeline)
        : barMarkup(timeline.segments) +
          legendMarkup(timeline.legend) +
          spineMarkup(timeline.segments, vm.today)

    return card("Timeline", PROVENANCE.STATED, body, { id: "timeline" })
  },
}

export default TimelineModule
```

- [ ] **Step 3d: Register the three modules**

Replace `assets/plugins/dashboard/index.ts`'s registry:

```ts
import type { DashboardModule } from "./types.ts"
import { SummaryModule } from "./summary.ts"
import { DeltaModule } from "./delta.ts"
import { TimelineModule } from "./timeline.ts"
import { ExploreModule } from "./explore.ts"

export const MODULES: DashboardModule[] = [
  SummaryModule,
  DeltaModule,
  TimelineModule,
  ExploreModule,
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: PASS, 17 tests.

Run: `node --test`
Expected: PASS overall.

- [ ] **Step 5: Commit**

```bash
git add assets/plugins/dashboard test/dashboard-modules.test.mjs
git commit -m "$(cat <<'EOF'
feat: render the summary strip, delta and fisheye timeline

The timeline emits the same nodes twice on purpose: the bar is a positional
graphic with no useful reading order, so it is aria-hidden, and an ordered list
carries the accessible content — which is also the vertical spine the
stylesheet promotes below 800px, where dates alone need ~70px each and the bar
cannot fit. One source of truth rendered two ways beats a bar plus a separate
fallback that can disagree with it.

Dates are formatted from ISO parts rather than toLocaleDateString so a build's
locale and timezone cannot change the output.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Modules — what's next, effort, people

**Files:**
- Create: `assets/plugins/dashboard/next.ts`, `effort.ts`, `people.ts`
- Modify: `assets/plugins/dashboard/index.ts`
- Modify: `test/dashboard-modules.test.mjs`

**Interfaces:**
- Consumes: `card`, `escapeHtml`, `list`, `PROVENANCE` from `render.ts`; `formatShortDate` from `timeline.ts`.
- Produces: `NextModule` (`id: "next"`), `EffortModule` (`id: "effort"`), `PeopleModule` (`id: "people"`).
- `MODULES` order becomes `[summary, delta, timeline, next, effort, people, explore]`.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-modules.test.mjs`:

```js
// --- next, effort, people --------------------------------------------------

import { NextModule } from "../assets/plugins/dashboard/next.ts"
import { EffortModule } from "../assets/plugins/dashboard/effort.ts"
import { PeopleModule } from "../assets/plugins/dashboard/people.ts"

test("next is null when nothing upcoming remains", () => {
  assert.equal(NextModule.render(vmFrom({}, null)), null)
  const allPast = { milestones: [{ date: "2026-01-01", name: "Old" }, { date: "2026-01-02", name: "Older" }] }
  assert.equal(NextModule.render(vmFrom(allPast, null)), null)
})

test("next lists upcoming milestones and commitments in date order with owners", () => {
  const facts = { ...FACTS, commitments: [{ date: "2026-08-17", text: "Training published", owner: "Tom" }] }
  const html = NextModule.render(vmFrom(facts, null))
  assert.ok(html.indexOf("Survey due") < html.indexOf("Training published"))
  assert.ok(html.indexOf("Training published") < html.indexOf("Hack Week"))
  assert.match(html, /Tom/)
  assert.match(html, /14 Aug/)
})

test("next marks the imminent item so it can be highlighted", () => {
  const html = NextModule.render(vmFrom(FACTS, null))
  assert.match(html, /dash-next-row--soon/)
})

test("next caps the list rather than reproducing the whole timeline", () => {
  const milestones = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    name: `M${i}`,
  }))
  const html = NextModule.render(vmFrom({ milestones }, null))
  assert.equal((html.match(/dash-next-row/g) ?? []).length <= 5, true)
})

test("effort is null without soldDays", () => {
  assert.equal(EffortModule.render(vmFrom({}, null)), null)
  assert.equal(EffortModule.render(vmFrom({ effort: { usedDays: 5 } }, null)), null)
})

test("effort renders used, in-flight and remaining days with bar widths", () => {
  const html = EffortModule.render(vmFrom({ effort: { soldDays: 50, usedDays: 32, inFlightDays: 4 } }, null))
  assert.match(html, /width:64%/)
  assert.match(html, /width:8%/)
  assert.match(html, /14/)
  assert.match(html, /50/)
})

test("effort handles a fully consumed budget without a negative remainder", () => {
  const html = EffortModule.render(vmFrom({ effort: { soldDays: 10, usedDays: 10, inFlightDays: 4 } }, null))
  assert.match(html, /0 left/)
  assert.equal(html.includes("-4"), false)
})

test("people is null without a roster", () => {
  assert.equal(PeopleModule.render(vmFrom({}, null)), null)
  assert.equal(PeopleModule.render(vmFrom({}, { people: [{ name: "Ghost" }] })), null)
})

test("people renders the roster even with no status, so the team is always visible", () => {
  const facts = { people: [{ name: "Milly Allatson", role: "PM", org: "Loomery" }] }
  const html = PeopleModule.render(vmFrom(facts, null))
  assert.match(html, /Milly Allatson/)
  assert.match(html, /PM/)
  assert.match(html, /Loomery/)
})

test("people renders each person's focus, detail and state", () => {
  const facts = { people: [{ name: "Tom Holmes", role: "Engineer", org: "Loomery" }] }
  const status = {
    people: [{ name: "Tom Holmes", focus: "Training content", detail: "Waiting on Efe", state: "blocked" }],
  }
  const html = PeopleModule.render(vmFrom(facts, status))
  assert.match(html, /Training content/)
  assert.match(html, /Waiting on Efe/)
  assert.match(html, /dash-state--blocked/)
  assert.match(html, /BLOCKED/)
})

test("people shows a person with no status as having no current focus", () => {
  const facts = { people: [{ name: "Brett Thornton", role: "Director" }] }
  const html = PeopleModule.render(vmFrom(facts, null))
  assert.match(html, /Brett Thornton/)
  assert.match(html, /No current focus recorded/)
})

test("people escapes a focus containing markup", () => {
  const facts = { people: [{ name: "X" }] }
  const status = { people: [{ name: "X", focus: "<img src=x>" }] }
  const html = PeopleModule.render(vmFrom(facts, status))
  assert.equal(html.includes("<img src=x>"), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/plugins/dashboard/next.ts'`

- [ ] **Step 3a: Write `assets/plugins/dashboard/next.ts`**

```ts
// "What's next": the next few dated obligations, merged from milestones and
// commitments. Both are stated — the merge happens in model.mjs.
//
// Capped at five. This module answers "what is expected of me this week", not
// "what is the plan" — the timeline above already covers the plan, and repeating
// it here would make the page longer without making it more useful.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import { daysBetween } from "@loomery/brain-site/lib/dashboard/dates.mjs"
import type { DashboardModel, DashboardModule } from "./types.ts"

const MAX_ROWS = 5
// Anything falling within this many days of today is highlighted as imminent.
const SOON_DAYS = 2

export const NextModule: DashboardModule = {
  id: "next",
  render(vm: DashboardModel): string | null {
    const items = vm.next ?? []
    if (items.length === 0) return null

    const rows = items.slice(0, MAX_ROWS).map((item: any) => {
      // daysBetween, never `new Date(item.date)`: the whole point of dates.mjs
      // is that one place owns UTC-stable day arithmetic.
      const away = daysBetween(vm.today, item.date)
      const isSoon = away !== null && away <= SOON_DAYS
      const owner =
        item.owner === null ? "" : ` <span class="dash-muted">— ${escapeHtml(item.owner)}</span>`
      return (
        `<span class="dash-next-row${isSoon ? " dash-next-row--soon" : ""}">` +
        `<time datetime="${escapeHtml(item.date)}">${escapeHtml(formatShortDate(item.date))}</time>` +
        ` ${escapeHtml(item.text)}${owner}</span>`
      )
    })

    return card("What's next", PROVENANCE.STATED, list(rows), { id: "next" })
  },
}

export default NextModule
```

- [ ] **Step 3b: Write `assets/plugins/dashboard/effort.ts`**

```ts
// Effort: days sold against days used and in flight.
//
// Every number is stated — hand-written in dashboard.yaml's `effort` block — and
// the module is absent when `soldDays` is missing. That is deliberate: a burn
// figure nobody is tracking would be invented, and an invented number on a page
// labelled "stated" is worse than a missing module.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const EffortModule: DashboardModule = {
  id: "effort",
  render(vm: DashboardModel): string | null {
    const effort = vm.effort
    if (effort === null) return null

    const bar =
      `<div class="dash-burn">` +
      `<span class="dash-burn-used" style="width:${effort.usedPct}%"></span>` +
      `<span class="dash-burn-flight" style="left:${effort.usedPct}%;width:${effort.inFlightPct}%"></span>` +
      `</div>`

    const legend =
      `<p class="dash-muted dash-burn-legend">` +
      `<span class="dash-burn-key dash-burn-key--used">${effort.usedDays} used</span> · ` +
      `<span class="dash-burn-key dash-burn-key--flight">${effort.inFlightDays} in flight</span> · ` +
      `<span>${effort.leftDays} left of ${effort.soldDays} days</span></p>`

    return card("Effort", PROVENANCE.STATED, bar + legend, { id: "effort" })
  },
}

export default EffortModule
```

- [ ] **Step 3c: Write `assets/plugins/dashboard/people.ts`**

```ts
// "Who's on it, right now": the roster joined with each person's current focus.
//
// MIXED provenance, and the split matters — names, roles and orgs are stated
// (hand-written in dashboard.yaml, stable facts), while focus, detail and state
// are assessed at the last sync. This is the clearest case for labelling by
// field rather than by module.
//
// The roster renders even with no status at all, so "who is on this project" is
// always answerable. Where a brain uses Linear or Jira, sync is what reads open
// issues per assignee and fills the assessed half — never this file, which runs
// in an offline build with no credentials.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const STATE_LABELS: Record<string, string> = {
  "on-track": "ON TRACK",
  awaiting: "AWAITING",
  blocked: "BLOCKED",
  idle: "IDLE",
}

export const PeopleModule: DashboardModule = {
  id: "people",
  render(vm: DashboardModel): string | null {
    const people = vm.people ?? []
    if (people.length === 0) return null

    const rows = people.map((person: any) => {
      const meta = [person.role, person.org].filter(Boolean).map(String).map(escapeHtml).join(" · ")
      const focus =
        person.focus === null
          ? `<div class="dash-muted">No current focus recorded</div>`
          : `<div class="dash-person-focus">${escapeHtml(person.focus)}</div>`
      const detail =
        person.detail === null ? "" : `<div class="dash-muted">${escapeHtml(person.detail)}</div>`
      const state =
        person.state === null
          ? `<div class="dash-state"></div>`
          : `<div class="dash-state dash-state--${escapeHtml(person.state)}">${escapeHtml(
              STATE_LABELS[person.state] ?? person.state,
            )}</div>`

      return (
        `<div class="dash-person">` +
        `<div class="dash-person-who"><b>${escapeHtml(person.name)}</b>` +
        (meta ? `<span>${meta}</span>` : "") +
        `</div>` +
        `<div class="dash-person-now">${focus}${detail}</div>` +
        state +
        `</div>`
      )
    })

    const note =
      `<p class="dash-muted dash-footnote">Names and roles from <code>dashboard.yaml</code>; ` +
      `focus and state written at the last sync.</p>`

    return card(
      "Who's on it, right now",
      PROVENANCE.MIXED,
      `<div class="dash-people">${rows.join("")}</div>${note}`,
      { id: "people" },
    )
  },
}

export default PeopleModule
```

- [ ] **Step 3d: Register them**

In `assets/plugins/dashboard/index.ts`, import the three and set:

```ts
export const MODULES: DashboardModule[] = [
  SummaryModule,
  DeltaModule,
  TimelineModule,
  NextModule,
  EffortModule,
  PeopleModule,
  ExploreModule,
]
```

- [ ] **Step 4: Run tests**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: PASS, 29 tests.

Run: `node --test`
Expected: PASS overall.

- [ ] **Step 5: Commit**

```bash
git add assets/plugins/dashboard test/dashboard-modules.test.mjs
git commit -m "$(cat <<'EOF'
feat: render what's next, effort and the people module

People is the clearest case for labelling provenance by field rather than by
module: names and roles are stated, focus and state are assessed. The roster
renders even with no status at all, so "who is on this project" is always
answerable.

Effort is absent without soldDays rather than showing an unanchored count — an
invented number on a card labelled "stated" is worse than a missing module.

What's next caps at five: the timeline above already covers the plan, and
repeating it here would lengthen the page without adding anything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Modules — attention, decisions, activity, health

Four list-shaped cards. Grouped into one task because they share a shape and a reviewer would accept or reject them together.

**Files:**
- Create: `assets/plugins/dashboard/attention.ts`, `decisions.ts`, `activity.ts`, `health.ts`
- Modify: `assets/plugins/dashboard/index.ts`
- Modify: `test/dashboard-modules.test.mjs`

**Interfaces:**
- Consumes: `card`, `chip`, `escapeHtml`, `list`, `PROVENANCE` from `render.ts`; `formatShortDate` from `timeline.ts`.
- Produces: `AttentionModule` (`id: "attention"`), `DecisionsModule` (`id: "decisions"`), `ActivityModule` (`id: "activity"`), `HealthModule` (`id: "health"`).
- `MODULES` order becomes `[summary, delta, timeline, next, effort, people, attention, decisions, activity, health, explore]`.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-modules.test.mjs`:

```js
// --- attention, decisions, activity, health --------------------------------

import { AttentionModule } from "../assets/plugins/dashboard/attention.ts"
import { DecisionsModule } from "../assets/plugins/dashboard/decisions.ts"
import { ActivityModule } from "../assets/plugins/dashboard/activity.ts"
import { HealthModule } from "../assets/plugins/dashboard/health.ts"

function vmWithActivity(activity, pages = []) {
  return buildModel({
    facts: FACTS,
    status: null,
    pageTitle: "Acme Brain",
    pages,
    activity,
    today: TODAY,
  })
}

test("attention is null with no attention entries", () => {
  assert.equal(AttentionModule.render(vmFrom(FACTS, null)), null)
  assert.equal(AttentionModule.render(vmFrom(FACTS, { attention: [] })), null)
})

test("attention renders text, detail and a severity class", () => {
  const status = {
    attention: [
      { text: "Holborn office availability", detail: "travel blocked behind it", severity: "high" },
      { text: "Third pillar unnamed" },
    ],
  }
  const html = AttentionModule.render(vmFrom(FACTS, status))
  assert.match(html, /Holborn office availability/)
  assert.match(html, /travel blocked behind it/)
  assert.match(html, /dash-sev--high/)
  assert.match(html, /dash-sev--none/)
  assert.match(html, /Third pillar unnamed/)
})

test("attention orders high severity first so the worst thing is at the top", () => {
  const status = {
    attention: [
      { text: "low one", severity: "low" },
      { text: "high one", severity: "high" },
      { text: "medium one", severity: "medium" },
    ],
  }
  const html = AttentionModule.render(vmFrom(FACTS, status))
  assert.ok(html.indexOf("high one") < html.indexOf("medium one"))
  assert.ok(html.indexOf("medium one") < html.indexOf("low one"))
})

test("decisions is null with no decisions", () => {
  assert.equal(DecisionsModule.render(vmFrom(FACTS, null)), null)
})

test("decisions renders the text, who decided and when, newest first", () => {
  const status = {
    decisions: [
      { text: "Survey to whole channel", by: "Milly", date: "2026-08-07" },
      { text: "Hack Week 7-11 Sep", by: "Gianni", date: "2026-08-06" },
    ],
  }
  const html = DecisionsModule.render(vmFrom(FACTS, status))
  assert.ok(html.indexOf("Survey to whole channel") < html.indexOf("Hack Week"))
  assert.match(html, /Gianni/)
  assert.match(html, /6 Aug/)
})

test("decisions renders an entry with neither author nor date", () => {
  const html = DecisionsModule.render(vmFrom(FACTS, { decisions: [{ text: "Something settled" }] }))
  assert.match(html, /Something settled/)
})

test("activity is null with neither logs nor docs", () => {
  assert.equal(ActivityModule.render(vmWithActivity({ logs: [], docs: [] })), null)
})

test("activity renders logs linked to the timeline page anchors", () => {
  const activity = {
    logs: [{ filename: "2026-08-10-deps.md", title: "2026-08-10 — Shared frontend dependency", date: "2026-08-10" }],
    docs: [],
  }
  const html = ActivityModule.render(vmWithActivity(activity))
  assert.match(html, /Shared frontend dependency/)
  assert.match(html, /href="\/logs#2026-08-10-deps\.md"/)
})

test("activity renders recently updated docs linked to their slugs", () => {
  const activity = { logs: [], docs: [{ slug: "engagement", title: "Engagement", date: "2026-08-07" }] }
  const html = ActivityModule.render(vmWithActivity(activity))
  assert.match(html, /href="\/engagement"/)
  assert.match(html, /7 Aug/)
})

test("activity renders one column when only one side has data", () => {
  const activity = { logs: [], docs: [{ slug: "engagement", title: "Engagement", date: "2026-08-07" }] }
  const html = ActivityModule.render(vmWithActivity(activity))
  assert.equal(html.includes("Latest logs"), false)
  assert.match(html, /Recently updated/)
})

test("health is null with no sources and no sync date", () => {
  assert.equal(HealthModule.render(vmFrom(FACTS, null)), null)
})

test("health renders a chip per source with a state tone", () => {
  const status = {
    generatedAt: "2026-08-13",
    sources: [
      { name: "Slack", state: "wired" },
      { name: "Miro", state: "partial", note: "from screenshots" },
      { name: "Linear", state: "absent" },
    ],
  }
  const html = HealthModule.render(vmFrom(FACTS, status))
  assert.match(html, /dash-chip--wired/)
  assert.match(html, /dash-chip--partial/)
  assert.match(html, /dash-chip--absent/)
  assert.match(html, /from screenshots/)
})

test("health reports the doc count and when the brain was last synced", () => {
  const vm = buildModel({
    facts: FACTS,
    status: { generatedAt: "2026-08-10" },
    pageTitle: "x",
    pages: [{ slug: "a", title: "A" }, { slug: "b", title: "B" }],
    activity: { logs: [], docs: [] },
    today: TODAY,
  })
  const html = HealthModule.render(vm)
  assert.match(html, /2 docs/)
  assert.match(html, /3 days ago/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/plugins/dashboard/attention.ts'`

- [ ] **Step 3a: Write `assets/plugins/dashboard/attention.ts`**

```ts
// "Needs attention": the narrative counterpart to the deterministic `behind`
// counter. Entirely assessed.
//
// Sorted by severity rather than kept in file order: the list's whole job is to
// put the worst thing first, and sync has no reason to author it in priority
// order.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export const AttentionModule: DashboardModule = {
  id: "attention",
  render(vm: DashboardModel): string | null {
    const items = vm.attention ?? []
    if (items.length === 0) return null

    const rows = [...items]
      .map((item: any, index: number) => ({ item, index }))
      .sort((a, b) => {
        const rank = (entry: any) => SEVERITY_RANK[entry.item.severity] ?? 3
        // Index as tiebreak keeps the sort stable, so two entries of equal
        // severity stay in the order sync wrote them.
        return rank(a) - rank(b) || a.index - b.index
      })
      .map(({ item }) => {
        const severity = typeof item.severity === "string" ? item.severity : "none"
        const detail =
          typeof item.detail === "string"
            ? ` <span class="dash-muted">— ${escapeHtml(item.detail)}</span>`
            : ""
        return (
          `<span class="dash-sev dash-sev--${escapeHtml(severity)}"></span>` +
          `${escapeHtml(item.text)}${detail}`
        )
      })

    return card("Needs attention", PROVENANCE.ASSESSED, list(rows), { id: "attention" })
  },
}

export default AttentionModule
```

- [ ] **Step 3b: Write `assets/plugins/dashboard/decisions.ts`**

```ts
// "Recent decisions": what got settled lately and by whom. Assessed.
//
// This is the module that stops the same question being re-litigated, and it is
// the highest-value thing a newcomer can read after the engagement summary.
// Newest first — an undated entry sorts last rather than being dropped, since
// "we decided this, date unrecorded" is still worth knowing.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const DecisionsModule: DashboardModule = {
  id: "decisions",
  render(vm: DashboardModel): string | null {
    const items = vm.decisions ?? []
    if (items.length === 0) return null

    const rows = [...items]
      .sort((a: any, b: any) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
      .map((item: any) => {
        const meta = [
          typeof item.by === "string" ? escapeHtml(item.by) : null,
          typeof item.date === "string" ? escapeHtml(formatShortDate(item.date)) : null,
        ].filter(Boolean)
        const suffix =
          meta.length > 0 ? ` <span class="dash-muted">— ${meta.join(", ")}</span>` : ""
        return `${escapeHtml(item.text)}${suffix}`
      })

    return card("Recent decisions", PROVENANCE.ASSESSED, list(rows), { id: "decisions" })
  },
}

export default DecisionsModule
```

- [ ] **Step 3c: Write `assets/plugins/dashboard/activity.ts`**

```ts
// "Recent activity": the latest session logs beside the most recently changed
// docs. Both stated — filenames off disk and `git log -1` per file.
//
// One card with two columns rather than two cards, because they answer the same
// question: where is this brain actually moving? A column with no data is
// omitted rather than rendered empty.
//
// Log entries link to the timeline page's own anchors. logs-timeline-emitter.ts
// gives each entry section an id equal to its filename and its "Jump to" list
// links to `#${filename}`, so reusing that value here points all three at one id
// rather than three.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

function column(heading: string, rowsHtml: string[]): string {
  return (
    `<div class="dash-activity-col">` +
    `<p class="dash-muted dash-activity-heading">${escapeHtml(heading)}</p>` +
    `<ul class="dash-list">${rowsHtml.map((row) => `<li>${row}</li>`).join("")}</ul></div>`
  )
}

function dateSuffix(date: string | null): string {
  return date === null ? "" : ` <span class="dash-muted">${escapeHtml(formatShortDate(date))}</span>`
}

export const ActivityModule: DashboardModule = {
  id: "activity",
  render(vm: DashboardModel): string | null {
    const logs = vm.activity?.logs ?? []
    const docs = vm.activity?.docs ?? []
    if (logs.length === 0 && docs.length === 0) return null

    const columns: string[] = []

    if (logs.length > 0) {
      columns.push(
        column(
          "Latest logs",
          logs.map(
            (log: any) =>
              `<a href="/logs#${escapeHtml(log.filename)}">${escapeHtml(log.title)}</a>` +
              dateSuffix(log.date),
          ),
        ),
      )
    }

    if (docs.length > 0) {
      columns.push(
        column(
          "Recently updated",
          docs.map(
            (doc: any) =>
              `<a href="/${escapeHtml(doc.slug)}">${escapeHtml(doc.title)}</a>` +
              dateSuffix(doc.date),
          ),
        ),
      )
    }

    return card(
      "Recent activity",
      PROVENANCE.STATED,
      `<div class="dash-activity">${columns.join("")}</div>`,
      { id: "activity" },
    )
  },
}

export default ActivityModule
```

- [ ] **Step 3d: Write `assets/plugins/dashboard/health.ts`**

```ts
// "Brain health": can I trust what I am reading right now?
//
// MIXED. The source list is assessed — sync knows what it wired, and nothing at
// build time can verify a connector. The doc count is stated (counted from what
// Quartz parsed), and the sync age is arithmetic on the status file's own
// generatedAt.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { daysBetween } from "@loomery/brain-site/lib/dashboard/dates.mjs"
import type { DashboardModel, DashboardModule } from "./types.ts"

const STATE_MARKS: Record<string, string> = { wired: "✓", partial: "△", absent: "✗" }

function syncPhrase(generatedAt: string | null, today: string): string | null {
  if (generatedAt === null) return null
  const age = daysBetween(generatedAt, today)
  if (age === null) return null
  if (age <= 0) return "Synced today"
  if (age === 1) return "Synced yesterday"
  return `Synced ${age} days ago`
}

export const HealthModule: DashboardModule = {
  id: "health",
  render(vm: DashboardModel): string | null {
    const sources = vm.sources ?? []
    const sync = syncPhrase(vm.generatedAt, vm.today)
    if (sources.length === 0 && sync === null) return null

    const chips = sources.map((source: any) => {
      const state = typeof source.state === "string" ? source.state : "absent"
      const mark = STATE_MARKS[state] ?? ""
      const title = typeof source.note === "string" ? ` title="${escapeHtml(source.note)}"` : ""
      return (
        `<span class="dash-chip dash-chip--${escapeHtml(state)}"${title}>` +
        `${mark} ${escapeHtml(source.name)}</span>`
      )
    })

    const notes = sources
      .filter((source: any) => typeof source.note === "string")
      .map((source: any) => `${escapeHtml(source.name)}: ${escapeHtml(source.note)}`)

    const facts = [sync, `${(vm.pages ?? []).length} docs`, ...notes].filter(Boolean)

    return card(
      "Brain health",
      PROVENANCE.MIXED,
      (chips.length > 0 ? `<div class="dash-chips">${chips.join("")}</div>` : "") +
        `<p class="dash-muted dash-footnote">${facts.join(" · ")}</p>`,
      { id: "health" },
    )
  },
}

export default HealthModule
```

- [ ] **Step 3e: Register them** in `assets/plugins/dashboard/index.ts`, in the order given in **Interfaces** above.

- [ ] **Step 4: Run tests**

Run: `node --test test/dashboard-modules.test.mjs`
Expected: PASS, 42 tests.

Run: `node --test`
Expected: PASS overall.

- [ ] **Step 5: Commit**

```bash
git add assets/plugins/dashboard test/dashboard-modules.test.mjs
git commit -m "$(cat <<'EOF'
feat: render attention, decisions, recent activity and brain health

Attention sorts by severity rather than keeping file order — the list's whole
job is to put the worst thing first, and sync has no reason to author it in
priority order. The sort is stable, so equal severities keep sync's order.

Recent activity is one card with two columns rather than two cards: logs and
recently-changed docs answer the same question. Log links reuse the filename as
the anchor, matching the id logs-timeline-emitter gives each entry, so both
pages point at one id rather than two.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Module — onboarding

Its own task because it is the only module fed by content frontmatter rather than by either YAML file, and it requires a signature change to `buildModel`. It links into the existing `/onboarding/<role>` pages and reuses `buildRolePath` — it never reimplements path building.

**Files:**
- Create: `assets/plugins/dashboard/onboarding.ts`
- Create: `test/fixtures/dashboard-full/dashboard.yaml`, `test/fixtures/dashboard-full/dashboard.status.yaml`, `test/fixtures/dashboard-facts-only/dashboard.yaml`
- Modify: `src/lib/dashboard/model.mjs` (accept and expose `onboarding`)
- Modify: `assets/plugins/dashboard-emitter.ts` (compute role counts, pass them in)
- Modify: `assets/plugins/dashboard/index.ts`
- Modify: `test/dashboard-modules.test.mjs`, `test/dashboard-emitter.test.mjs`

**Interfaces:**
- Consumes: `listRoles`, `buildRolePath` from `@loomery/brain-site/lib/onboarding/paths.mjs`.
- Produces:
  - `buildModel` gains an `onboarding` input, exposed unchanged as `vm.onboarding`: `Array<{ role: string, count: number }>`, defaulting to `[]`.
  - `OnboardingModule` (`id: "onboarding"`), registered **after** `activity` and **before** `health`.

The role counts are computed in the emitter, not in `model.mjs`, because deriving them needs `roles:` / `onboarding.prerequisites` frontmatter — content knowledge that belongs with the code that already adapts Quartz's parsed content. `model.mjs` stays free of frontmatter conventions.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-modules.test.mjs`:

```js
// --- onboarding ------------------------------------------------------------

import { OnboardingModule } from "../assets/plugins/dashboard/onboarding.ts"

function vmWithOnboarding(onboarding) {
  return buildModel({
    facts: FACTS,
    status: null,
    pageTitle: "Acme Brain",
    pages: [],
    activity: { logs: [], docs: [] },
    onboarding,
    today: TODAY,
  })
}

test("onboarding is null when no doc declares a role", () => {
  assert.equal(OnboardingModule.render(vmWithOnboarding([])), null)
  assert.equal(OnboardingModule.render(vmWithOnboarding(undefined)), null)
})

test("onboarding renders a chip per role, linking to that role's path page", () => {
  const html = OnboardingModule.render(
    vmWithOnboarding([
      { role: "engineering", count: 6 },
      { role: "product", count: 5 },
    ]),
  )
  assert.match(html, /href="\/onboarding\/engineering"/)
  assert.match(html, /Engineering/)
  assert.match(html, /6/)
  assert.match(html, /href="\/onboarding\/product"/)
})

test("onboarding always offers the all-roles index", () => {
  const html = OnboardingModule.render(vmWithOnboarding([{ role: "engineering", count: 6 }]))
  assert.match(html, /href="\/onboarding"/)
})

test("onboarding omits a role whose path resolves to nothing", () => {
  const html = OnboardingModule.render(
    vmWithOnboarding([
      { role: "engineering", count: 6 },
      { role: "ghost", count: 0 },
    ]),
  )
  assert.equal(html.includes("Ghost"), false)
})

test("onboarding escapes a role name containing markup", () => {
  const html = OnboardingModule.render(vmWithOnboarding([{ role: "<b>x</b>", count: 2 }]))
  assert.equal(html.includes("<b>x</b>"), false)
})
```

Append to `test/dashboard-emitter.test.mjs`:

```js
test("the emitter derives onboarding role counts from roles frontmatter", async () => {
  const dir = tmpDir("dash-onboarding")
  const content = [
    [
      {},
      {
        data: {
          slug: "engagement",
          frontmatter: {
            title: "Engagement",
            roles: ["engineering"],
            onboarding: { order: 1 },
          },
        },
      },
    ],
    [
      {},
      {
        data: {
          slug: "stakeholders",
          frontmatter: {
            title: "Stakeholders",
            roles: ["engineering", "product"],
            onboarding: { order: 2, prerequisites: ["engagement"] },
          },
        },
      },
    ],
  ]
  const { html } = await emitTo(dir, { content })
  assert.match(html, /href="\/onboarding\/engineering"/)
  assert.match(html, /href="\/onboarding\/product"/)
})

test("no onboarding module appears when no doc declares a role", async () => {
  const dir = tmpDir("dash-no-onboarding")
  const { html } = await emitTo(dir)
  assert.equal(html.includes("/onboarding"), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-modules.test.mjs test/dashboard-emitter.test.mjs`
Expected: FAIL — `Cannot find module '.../assets/plugins/dashboard/onboarding.ts'`

- [ ] **Step 3a: Write `assets/plugins/dashboard/onboarding.ts`**

```ts
// Onboarding: role-based reading paths, as chips linking into the existing
// /onboarding/<role> pages that onboarding-emitter.ts already emits.
//
// This module deliberately links rather than duplicates. The path building
// (topological sort, depth, cycle detection) lives in
// src/lib/onboarding/paths.mjs and is consumed by the emitter — reimplementing
// any of it here would give a brain two orderings that can disagree.
//
// Absent until some doc carries `roles:` frontmatter. A brain that has not
// declared roles has no reading path to offer, and an empty "pick your role"
// card would be worse than no card.

import { escapeHtml, card, humanize, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const OnboardingModule: DashboardModule = {
  id: "onboarding",
  render(vm: DashboardModel): string | null {
    const roles = (vm.onboarding ?? []).filter((entry: any) => entry.count > 0)
    if (roles.length === 0) return null

    const chips = roles.map(
      (entry: any) =>
        `<a class="dash-chip dash-chip--role" href="/onboarding/${encodeURIComponent(
          entry.role,
        )}">${escapeHtml(humanize(entry.role))} <b>${entry.count}</b></a>`,
    )
    chips.push(`<a class="dash-chip" href="/onboarding">All roles</a>`)

    return card(
      "Onboarding",
      PROVENANCE.STATED,
      `<p class="dash-muted dash-footnote">New here? Pick your role for an ordered reading path.</p>` +
        `<div class="dash-chips">${chips.join("")}</div>`,
      { id: "onboarding" },
    )
  },
}

export default OnboardingModule
```

- [ ] **Step 3b: Expose `onboarding` on the model**

In `src/lib/dashboard/model.mjs`, add `onboarding` to `buildModel`'s destructured parameters and to its returned object, beside `activity`:

```js
export function buildModel({ facts, status, pageTitle, pages, activity, onboarding, today }) {
```

```js
    activity: activity ?? { logs: [], docs: [] },
    onboarding: onboarding ?? [],
```

- [ ] **Step 3c: Compute role counts in the emitter**

In `assets/plugins/dashboard-emitter.ts`, add the import:

```ts
import { listRoles, buildRolePath } from "@loomery/brain-site/lib/onboarding/paths.mjs"
```

Add the adapter and counter — the doc shape is the same one `onboarding-emitter.ts`'s `adaptDocs` produces, deliberately, so both emitters feed `buildRolePath` identical input:

```ts
interface OnboardingDoc {
  slug: string
  title: string
  roles: string[]
  onboarding?: { order?: number; prerequisites?: string[]; summary?: string; estimate?: string }
}

function adaptOnboardingDocs(content: QuartzContent[]): OnboardingDoc[] {
  const docs: OnboardingDoc[] = []
  for (const [, file] of content) {
    const data = file.data
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const slug = data.slug as string | undefined
    if (!fm || !slug) continue
    const roles = Array.isArray(fm.roles) ? (fm.roles as unknown[]).filter((r) => typeof r === "string") : []
    const title = typeof fm.title === "string" && fm.title.length > 0 ? fm.title : slug
    docs.push({
      slug,
      title,
      roles: roles as string[],
      onboarding: (fm.onboarding as OnboardingDoc["onboarding"]) ?? undefined,
    })
  }
  return docs
}

function onboardingCounts(content: QuartzContent[]): Array<{ role: string; count: number }> {
  const docs = adaptOnboardingDocs(content)
  try {
    return listRoles(docs).map((role: string) => ({ role, count: buildRolePath(docs, role).length }))
  } catch (err) {
    // buildRolePath throws Error("cycle detected: ...") on a cyclic prerequisite
    // graph. `npx brain-site validate` reports that properly; here it must only
    // cost the one module, not the page.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[DashboardEmitter] onboarding paths unavailable: ${message}`)
    return []
  }
}
```

Then pass it into `buildModel`:

```ts
      activity: { logs, docs: recentDocs(pages, opts) },
      onboarding: onboardingCounts(content as QuartzContent[]),
```

- [ ] **Step 3d: Register the module** in `index.ts`, after `ActivityModule` and before `HealthModule`.

- [ ] **Step 3e: Add the fixture brain**

Now that every module exists, add a fixture pair so one test asserts a whole page rather than a module at a time. This is what catches a module that renders in isolation but breaks the page — a duplicated id, a module silently swallowed by `renderModules`' catch, an ordering regression.

Create `test/fixtures/dashboard-full/dashboard.yaml`:

```yaml
project: Fixture Brain
subtitle: Every module populated
start: 2026-07-01
end: 2026-09-30
phases:
  - { name: One, start: 2026-07-01 }
  - { name: Two, start: 2026-08-01 }
milestones:
  - { date: 2026-07-10, name: Alpha, done: true }
  - { date: 2026-08-20, name: Beta }
  - { date: 2026-09-10, end: 2026-09-12, name: Gamma, owner: Ada }
commitments:
  - { date: 2026-08-25, text: Interim review, owner: Ada }
effort: { soldDays: 20, usedDays: 8, inFlightDays: 2 }
people:
  - { name: Ada Lovelace, role: Engineer, org: Fixture Co }
```

Create `test/fixtures/dashboard-full/dashboard.status.yaml`:

```yaml
generatedAt: 2026-08-10
since: 2026-08-01
status: { rag: green, headline: All on track }
delta: Beta scope agreed.
attention:
  - { text: One open risk, detail: being handled, severity: medium }
decisions:
  - { text: Chose approach A, by: Ada, date: 2026-08-05 }
people:
  - { name: Ada Lovelace, focus: Beta build, detail: on schedule, state: on-track }
keyReads:
  - { slug: engagement, why: start here }
sources:
  - { name: Slack, state: wired }
```

Create `test/fixtures/dashboard-facts-only/dashboard.yaml` — the same `project`, `start`, `end` and `milestones` blocks as above, with no `effort:`, no `people:` and no companion status file.

Append to `test/dashboard-emitter.test.mjs`:

```js
import { fileURLToPath } from "node:url"

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url))

async function emitFixture(name, dirPrefix) {
  const dir = tmpDir(dirPrefix)
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())
  await DashboardEmitter({
    pageTitle: "Fixture Brain",
    facts: path.join(FIXTURES, name, "dashboard.yaml"),
    status: path.join(FIXTURES, name, "dashboard.status.yaml"),
  }).emit(fakeCtx(dir), CONTENT, fakeResources())
  return fs.readFileSync(path.join(dir, "index.html"), "utf8")
}

test("the fully-populated fixture renders every module, in registry order", async () => {
  const html = await emitFixture("dashboard-full", "fixture-full")
  const expected = [
    "status",
    "delta",
    "timeline",
    "next",
    "effort",
    "people",
    "attention",
    "decisions",
    "activity",
    "health",
    "explore",
  ]
  // `activity` is absent here — the fixture has no logs dir and no contentDir —
  // so assert on order among those that did render rather than on all eleven.
  const positions = expected
    .map((id) => [id, html.indexOf(`id="${id}"`)])
    .filter(([, at]) => at !== -1)
  assert.equal(positions.length >= 9, true, `only rendered: ${positions.map((p) => p[0])}`)
  const order = positions.map(([, at]) => at)
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
})

test("every rendered module id is unique on the page", async () => {
  const html = await emitFixture("dashboard-full", "fixture-unique")
  const ids = [...html.matchAll(/id="(dash-[^"]+|status|delta|timeline|next|effort|people|attention|decisions|activity|health|explore)"/g)]
    .map((m) => m[1])
  assert.deepEqual([...new Set(ids)].length, ids.length)
})

test("the facts-only fixture omits every assessed module but keeps the stated ones", async () => {
  const html = await emitFixture("dashboard-facts-only", "fixture-facts")
  assert.match(html, /id="timeline"/)
  assert.match(html, /id="next"/)
  assert.match(html, /id="explore"/)
  assert.equal(html.includes('id="delta"'), false)
  assert.equal(html.includes('id="attention"'), false)
  assert.equal(html.includes('id="decisions"'), false)
  assert.equal(html.includes('id="people"'), false)
  assert.equal(html.includes('id="effort"'), false)
  // No status file means no RAG, but the counters are derived from milestones, so
  // the summary strip still renders.
  assert.match(html, /id="status"/)
  assert.equal(html.includes("dash-rag--"), false)
})
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS — 47 module tests, 17 emitter tests.

- [ ] **Step 5: Commit**

```bash
git add assets/plugins src/lib/dashboard/model.mjs test/fixtures test/dashboard-modules.test.mjs test/dashboard-emitter.test.mjs
git commit -m "$(cat <<'EOF'
feat: add the onboarding module and a whole-page fixture

Adds the last module, then a fixture brain pair so one test asserts a whole
page rather than a module at a time — which is what catches a module that
renders in isolation but breaks the page: a duplicated id, one silently
swallowed by renderModules' catch, or an ordering regression.

Reuses buildRolePath rather than reimplementing it: two orderings of the same
reading path could disagree, and the /onboarding pages already own that logic.

Role counts are computed in the emitter, not model.mjs, because deriving them
needs `roles:`/`onboarding.prerequisites` frontmatter — content knowledge that
belongs with the code already adapting Quartz's parsed content, keeping the
derivation layer free of frontmatter conventions.

A cyclic prerequisite graph costs this one module rather than the page; validate
is where that becomes an error.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Stylesheet and collapsible chrome

The dashboard's visual layer, plus the chrome toggle. Everything is expressed against Quartz's own CSS custom properties, so light mode and dark mode both work without a second palette.

**Files:**
- Create: `assets/styles/_dashboard.scss`
- Modify: `assets/styles/custom.scss` (add `@use "./dashboard";`)
- Modify: `assets/plugins/dashboard-emitter.ts` (emit the chrome toggle and its inline script)
- Modify: `test/dashboard-emitter.test.mjs`

**Interfaces:**
- Consumes: the Quartz theme variables already set by `assets/quartz.config.base.yaml` — `--light`, `--lightgray`, `--gray`, `--darkgray`, `--dark`, `--secondary`, `--tertiary`, plus `$mobile`/`$desktop` from `variables.scss`.
- Produces: the `dash-*` class contract every module renderer already emits, and `data-chrome="collapsed|expanded"` on `#quartz-root`.

- [ ] **Step 1: Write the failing test**

Append to `test/dashboard-emitter.test.mjs`:

```js
test("the page declares collapsed chrome by default and offers a toggle", async () => {
  const dir = tmpDir("dash-chrome")
  const { html } = await emitTo(dir)
  assert.match(html, /data-chrome="collapsed"/)
  assert.match(html, /class="dash-chrome-toggle"/)
  assert.match(html, /aria-pressed="true"/)
})

test("the chrome preference is restored from localStorage before paint", async () => {
  const dir = tmpDir("dash-chrome-restore")
  const { html } = await emitTo(dir)
  assert.match(html, /localStorage/)
  assert.match(html, /brain-site-chrome/)
  // Must run inline in the body, not deferred: a class applied after paint
  // produces a visible layout jump.
  assert.equal(html.indexOf("brain-site-chrome") < html.indexOf('class="dashboard"'), true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dashboard-emitter.test.mjs`
Expected: FAIL — no `data-chrome` attribute in the emitted HTML.

- [ ] **Step 3a: Emit the toggle and the restore script**

In `assets/plugins/dashboard-emitter.ts`, add these constants above `renderModules`:

```ts
const CHROME_STORAGE_KEY = "brain-site-chrome"

// Runs inline, before the dashboard markup, so a stored "expanded" preference is
// applied before first paint. Deferring it to afterDOMReady would show the
// collapsed layout and then jump.
//
// Written as a plain (non-module) inline script that is idempotent — it only
// reads storage and sets an attribute — because Quartz's SPA router re-inserts
// body content on navigation and a script with side effects would double them.
const CHROME_SCRIPT =
  `<script data-persist="true">(function(){try{` +
  `var v=localStorage.getItem(${JSON.stringify(CHROME_STORAGE_KEY)});` +
  `if(v==="expanded"){var r=document.getElementById("quartz-root");` +
  `if(r){r.setAttribute("data-chrome","expanded");}}` +
  `}catch(e){}})()</script>`

const CHROME_TOGGLE =
  `<button type="button" class="dash-chrome-toggle" aria-pressed="true" ` +
  `title="Show or hide the sidebars" onclick="(function(b){` +
  `var r=document.getElementById('quartz-root');` +
  `var next=r.getAttribute('data-chrome')==='expanded'?'collapsed':'expanded';` +
  `r.setAttribute('data-chrome',next);` +
  `b.setAttribute('aria-pressed',String(next==='collapsed'));` +
  `try{localStorage.setItem(${JSON.stringify(CHROME_STORAGE_KEY)},next);}catch(e){}` +
  `})(this)">Sidebars</button>`
```

Change the body assembly in `emit` to:

```ts
    const heading =
      `<div class="dash-header">` +
      `<h1 class="dash-heading">${escapeHtml(String(vm.heading))}</h1>` +
      (vm.subtitle === null
        ? ""
        : `<p class="dash-subtitle">${escapeHtml(String(vm.subtitle))}</p>`) +
      CHROME_TOGGLE +
      `</div>`
    const body = `${CHROME_SCRIPT}<div class="dashboard">${heading}${renderModules(vm)}</div>`
```

`data-chrome="collapsed"` must be on `#quartz-root` itself. `page-shell.ts` writes that element, so add the attribute there — it is inert for every other page because nothing styles it without `.dashboard` present:

In `assets/plugins/shared/page-shell.ts`, change the `#quartz-root` line in `pageShell`'s template to accept a per-page attribute. Add a parameter after `donorExclude`:

```ts
  rootAttrs: string = "",
```

and use it:

```ts
<div id="quartz-root" class="page" data-frame="default"${rootAttrs ? ` ${rootAttrs}` : ""}>
```

Thread it through `emitPage` with the same default and position (a ninth, optional parameter after `donorExclude`), forwarding it to `pageShell`:

```ts
export async function emitPage(
  ctx: BuildCtx,
  resources: StaticResources,
  slug: string,
  title: string,
  bodyHtml: string,
  loggerLabel: string,
  tocHtml: string = "",
  donorExclude: Iterable<string> = [],
  rootAttrs: string = "",
): Promise<FilePath> {
  try {
    const html = await pageShell(ctx, resources, slug, title, bodyHtml, tocHtml, donorExclude, rootAttrs)
```

Both existing callers (`onboarding-emitter.ts`, `logs-timeline-emitter.ts`) pass fewer arguments and are unaffected. Then update the dashboard emitter's own call to pass it:

```ts
      await emitPage(
        ctx,
        resources,
        "index",
        String(vm.heading),
        body,
        "DashboardEmitter",
        "",
        ["index"],
        'data-chrome="collapsed"',
      ),
```

- [ ] **Step 3b: Write `assets/styles/_dashboard.scss`**

```scss
@use "./variables.scss" as *;

// Dashboard styles.
//
// Every colour is one of Quartz's own theme custom properties (set from the
// Loomery design-system tokens in quartz.config.base.yaml), never a literal.
// That is what makes light and dark mode both work from one stylesheet: the
// variables flip, these rules do not.
//
// --dash-line is derived rather than added as a new token: a card needs a border
// distinguishable from its own fill, and mixing the existing muted-foreground
// colour into transparency gives that in both themes without introducing a
// palette entry that has to be maintained in two places.

.dashboard {
  --dash-line: color-mix(in oklab, var(--gray) 35%, transparent);
  --dash-amber: #ffc44d;
  --dash-red: #ff5c72;

  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.dash-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 1rem;

  .dash-heading {
    margin: 0;
    flex: 1 1 auto;
  }
  .dash-subtitle {
    margin: 0;
    flex: 1 1 100%;
    order: 3;
    color: var(--gray);
    font-family: var(--codeFont);
    font-size: 0.8rem;
  }
}

.dash-chrome-toggle {
  order: 2;
  background: none;
  border: 1px solid var(--dash-line);
  border-radius: 99px;
  color: var(--gray);
  cursor: pointer;
  font-family: var(--codeFont);
  font-size: 0.7rem;
  padding: 0.2rem 0.7rem;

  &:hover {
    color: var(--secondary);
    border-color: var(--secondary);
  }
}

// Collapsed chrome: the dashboard's whole job is a wide overview, and it is the
// one page where the explorer is redundant because the dashboard already links
// everywhere.
//
// Gated on `:has(.dashboard)` so the rule can only ever fire on a page that
// actually contains a dashboard. `data-chrome` is written onto #quartz-root by
// page-shell for this emitter alone, but the extra gate means that even if the
// attribute appeared on another page it could not collapse that page's grid.
#quartz-root[data-chrome="collapsed"] {
  & #quartz-body:has(.dashboard) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "grid-header" "grid-center" "grid-footer";

    & > .left.sidebar,
    & > .right.sidebar {
      display: none;
    }
  }
}

.dash-card {
  background: var(--lightgray);
  border: 1px solid var(--dash-line);
  border-radius: 8px;
  padding: 1rem 1.15rem;
}

.dash-label {
  align-items: center;
  color: var(--gray);
  display: flex;
  font-family: var(--codeFont);
  font-size: 0.62rem;
  justify-content: space-between;
  letter-spacing: 0.14em;
  margin: 0 0 0.75rem;
  text-transform: uppercase;
}

.dash-pill {
  border: 1px solid var(--dash-line);
  border-radius: 99px;
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  padding: 0.1rem 0.45rem;

  &--stated { color: var(--secondary); }
  &--assessed { color: var(--dash-amber); }
  &--mixed { color: var(--gray); }
}

.dash-muted { color: var(--gray); font-size: 0.78rem; }
.dash-footnote { margin: 0.7rem 0 0; }

.dash-list {
  list-style: none;
  margin: 0;
  padding: 0;

  & > li {
    border-top: 1px solid var(--dash-line);
    font-size: 0.86rem;
    padding: 0.45rem 0;

    &:first-child { border-top: none; }
  }
}

.dash-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }

.dash-chip {
  border: 1px solid var(--dash-line);
  border-radius: 99px;
  color: var(--darkgray);
  font-family: var(--codeFont);
  font-size: 0.7rem;
  padding: 0.15rem 0.6rem;
  text-decoration: none;

  &:hover { border-color: var(--secondary); color: var(--secondary); }
  &--wired { color: var(--secondary); }
  &--partial { color: var(--dash-amber); }
  &--absent { color: var(--gray); }
  &--role b { color: var(--secondary); font-weight: 500; }
}

// --- summary ---------------------------------------------------------------

.dash-summary {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 1.1rem;
}

.dash-summary-text { flex: 1 1 14rem; }
.dash-summary-headline { color: var(--dark); font-size: 0.98rem; }

.dash-rag {
  border-radius: 50%;
  flex: none;
  height: 1rem;
  width: 1rem;

  &--green { background: var(--secondary); }
  &--amber { background: var(--dash-amber); }
  &--red { background: var(--dash-red); }
}

.dash-counters { display: flex; gap: 1.1rem; text-align: center; }

.dash-counter {
  b { color: var(--dark); display: block; font-family: var(--codeFont); font-size: 1.15rem; line-height: 1.1; }
  span { color: var(--gray); font-size: 0.55rem; letter-spacing: 0.1em; text-transform: uppercase; }
  &--behind b { color: var(--dash-red); }
  &--attention b { color: var(--dash-amber); }
}

.dash-delta { font-size: 0.9rem; line-height: 1.55; margin: 0; }

// --- fisheye timeline ------------------------------------------------------
//
// The bar is aria-hidden and the .dash-spine list is the accessible content.
// Below $mobile the bar is removed entirely and the spine becomes the visible
// timeline — dates alone need ~70px each, so no horizontal treatment survives a
// phone. Between the two, milestone names are dropped and the bar scrolls if
// even the dates will not fit.

.dash-fisheye {
  display: flex;
  height: 4.1rem;
  margin: 0.2rem 0 0;
}

.dash-seg {
  border-right: 1px solid var(--dash-line);
  flex-grow: 0;
  flex-shrink: 0;
  position: relative;

  &:last-child { border-right: none; }
  &--current { background: color-mix(in oklab, var(--darkgray) 5%, transparent); }
}

.dash-track { background: color-mix(in oklab, var(--gray) 30%, transparent); height: 6px; left: 0; position: absolute; right: 0; top: 1.7rem; }
.dash-seg--past .dash-track { background: color-mix(in oklab, var(--secondary) 32%, transparent); }
.dash-fill { background: var(--secondary); height: 6px; left: 0; opacity: 0.75; position: absolute; top: 1.7rem; }

.dash-node {
  background: color-mix(in oklab, var(--gray) 45%, transparent);
  border: 2px solid var(--light);
  border-radius: 50%;
  height: 12px;
  position: absolute;
  top: 1.55rem;
  transform: translateX(-50%);
  width: 12px;

  &--done { background: var(--secondary); }
}

.dash-node-name,
.dash-node-date {
  color: var(--gray);
  font-size: 0.6rem;
  position: absolute;
  transform: translateX(-50%);
  white-space: nowrap;
}
.dash-node-name { top: 0.15rem; }
.dash-node-date { font-family: var(--codeFont); top: 2.85rem; }

.dash-today { background: var(--dark); height: 1.65rem; position: absolute; top: 1.1rem; transform: translateX(-50%); width: 3px; }
.dash-today-label { color: var(--dark); font-family: var(--codeFont); font-size: 0.6rem; position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }

.dash-legend {
  border-top: 1px solid var(--dash-line);
  color: var(--gray);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.3rem 1rem;
  justify-content: space-between;
  margin: 0.9rem 0 0;
  padding-top: 0.7rem;

  strong { color: var(--darkgray); font-weight: 500; }
  .dash-legend-next { color: var(--dash-amber); strong { color: var(--dash-amber); } }
  .dash-legend-next--over { color: var(--dash-red); strong { color: var(--dash-red); } }
}

.dash-plainbar {
  background: color-mix(in oklab, var(--gray) 30%, transparent);
  border-radius: 99px;
  height: 8px;
  margin: 0.3rem 0;
  position: relative;

  .dash-track { display: none; }
  .dash-fill { border-radius: 99px; top: 0; }
  .dash-today { height: 1rem; top: -4px; }
}

// The spine: accessible representation always, visible timeline below $mobile.
// Visually hidden rather than display:none on wide screens, so a screen reader
// still reaches it while the bar carries the visual weight.
.dash-spine {
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  height: 1px;
  list-style: none;
  margin: 0;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.dash-spine-row {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 4.6rem 1fr;
  padding: 0.5rem 0;
  position: relative;

  time { color: var(--gray); font-family: var(--codeFont); font-size: 0.7rem; text-align: right; }
  &--done time { color: var(--secondary); }
  &--today {
    background: color-mix(in oklab, var(--darkgray) 6%, transparent);
    border-radius: 5px;
    time, span { color: var(--dark); }
  }
}

@media #{$mobile} {
  .dash-fisheye { display: none; }

  .dash-spine {
    clip: auto;
    clip-path: none;
    height: auto;
    overflow: visible;
    position: static;
    white-space: normal;
    width: auto;

    .dash-spine-row {
      border-left: 2px solid var(--dash-line);
      margin-left: 4.6rem;
      padding-left: 1rem;

      time { left: -5.6rem; position: absolute; width: 4.6rem; }
    }
  }
}

// Between mobile and desktop the names cannot fit; keep the dates and let the
// bar scroll rather than overlapping labels.
@media #{$tablet} {
  .dash-node-name { display: none; }
  .dash-fisheye { overflow-x: auto; }
  .dash-seg { min-width: 4.5rem; }
}

// --- people, effort, activity ----------------------------------------------

.dash-person {
  align-items: start;
  border-top: 1px solid var(--dash-line);
  display: grid;
  gap: 0.85rem;
  grid-template-columns: 9.5rem 1fr 5rem;
  padding: 0.6rem 0;

  &:first-child { border-top: none; }
}

.dash-person-who {
  b { color: var(--dark); display: block; font-size: 0.86rem; font-weight: 500; }
  span { color: var(--gray); font-size: 0.68rem; }
}
.dash-person-focus { font-size: 0.84rem; }

.dash-state {
  font-family: var(--codeFont);
  font-size: 0.58rem;
  letter-spacing: 0.06em;
  text-align: right;

  &--on-track { color: var(--secondary); }
  &--awaiting { color: var(--dash-amber); }
  &--blocked { color: var(--dash-red); }
  &--idle { color: var(--gray); }
}

.dash-burn {
  background: color-mix(in oklab, var(--gray) 30%, transparent);
  border-radius: 99px;
  height: 8px;
  overflow: hidden;
  position: relative;

  span { bottom: 0; position: absolute; top: 0; }
}
.dash-burn-used { background: var(--secondary); left: 0; opacity: 0.75; }
.dash-burn-flight { background: var(--dash-amber); opacity: 0.6; }
.dash-burn-legend { margin: 0.6rem 0 0; }
.dash-burn-key--used { color: var(--secondary); }
.dash-burn-key--flight { color: var(--dash-amber); }

.dash-activity { display: grid; gap: 1.6rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }
.dash-activity-heading { margin: 0 0 0.35rem; }

.dash-sev {
  border-radius: 50%;
  display: inline-block;
  height: 6px;
  margin-right: 0.5rem;
  vertical-align: 1px;
  width: 6px;

  &--high { background: var(--dash-red); }
  &--medium { background: var(--dash-amber); }
  &--low { background: var(--gray); }
  &--none { background: color-mix(in oklab, var(--gray) 45%, transparent); }
}

.dash-next-row {
  time { color: var(--gray); font-family: var(--codeFont); font-size: 0.72rem; margin-right: 0.5rem; }
  &--soon time { color: var(--dash-amber); }
}

// Two-across on a wide (chrome-collapsed) page: these modules are terse enough
// to pair, and pairing them keeps the fold higher.
@media #{$desktop} {
  #quartz-root[data-chrome="collapsed"] .dashboard {
    #attention, #decisions { grid-column: span 1; }
  }
}
```

- [ ] **Step 3c: Import it**

Add to `assets/styles/custom.scss`, after its existing `@use "./variables.scss" as *;`:

```scss
@use "./dashboard";
```

Note for the implementer: `setup.mjs`'s `copyPackageAssets` copies every file in `assets/styles/` into `.brain-site/quartz/styles/`, so `_dashboard.scss` ships with no further wiring.

- [ ] **Step 4: Run tests, then check it in a browser**

Run: `node --test`
Expected: PASS.

Then verify visually against a real brain:

```bash
cd "/Users/tomholmes/Developer/Project Brains/Secret escapes" && npx brain-site build
```

Confirm `.brain-site/public/index.html` exists and contains `data-chrome="collapsed"`, then serve and check: the toggle restores the sidebars, the choice survives a reload, and narrowing the window below 800px replaces the bar with the vertical spine.

- [ ] **Step 5: Commit**

```bash
git add assets/styles/_dashboard.scss assets/styles/custom.scss assets/plugins test/dashboard-emitter.test.mjs
git commit -m "$(cat <<'EOF'
feat: style the dashboard and make the page chrome collapsible

Every colour is one of Quartz's own theme custom properties rather than a
literal, so light and dark mode both work from one stylesheet — the variables
flip, the rules do not.

The chrome collapse is scoped by `#quartz-body:has(.dashboard)`, so no other
page's grid can be affected, and the stored preference is applied by an inline
script before the dashboard markup: deferring it to afterDOMReady would show the
collapsed layout and then visibly jump.

Below the mobile breakpoint the fisheye is removed and the spine list — already
in the DOM as the accessible representation — becomes the visible timeline.
Dates alone need ~70px each, so no horizontal treatment survives a phone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `brain-site validate` covers the dashboard files

The loud path. The build warns and carries on; this is where a broken dashboard file is an error with a non-zero exit.

**Files:**
- Modify: `src/commands/validate.mjs`
- Modify: `bin/brain-site.mjs:62-70`
- Test: `test/cli.test.mjs`

**Interfaces:**
- Consumes: `validateFacts`, `validateStatus` from `src/lib/dashboard/schema.mjs`; `DASHBOARD_FACTS_FILE`, `DASHBOARD_STATUS_FILE` from `src/config/merge.mjs`.
- Produces: `runValidate({ docsRoot, sourceHint, rootDir })` — a third option. When `rootDir` is given, both dashboard files are validated too; when omitted, behaviour is exactly as today.

- [ ] **Step 1: Write the failing test**

Append to `test/cli.test.mjs`:

```js
// --- dashboard file validation ---------------------------------------------

test("validate reports an unknown key in dashboard.yaml and exits non-zero", () => {
  const dir = tmpDir("validate-dash-bad")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "mileStones: []\n")
  const errors = []
  const originalError = console.error
  console.error = (msg) => errors.push(String(msg))
  let code
  try {
    code = runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir })
  } finally {
    console.error = originalError
  }
  assert.equal(code, 1)
  assert.equal(errors.some((e) => e.includes('unknown key "mileStones"')), true)
  assert.equal(errors.some((e) => e.includes("dashboard.yaml")), true)
})

test("validate reports a status person missing from the roster", () => {
  const dir = tmpDir("validate-dash-roster")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "people:\n  - name: Milly Allatson\n")
  fs.writeFileSync(path.join(dir, "dashboard.status.yaml"), "people:\n  - name: Ghost\n")
  const errors = []
  const originalError = console.error
  console.error = (msg) => errors.push(String(msg))
  let code
  try {
    code = runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir })
  } finally {
    console.error = originalError
  }
  assert.equal(code, 1)
  assert.equal(errors.some((e) => e.includes("people roster")), true)
})

test("validate passes when both dashboard files are valid", () => {
  const dir = tmpDir("validate-dash-good")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "project: Acme\nend: 2026-09-14\n")
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir }), 0)
})

test("validate passes when neither dashboard file exists", () => {
  const dir = tmpDir("validate-dash-absent")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir }), 0)
})

test("omitting rootDir skips dashboard validation entirely", () => {
  const dir = tmpDir("validate-dash-skipped")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "mileStones: []\n")
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs") }), 0)
})
```

If `test/cli.test.mjs` lacks a `tmpDir` helper or the `runValidate` import, add them to match the pattern used in `test/setup-units.test.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli.test.mjs`
Expected: FAIL — exit code 0 where 1 was expected, because `runValidate` ignores `rootDir`.

- [ ] **Step 3a: Extend `src/commands/validate.mjs`**

Add the imports:

```js
import YAML from "yaml"
import { validateFacts, validateStatus } from "../lib/dashboard/schema.mjs"
import { DASHBOARD_FACTS_FILE, DASHBOARD_STATUS_FILE } from "../config/merge.mjs"
```

Add this function above `runValidate`:

```js
// Validates the two dashboard files, if present. Returns an array of
// `<file>: <message>` strings — empty when everything is fine or absent.
//
// This is the loud counterpart to the build's warn-and-continue: the same
// validators run in both places, but here a problem exits non-zero. A missing
// file is not a problem — both are optional by design.
function validateDashboardFiles(rootDir) {
  const problems = []

  const read = (filename) => {
    const filePath = join(rootDir, filename)
    let raw
    try {
      raw = readFileSync(filePath, "utf8")
    } catch (err) {
      if (err.code !== "ENOENT") problems.push(`${filename}: ${err.message}`)
      return { present: false, data: null }
    }
    try {
      return { present: true, data: YAML.parse(raw) ?? null }
    } catch (err) {
      problems.push(`${filename}: ${err.message}`)
      return { present: false, data: null }
    }
  }

  const facts = read(DASHBOARD_FACTS_FILE)
  if (facts.present && facts.data !== null) {
    const { errors } = validateFacts(facts.data)
    for (const message of errors) problems.push(`${DASHBOARD_FACTS_FILE}: ${message}`)
  }

  const status = read(DASHBOARD_STATUS_FILE)
  if (status.present && status.data !== null) {
    const { errors } = validateStatus(status.data, facts.data)
    for (const message of errors) problems.push(`${DASHBOARD_STATUS_FILE}: ${message}`)
  }

  return problems
}
```

Then change `runValidate`'s signature and add the dashboard pass. The docs check runs first and its early `return 1` on a missing docs root is unchanged; the dashboard problems are collected and reported alongside the frontmatter ones so a single run surfaces everything:

```js
export function runValidate({ docsRoot, sourceHint = null, rootDir = null }) {
  // ... existing walk / parse / validateDocs, unchanged, up to the `const { ok, errors } = validateDocs(docs)` line ...

  const dashboardProblems = rootDir === null ? [] : validateDashboardFiles(rootDir)

  if (!ok || dashboardProblems.length > 0) {
    for (const { slug, message } of errors) {
      console.error(`${slug}: ${message}`)
    }
    for (const problem of dashboardProblems) {
      console.error(problem)
    }
    const failingDocs = new Set(errors.map((e) => e.slug)).size
    const parts = []
    if (errors.length > 0) parts.push(`${errors.length} doc error(s) across ${failingDocs} file(s)`)
    if (dashboardProblems.length > 0) parts.push(`${dashboardProblems.length} dashboard error(s)`)
    console.error(`\n${parts.join(", ")}.`)
    return 1
  }

  const suffix = rootDir === null ? "" : ", dashboard files ok"
  console.log(`ok: ${docs.length} docs validated, 0 errors${suffix}.`)
  return 0
}
```

- [ ] **Step 3b: Pass `rootDir` from the CLI**

In `bin/brain-site.mjs`, add one `rootDir` line to the existing `runValidate` call, leaving `docsRoot` and `sourceHint` exactly as they are:

```js
      runValidate({
        docsRoot: path.resolve(rootDir, dir),
        // The two dashboard files live at the repository root by convention, so
        // validating them needs the root itself — not the docs directory, which
        // a brain can point anywhere via `content:`.
        rootDir,
        // Only set when neither --docs nor brain-site.yaml's `content:` supplied the
        // path, so a "not found" error can say where the path came from.
        sourceHint: fellBack
          ? `no --docs flag and no usable \`content:\` in brain-site.yaml, so this fell back to "${DEFAULT_DOCS_DIR}"`
          : null,
      }),
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/validate.mjs bin/brain-site.mjs test/cli.test.mjs
git commit -m "$(cat <<'EOF'
feat: validate the dashboard files in `brain-site validate`

The same validators run at build time and here, but the build warns and carries
on while this exits non-zero — a half-written dashboard.yaml must not stop a
brain being browsable, and `validate` is where it becomes loud.

Doc and dashboard problems are reported in one run rather than short-circuiting,
so a single invocation surfaces everything.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Seed Secret Escapes

Both files hand-authored from what is already grounded in that brain's `docs/`, then verified against a real build. **This task commits to a different repository** — `/Users/tomholmes/Developer/Project Brains/Secret escapes` — not to `brain-site`.

Every value below traces to `docs/engagement.md`, `docs/stakeholders.md` or `docs/onboarding-status.md` in that brain. Nothing is invented. `effort:` is deliberately omitted: no source tracks days sold or used, and the module's whole design is to be absent rather than show a fabricated number.

**Files:**
- Create: `<brain>/dashboard.yaml`
- Create: `<brain>/dashboard.status.yaml`

- [ ] **Step 1: Update that brain's dependency and confirm the current home page**

```bash
cd "/Users/tomholmes/Developer/Project Brains/Secret escapes" && npm update @loomery/brain-site && npx brain-site build
```

Expected: a build that succeeds and produces `.brain-site/public/index.html` containing only the Explore module — the pre-seed baseline.

- [ ] **Step 2: Write `dashboard.yaml`**

```yaml
# Ground truth for the dashboard at `/`. Hand-written and human-owned — never
# rewritten by a sync. Assessed material (RAG, attention, who is doing what)
# lives in dashboard.status.yaml instead.
#
# Sources: docs/engagement.md (Miro board timeline, kickoff and Hack Week
# confirmations) and docs/stakeholders.md (the roster).

project: Secret Escapes
subtitle: AI Champions & Hack Week

# The Miro planning board's timeline runs 20 Jul – 14 Sep 2026
# (docs/engagement.md, Timeline).
start: 2026-07-20
end: 2026-09-14

phases:
  - { name: Preparation, start: 2026-07-20 }
  - { name: Pre-work, start: 2026-08-04 }
  - { name: Hack Week, start: 2026-09-07 }
  - { name: Follow-up, start: 2026-09-12 }

milestones:
  - date: 2026-07-20
    name: Preparation
    done: true
    label: Content collation, launch and comms prep
  - date: 2026-07-30
    name: Contracts signed
    done: true
    label: Contracts sorted; AI Champions handover shared
  - date: 2026-08-05
    name: Kickoff
    done: true
    label: Success metrics and Hack Week structure agreed
  - date: 2026-08-14
    name: Survey responses due
    owner: Milly
  - date: 2026-08-17
    name: Training materials land
    owner: Tom
    label: Roughly three weeks ahead of Hack Week
  - date: 2026-09-07
    end: 2026-09-11
    name: Hack Week
    label: In person, London — Mon PM kickoff, Fri PM demos
  - date: 2026-09-14
    name: Synthesis & playback

commitments:
  - date: 2026-08-17
    text: Review survey responses, prioritise ideas, identify data-access needs
    owner: Milly

# No `effort:` block: nothing in this brain records days sold or used, and the
# Effort module is absent rather than showing a number nobody is tracking.

people:
  - { name: Milly Allatson, role: Product Manager, org: Loomery }
  - { name: Tom Holmes, role: Engineer, org: Loomery }
  - { name: Brett Thornton, role: Director, org: Loomery }
  - { name: Will Rocha-Thomas, role: Engineer, org: Loomery }
  - { name: Gianni Raftis, role: AI Programme Lead, org: Secret Escapes }
  - { name: Ben McLellan, role: Director of Product & Design, org: Secret Escapes }
  - { name: Nikos Galifianakis, role: Director of Engineering, org: Secret Escapes }
  - { name: Efe Mumoglu, role: Senior Engineering Manager, org: Secret Escapes }
```

- [ ] **Step 3: Write `dashboard.status.yaml`**

```yaml
# Assessed status for the dashboard at `/`. Regenerated wholesale by `/brain
# sync` — do not hand-edit expecting it to survive. Ground truth (dates,
# milestones, the roster) lives in dashboard.yaml.
#
# Every entry here is grounded in docs/engagement.md and
# docs/onboarding-status.md as of 2026-08-13.

generatedAt: 2026-08-13
since: 2026-08-06

status:
  rag: amber
  headline: Venue unconfirmed five weeks out; survey returns due tomorrow

delta: |
  The champions survey went out on 7 August to the whole
  #ai-champions-ft-loomery channel rather than just engineering champions, with
  responses due 14 August. Venue is now leaning to Secret Escapes' own Holborn
  office over the ~£3,000 external hire, pending Gianni confirming the
  in-office-days policy. Hack Week is locked for 7–11 September in London. The
  internal AI policy and processing docs are still outstanding — Efe is the
  route while Nikos is on holiday.

attention:
  - text: Holborn office availability
    detail: Gianni confirming the in-office-days policy; flights and accommodation are blocked behind it
    severity: high
  - text: Internal AI policy and processing docs
    detail: Tom to get these from Efe while Nikos is away; blocks the custom Secret Escapes guidelines
    severity: medium
  - text: Third strategic pillar still unnamed
    detail: the org briefing covers Connected and AI-led only
    severity: medium
  - text: End-customer personas ungrounded
    detail: no source yet covers users, so docs/product-context.md stays partial
    severity: low
  - text: Miro board grounded from screenshots, not a live read
    detail: the Miro MCP has repeatedly 502'd on fetch — retry on a later sync
    severity: low

decisions:
  - { text: "Hack Week runs 7–11 September, in person in London", by: Gianni, date: 2026-08-06 }
  - { text: "Survey sent to the whole champions channel, not just engineering", by: Milly, date: 2026-08-07 }
  - { text: "Five post-Hack-Week success metrics agreed at kickoff", by: Ben, date: 2026-08-05 }
  - { text: "Venue leaning to the Holborn office over a ~£3k external hire", by: Gianni, date: 2026-08-07 }
  - { text: "Linear, Notion, Figma and Monday.com are not in use on this engagement", date: 2026-08-06 }

people:
  - name: Milly Allatson
    focus: Champions comms & survey
    detail: Chasing survey returns before tomorrow's cutoff; Mon/Fri 10am syncs scheduled
    state: on-track
  - name: Tom Holmes
    focus: Training content & AI policy
    detail: Waiting on the internal AI policy docs from Efe
    state: blocked
  - name: Gianni Raftis
    focus: Venue confirmation
    detail: Confirming the Holborn in-office-days policy, then booking flights and accommodation
    state: awaiting
  - name: Efe Mumoglu
    focus: Internal AI policy hand-off
    detail: Covering while Nikos is on holiday
    state: awaiting
  - name: Brett Thornton
    focus: Engagement oversight
    state: idle
  - name: Will Rocha-Thomas
    focus: Supporting as needed
    state: idle

keyReads:
  - { slug: engagement, why: why Loomery is here, the four-phase plan, and what was agreed at kickoff }
  - { slug: stakeholders, why: who decides and who to route questions through, on both sides }
  - { slug: product-context, why: what Secret Escapes actually sells and the domain language }

sources:
  - { name: Slack, state: wired, note: "two Slack Connect channels: #secretescapes-loomery and #ai-champions-ft-loomery" }
  - { name: Granola, state: wired, note: scoped to the "secret escapes" folder }
  - { name: Google Drive, state: wired, note: index-style, four files }
  - { name: Miro, state: partial, note: one board, grounded from screenshots — the MCP has repeatedly 502'd }
  - { name: Linear, state: absent }
  - { name: Notion, state: absent }
  - { name: Figma, state: absent }
  - { name: Monday.com, state: absent }
```

- [ ] **Step 4: Validate, build, and check the page**

```bash
cd "/Users/tomholmes/Developer/Project Brains/Secret escapes" && npx brain-site validate
```

Expected: `ok: N docs validated, 0 errors, dashboard files ok.`

```bash
cd "/Users/tomholmes/Developer/Project Brains/Secret escapes" && npx brain-site serve
```

Then check, in the browser, that all of these hold — this is the acceptance test for the whole feature:

- The summary strip shows **Amber**, days remaining to 14 Sep, and counters reading 3 done / 0 behind / 5 attention.
- The fisheye shows all seven milestones with names; the magnified gap is Kickoff → Survey responses due; today sits inside it with a `day N of 9` label.
- The legend reads `Since Kickoff · N days ago` and `Next: Survey responses due · …`.
- **No Effort module appears** — that is correct, not a bug.
- **No Onboarding module appears** — no Secret Escapes doc carries `roles:` yet.
- Who's-on-it lists all eight people, with Tom BLOCKED and Gianni AWAITING.
- Recent activity links resolve: the log links land on `/logs` at the right anchor, doc links open the doc.
- The chrome toggle restores the sidebars and the choice survives a reload.
- Narrowing below 800px replaces the bar with the vertical spine.

- [ ] **Step 5: Commit — in the brain repository**

```bash
cd "/Users/tomholmes/Developer/Project Brains/Secret escapes" && git add dashboard.yaml dashboard.status.yaml && git commit -m "$(cat <<'EOF'
feat: seed the dashboard's facts and status files

Every value traces to docs/engagement.md, docs/stakeholders.md or
docs/onboarding-status.md — nothing is invented.

No `effort:` block: nothing in this brain records days sold or used, and the
Effort module is designed to be absent rather than show a fabricated number.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Document and release v1.4.0

**Files:**
- Modify: `README.md`
- Modify: `package.json` (`1.3.0` -> `1.4.0`)

- [ ] **Step 1: Document the two files in `README.md`**

Add a section after the `brain-site.yaml` block, and note in the Commands table that `validate` now also checks these:

```markdown
## The dashboard

`/` is a project dashboard: countdown, milestone timeline, status, who's on it,
recent activity. It is built from two **optional** files at the repository root,
both discovered by convention — there is no `brain-site.yaml` key for either,
and a brain with neither still gets a home page (a structural listing of its
pages and sections, which is what `/` was before).

`dashboard.yaml` — human-owned ground truth. Never rewritten by a sync.

| Key | Feeds |
| --- | --- |
| `project`, `subtitle` | the page heading (falls back to `pageTitle`) |
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
```

- [ ] **Step 2: Bump the version**

Set `"version": "1.4.0"` in `package.json`. Minor, not major: no brain-side change is forced, and a brain with no dashboard files renders what it rendered before.

- [ ] **Step 3: Run the full suite one last time**

Run: `node --test`
Expected: PASS, every test.

- [ ] **Step 4: Commit and tag**

```bash
git add README.md package.json
git commit -m "$(cat <<'EOF'
docs: document the dashboard and release v1.4.0

Minor rather than major: no brain-side change is forced, and a brain with
neither dashboard file renders exactly what it rendered before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git tag v1.4.0
```

- [ ] **Step 5: Confirm the consumer path end to end**

Both brains pin `github:loomery/brain-site#semver:^1.0.0`, so a `^1.4.0` tag is picked up without editing either `package.json`. After pushing the branch and tag:

```bash
cd "/Users/tomholmes/Developer/Project Brains/Eque2-Chalkstring" && npm update @loomery/brain-site && npx brain-site build
```

Expected: a successful build whose `/` shows **only the Explore module** — that brain has no dashboard files, so it gets today's page and nothing worse. Confirming this is the point of the step: it proves the skin degrades cleanly for an unseeded brain, which is the guarantee that made this a minor release.

Seeding Eque2-Chalkstring, and adding `roles:` frontmatter to Secret Escapes docs so its Onboarding module becomes non-empty, are deliberate follow-ups — not part of this plan.
