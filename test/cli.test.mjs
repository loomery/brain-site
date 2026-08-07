import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const CLI = path.resolve(import.meta.dirname, "../bin/brain-site.mjs")

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
