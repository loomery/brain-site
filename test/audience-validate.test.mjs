import { test } from "node:test"
import assert from "node:assert/strict"
import { shouldPublish, validateDocs } from "../src/lib/audience/validate.mjs"

test("publishes when the audience is declared", () => {
  assert.equal(shouldPublish({ audience: ["internal", "client"] }, "internal"), true)
})
test("does not publish when the audience is not declared", () => {
  assert.equal(shouldPublish({ audience: ["internal"] }, "client"), false)
})
test("fails closed on missing frontmatter", () => {
  assert.equal(shouldPublish(undefined, "internal"), false)
  assert.equal(shouldPublish(null, "internal"), false)
  assert.equal(shouldPublish({}, "internal"), false)
})
test("fails closed when audience is a string rather than an array", () => {
  assert.equal(shouldPublish({ audience: "internal" }, "internal"), false)
})
test("fails closed on an unknown audience value", () => {
  assert.equal(shouldPublish({ audience: ["everyone"] }, "everyone"), false)
})
test("a valid doc set passes validation", () => {
  const docs = [
    { slug: "a", frontmatter: { audience: ["internal"], status: "current" } },
    { slug: "b", frontmatter: { audience: ["internal", "client"], status: "current",
        roles: ["engineering"], onboarding: { prerequisites: ["a"] } } },
  ]
  assert.deepEqual(validateDocs(docs), { ok: true, errors: [] })
})
test("a missing audience is an error", () => {
  const r = validateDocs([{ slug: "a", frontmatter: { status: "current" } }])
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /audience/)
})
test("a misspelled audience key is caught", () => {
  assert.equal(validateDocs([{ slug: "a", frontmatter: { audiance: ["internal"] } }]).ok, false)
})
test("an unknown role is an error", () => {
  const r = validateDocs([{ slug: "a", frontmatter: { audience: ["internal"], roles: ["marketing"] } }])
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /role/)
})
test("an unknown status is an error", () => {
  const r = validateDocs([{ slug: "a", frontmatter: { audience: ["internal"], status: "wip" } }])
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /status/)
})
test("a prerequisite pointing at an unknown slug is an error", () => {
  const r = validateDocs([{ slug: "a", frontmatter: { audience: ["internal"], onboarding: { prerequisites: ["ghost"] } } }])
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /ghost/)
})
test("every failing doc is reported, not just the first", () => {
  assert.equal(validateDocs([{ slug: "a", frontmatter: {} }, { slug: "b", frontmatter: {} }]).errors.length, 2)
})
