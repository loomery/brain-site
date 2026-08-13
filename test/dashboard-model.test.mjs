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
  // TL_FACTS has 4 real milestones plus start/end bounds: 6 distinct dated
  // nodes, so 5 adjacent gaps — one past (start -> Kickoff), one current
  // (Kickoff -> Survey due, which contains today), and three future.
  assert.deepEqual(kinds, ["past", "current", "future", "future", "future"])
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
  // The label's day count must never exceed the gap's day count — clamping
  // must happen after adding one, not before, or an overrun like this reads
  // as "day 8 of 7".
  assert.equal(current.today.label, "day 7 of 7")
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

test("an undone but overdue milestone's node stays done: false, matching computeCounters' behind count", () => {
  // Survey due (08-14) and Training lands (08-17) have both passed by
  // 2026-08-20 without being marked done. computeCounters correctly counts
  // them as behind; the timeline node must agree they are not done, or the
  // page would draw them filled-in (done) while its own counters call them
  // behind.
  const counters = computeCounters(TL_FACTS, null, "2026-08-20")
  assert.equal(counters.done, 1)
  assert.equal(counters.behind, 2)

  const tl = buildTimeline(TL_FACTS, "2026-08-20")
  const nodesByName = new Map(tl.segments.map((s) => [s.startNode.name, s.startNode]))
  assert.equal(nodesByName.get("Survey due").done, false)
  assert.equal(nodesByName.get("Training lands").done, false)
  // Kickoff is authored done: true and stays done regardless of date.
  assert.equal(nodesByName.get("Kickoff").done, true)
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
