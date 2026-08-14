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
import { NextModule } from "../assets/plugins/dashboard/next.ts"
import { EffortModule } from "../assets/plugins/dashboard/effort.ts"
import { PeopleModule } from "../assets/plugins/dashboard/people.ts"

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

// --- next, effort, people --------------------------------------------------

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
