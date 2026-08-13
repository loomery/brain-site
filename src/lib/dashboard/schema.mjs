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
  if (typeof value !== "string") {
    errors.push(`${label} must be a string, got ${describeType(value)}`)
  } else if (value.length === 0) {
    errors.push(`${label} must not be empty`)
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
