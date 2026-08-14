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
    // Deliberately the default (YAML 1.2 core schema) options, not `version:
    // "1.1"`. 1.2 core does not resolve an unquoted `2026-08-05` to a Date —
    // every date arrives as a plain string — but that's the safer choice: 1.1
    // also reinterprets `012` as octal 10, `yes`/`off` as booleans, and a key
    // literally named `off` as the boolean key `false`. Loud beats silent —
    // under 1.2 a brain that writes `done: yes` gets a clear "must be a
    // boolean" from schema.mjs; under 1.1 it would silently coerce to `true`.
    // normalizeDate's Date branch is defensive for a caller that constructs
    // one directly (the model layer's own tests do this), not because this
    // parser ever produces one.
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
