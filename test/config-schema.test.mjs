import { test } from "node:test"
import assert from "node:assert/strict"
import { validateOverride } from "../src/config/schema.mjs"

test("a minimal override is valid", () => {
  const { ok, errors } = validateOverride({ pageTitle: "Acme Brain", content: "../docs" })
  assert.equal(ok, true)
  assert.deepEqual(errors, [])
})

test("an unknown top-level key is rejected by name", () => {
  const { ok, errors } = validateOverride({ pageTitle: "Acme", theme: { colour: "red" } })
  assert.equal(ok, false)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /theme/)
})

test("an unknown key inside sections.timeline is rejected", () => {
  const { ok, errors } = validateOverride({
    sections: { timeline: { source: "../logs", colour: "red" } },
  })
  assert.equal(ok, false)
  assert.match(errors[0], /colour/)
})

test("extraPlugins is accepted as the declared escape hatch", () => {
  const { ok } = validateOverride({ extraPlugins: "./plugins-local" })
  assert.equal(ok, true)
})

test("pageTitle must be a string", () => {
  const { ok, errors } = validateOverride({ pageTitle: 42 })
  assert.equal(ok, false)
  assert.match(errors[0], /pageTitle/)
})

test("an empty override is valid — every key has a default", () => {
  assert.equal(validateOverride({}).ok, true)
})

test("sections: null is rejected, not thrown", () => {
  const { ok, errors } = validateOverride({ sections: null })
  assert.equal(ok, false)
  assert.match(errors[0], /sections/)
})

test("sections.timeline: null is rejected, not thrown", () => {
  const { ok, errors } = validateOverride({ sections: { timeline: null } })
  assert.equal(ok, false)
  assert.match(errors[0], /sections\.timeline/)
})

test("sections: 5 is rejected rather than silently passing", () => {
  const { ok, errors } = validateOverride({ sections: 5 })
  assert.equal(ok, false)
  assert.match(errors[0], /sections/)
})

test("sections: [] is rejected rather than silently passing", () => {
  const { ok, errors } = validateOverride({ sections: [] })
  assert.equal(ok, false)
  assert.match(errors[0], /sections/)
})

test("static is accepted as a string naming a brain-owned static directory", () => {
  const { ok, errors } = validateOverride({ static: "assets/static" })
  assert.equal(ok, true)
  assert.deepEqual(errors, [])
})

test("static must be a string", () => {
  const { ok, errors } = validateOverride({ static: 42 })
  assert.equal(ok, false)
  assert.match(errors[0], /static/)
})

test("omitting static is valid — it has no required default", () => {
  assert.equal(validateOverride({}).ok, true)
})
