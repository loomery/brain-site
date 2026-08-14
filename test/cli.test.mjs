import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { runValidate } from "../src/commands/validate.mjs"

const CLI = path.resolve(import.meta.dirname, "../bin/brain-site.mjs")

function tmpDir(prefix) {
  // realpath: on macOS os.tmpdir() is a /var -> /private/var symlink, and some
  // comparisons need the resolved form too.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

function run(args, opts = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { encoding: "utf8", ...opts })
    return { code: 0, stdout }
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" }
  }
}

test("an unknown command exits non-zero and names the command", () => {
  const { code, stderr } = run(["frobnicate"])
  assert.notEqual(code, 0)
  assert.match(stderr, /frobnicate/)
})

test("validate passes on a docs tree with valid frontmatter", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-ok-"))
  fs.writeFileSync(path.join(dir, "a.md"), "---\naudience: [internal]\n---\n# A\n")
  const { code, stdout } = run(["validate", "--docs", dir])
  assert.equal(code, 0)
  assert.match(stdout, /1 docs validated/)
})

test("validate fails on a doc missing audience, naming the slug", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-bad-"))
  fs.writeFileSync(path.join(dir, "b.md"), "---\ntitle: B\n---\n# B\n")
  const { code, stderr } = run(["validate", "--docs", dir])
  assert.equal(code, 1)
  assert.match(stderr, /b: missing or malformed `audience`/)
})

test("--docs with no following value exits non-zero and names the flag", () => {
  const { code, stderr } = run(["validate", "--docs"])
  assert.notEqual(code, 0)
  assert.match(stderr, /--docs/)
})

test("--docs followed by another flag exits non-zero and names the flag", () => {
  const { code, stderr } = run(["validate", "--docs", "--foo"])
  assert.notEqual(code, 0)
  assert.match(stderr, /--docs/)
})

test("validate takes its docs root from brain-site.yaml's content: key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-content-"))
  fs.writeFileSync(path.join(dir, "brain-site.yaml"), "pageTitle: Acme\ncontent: notes\n")
  fs.mkdirSync(path.join(dir, "notes"))
  fs.writeFileSync(path.join(dir, "notes", "a.md"), "---\naudience: [internal]\n---\n# A\n")
  const { code, stdout } = run(["validate"], { cwd: dir })
  assert.equal(code, 0)
  assert.match(stdout, /1 docs validated/)
})

test("--docs still overrides brain-site.yaml's content:", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-override-"))
  fs.writeFileSync(path.join(dir, "brain-site.yaml"), "content: notes\n")
  fs.mkdirSync(path.join(dir, "notes"))
  fs.writeFileSync(path.join(dir, "notes", "a.md"), "---\ntitle: no audience\n---\n")
  const other = path.join(dir, "elsewhere")
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, "b.md"), "---\naudience: [internal]\n---\n# B\n")
  const { code, stdout } = run(["validate", "--docs", other], { cwd: dir })
  assert.equal(code, 0)
  assert.match(stdout, /1 docs validated/)
})

test("with no brain-site.yaml, validate falls back to docs/ and says so when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-fallback-"))
  const { code, stderr } = run(["validate"], { cwd: dir })
  assert.equal(code, 1)
  assert.match(stderr, /docs directory not found/)
  assert.match(stderr, /fell back to "docs"/)
})

// --- dashboard file validation ---------------------------------------------

test("validate reports an unknown key in dashboard.yaml and exits non-zero", () => {
  const dir = tmpDir("validate-dash-bad")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "mileStones: []\n")
  const errors = []
  const originalError = console.error
  console.error = (msg) => errors.push(String(msg))
  let code
  try {
    code = runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir })
  } finally {
    console.error = originalError
  }
  assert.equal(code, 1)
  assert.equal(errors.some((e) => e.includes('unknown key "mileStones"')), true)
  assert.equal(errors.some((e) => e.includes("dashboard.yaml")), true)
})

test("validate reports a status person missing from the roster", () => {
  const dir = tmpDir("validate-dash-roster")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "people:\n  - name: Milly Allatson\n")
  fs.writeFileSync(path.join(dir, "dashboard.status.yaml"), "people:\n  - name: Ghost\n")
  const errors = []
  const originalError = console.error
  console.error = (msg) => errors.push(String(msg))
  let code
  try {
    code = runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir })
  } finally {
    console.error = originalError
  }
  assert.equal(code, 1)
  assert.equal(errors.some((e) => e.includes("people roster")), true)
})

test("validate passes when both dashboard files are valid", () => {
  const dir = tmpDir("validate-dash-good")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "project: Acme\nend: 2026-09-14\n")
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir }), 0)
})

test("validate passes when neither dashboard file exists", () => {
  const dir = tmpDir("validate-dash-absent")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs"), rootDir: dir }), 0)
})

test("omitting rootDir skips dashboard validation entirely", () => {
  const dir = tmpDir("validate-dash-skipped")
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true })
  fs.writeFileSync(path.join(dir, "dashboard.yaml"), "mileStones: []\n")
  assert.equal(runValidate({ docsRoot: path.join(dir, "docs") }), 0)
})
