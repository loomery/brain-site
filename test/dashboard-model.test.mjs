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
