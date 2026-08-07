import { test } from "node:test"
import assert from "node:assert/strict"
import { buildRolePath, listRoles, detectCycles } from "../src/lib/onboarding/paths.mjs"

const doc = (slug, roles, prerequisites = [], order = undefined) => ({
  slug, title: slug, roles,
  onboarding: { order, prerequisites, summary: `about ${slug}`, estimate: "5m" },
})

test("empty input yields empty path", () => {
  assert.deepEqual(buildRolePath([], "engineering"), [])
})
test("docs without an onboarding block are excluded", () => {
  assert.deepEqual(buildRolePath([{ slug: "ref", title: "ref", roles: ["engineering"] }], "engineering"), [])
})
test("docs not in the role are excluded", () => {
  assert.deepEqual(buildRolePath([doc("a", ["product"])], "engineering"), [])
})
test("a prerequisite comes before its dependent", () => {
  const docs = [doc("b", ["engineering"], ["a"]), doc("a", ["engineering"])]
  const path = buildRolePath(docs, "engineering")
  assert.deepEqual(path.map((n) => n.slug), ["a", "b"])
  assert.deepEqual(path.map((n) => n.depth), [0, 1])
})
test("out-of-role prerequisites are pulled in as context nodes", () => {
  const docs = [doc("b", ["engineering"], ["a"]), doc("a", ["product"])]
  const path = buildRolePath(docs, "engineering")
  assert.deepEqual(path.map((n) => n.slug), ["a", "b"])
  assert.equal(path[0].isContext, true)
  assert.equal(path[1].isContext, false)
})
test("order breaks ties within the same depth", () => {
  const docs = [doc("z", ["engineering"], [], 1), doc("a", ["engineering"], [], 2)]
  assert.deepEqual(buildRolePath(docs, "engineering").map((n) => n.slug), ["z", "a"])
})
test("title breaks ties when order is absent", () => {
  const docs = [doc("z", ["engineering"]), doc("a", ["engineering"])]
  assert.deepEqual(buildRolePath(docs, "engineering").map((n) => n.slug), ["a", "z"])
})
test("a diamond dependency gets correct depths", () => {
  const docs = [doc("a", ["engineering"]), doc("b", ["engineering"], ["a"]),
    doc("c", ["engineering"], ["a"]), doc("d", ["engineering"], ["b", "c"])]
  const path = buildRolePath(docs, "engineering")
  assert.equal(path[0].slug, "a")
  assert.equal(path.at(-1).slug, "d")
  assert.equal(path.find((n) => n.slug === "d").depth, 2)
})
test("a missing prerequisite is ignored rather than crashing", () => {
  assert.deepEqual(buildRolePath([doc("a", ["engineering"], ["nope"])], "engineering").map((n) => n.slug), ["a"])
})
test("detectCycles finds a two-node cycle", () => {
  assert.equal(detectCycles([doc("a", ["engineering"], ["b"]), doc("b", ["engineering"], ["a"])]).length > 0, true)
})
test("detectCycles returns empty for a clean graph", () => {
  assert.deepEqual(detectCycles([doc("a", ["engineering"]), doc("b", ["engineering"], ["a"])]), [])
})
test("buildRolePath throws on a cycle", () => {
  assert.throws(() => buildRolePath([doc("a", ["engineering"], ["b"]), doc("b", ["engineering"], ["a"])], "engineering"), /cycle detected:/)
})
test("listRoles returns sorted unique roles", () => {
  assert.deepEqual(listRoles([doc("a", ["product", "engineering"]), doc("b", ["engineering"])]), ["engineering", "product"])
})
