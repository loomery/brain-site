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

// Falls back to facts.start/facts.end for the bar's bounds; when either is
// absent, falls back further to the earliest/latest *real* milestone date (not
// a synthetic bound — a bound with nothing to anchor it isn't itself a
// milestone worth drawing a bar around). `realMilestones` is passed in rather
// than re-derived so the null-vs-plain decision stays centralised in
// buildTimeline.
function plainTimeline(facts, today, realMilestones) {
  const milestoneDates = realMilestones
    .map((m) => normalizeDate(m?.date))
    .filter((d) => d !== null)
    .sort()
  const start = normalizeDate(facts?.start) ?? milestoneDates[0] ?? null
  const end = normalizeDate(facts?.end) ?? milestoneDates.at(-1) ?? null
  if (start === null || end === null) return null
  const total = Math.max(0, daysBetween(start, end) ?? 0)
  const elapsed = Math.min(Math.max(0, daysBetween(start, today) ?? 0), total)
  // A zero-width span (e.g. every milestone collapsed onto a single date) has
  // no "of N days" to report, but is still a valid, fully-elapsed bar rather
  // than nothing to draw — avoids dividing by zero in progressPct.
  if (total === 0) {
    return { mode: "plain", progressPct: 100, todayLabel: "day 1 of 1" }
  }
  return {
    mode: "plain",
    progressPct: Math.round((elapsed / total) * 1000) / 10,
    // 1-indexed to match the fisheye current segment's "day N of N" label
    // below — day 0 of N would read as "hasn't started" even on day one.
    todayLabel: `day ${Math.min(elapsed + 1, total)} of ${total}`,
  }
}

export function buildTimeline(facts, today) {
  const realMilestones = asArray(facts?.milestones).filter(
    (m) => normalizeDate(m?.date) !== null && typeof m?.name === "string",
  )
  const rawNodes = timelineNodes(facts)

  // Magnification needs at least two distinct nodes to define a gap, and it is
  // meaningless with fewer than two real milestones — there is no "previous"
  // and "next" beat to sit between. Both fall back to a plain bar.
  if (rawNodes.length < 2 || realMilestones.length < 2) {
    return plainTimeline(facts, today, realMilestones)
  }

  // A synthetic bound (Start/End) is "reached" once its date has arrived —
  // there is no author to mark it done, so passing its date is the only signal
  // available. A real milestone's `done` is left exactly as authored: whether
  // its date has passed is a *different* question, already answered by
  // computeCounters' `behind` count, and conflating the two would let this
  // node render filled-in (done) while the counters above it report the same
  // milestone as behind — the exact cross-derivation contradiction this
  // module exists to prevent.
  const nodes = rawNodes.map((node) => ({
    ...node,
    done: node.synthetic ? (daysBetween(node.date, today) ?? -1) >= 0 : node.done,
  }))

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
                // Clamp *after* adding one, not before: clamping first and then
                // adding one lets an overrun (elapsedInGap >= gap.days, the case
                // where currentIndex falls back to the last gap) read as
                // "day gap.days + 1 of gap.days" — N exceeding M, the same bug
                // already guarded against in plainTimeline's label below.
                : `day ${Math.min(Math.max(elapsedInGap, 0) + 1, gap.days)} of ${gap.days}`,
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

export function buildModel({ facts, status, pageTitle, pages, activity, onboarding, today }) {
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
    clientLogo: typeof facts?.clientLogo === "string" ? facts.clientLogo : null,
    generatedAt: normalizeDate(status?.generatedAt),
    today,
    rag,
    countdown: computeCountdown(facts, today),
    timeline: buildTimeline(facts, today),
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
    onboarding: onboarding ?? [],
    pages: pages ?? [],
  }
}
