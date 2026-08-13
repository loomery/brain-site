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
  // FACTS yields five dated nodes — the synthetic Start (2026-07-20), the three
  // milestones (08-05, 08-14, 09-07), and the synthetic End (09-14) — hence four
  // adjacent gaps, one segment each. Note Hack Week's `end: 2026-09-11` does not
  // add a node: `timelineNodes` positions a milestone by its `date` only.
  assert.equal(segments.length, 4)
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
