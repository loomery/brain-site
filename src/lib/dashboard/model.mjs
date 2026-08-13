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
