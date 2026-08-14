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

test("an empty-string facts field is an error naming emptiness, not its type", () => {
  const { ok, errors } = validateFacts({ project: "" })
  assert.equal(ok, false)
  assert.match(errors[0], /project must not be empty/)
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

test("clientLogo is accepted as a non-empty string", () => {
  assert.equal(validateFacts({ clientLogo: "/static/acme-logo.svg" }).ok, true)
})

test("a non-string or empty clientLogo is an error", () => {
  assert.equal(validateFacts({ clientLogo: 42 }).ok, false)
  assert.equal(validateFacts({ clientLogo: "" }).ok, false)
})
