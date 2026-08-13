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

// yaml@2's default parse uses the YAML 1.2 core schema, which does not resolve
// a timestamp-shaped scalar to a Date — so an unquoted date arrives as a plain
// string, same as a quoted one. normalizeDate's Date branch is defensive for a
// caller that constructs one directly (the model layer's own tests do this),
// not because this parser ever produces one.
test("unquoted and quoted ISO dates both arrive as strings and validate cleanly", () => {
  const dir = tmpDir("load-dates")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "end: 2026-09-14\n")
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(typeof facts.end, "string")
  assert.equal(facts.end, "2026-09-14")
  assert.deepEqual(warnings, [])
})

test("a quoted ISO date is equivalent to an unquoted one", () => {
  const dir = tmpDir("load-dates-quoted")
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), 'end: "2026-09-14"\n')
  const { facts, warnings } = loadDashboardFiles(paths(dir))
  assert.equal(typeof facts.end, "string")
  assert.equal(facts.end, "2026-09-14")
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
