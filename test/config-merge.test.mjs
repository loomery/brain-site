import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeConfig } from "../src/config/merge.mjs"

const base = () => ({
  configuration: { pageTitle: "{{PROJECT_NAME}} Brain", baseUrl: "localhost:8080" },
  plugins: [
    { source: "./plugins/logs-timeline-emitter.ts", enabled: true },
    { source: "./plugins/audience-filter.ts", enabled: false },
  ],
})

test("pageTitle from the override wins", () => {
  const merged = mergeConfig(base(), { pageTitle: "Acme Brain" })
  assert.equal(merged.configuration.pageTitle, "Acme Brain")
})

test("unset override keys leave base values untouched", () => {
  const merged = mergeConfig(base(), { pageTitle: "Acme Brain" })
  assert.equal(merged.configuration.baseUrl, "localhost:8080")
})

test("the base object is not mutated", () => {
  const original = base()
  mergeConfig(original, { pageTitle: "Acme Brain" })
  assert.equal(original.configuration.pageTitle, "{{PROJECT_NAME}} Brain")
})

test("omitting sections.timeline disables the timeline plugin", () => {
  const merged = mergeConfig(base(), { pageTitle: "Acme Brain" })
  const timeline = merged.plugins.find((p) => p.source.includes("logs-timeline-emitter"))
  assert.equal(timeline.enabled, false)
})

test("declaring sections.timeline enables it and passes its options through", () => {
  const merged = mergeConfig(base(), {
    sections: { timeline: { source: "../sessions", route: "/changelog" } },
  })
  const timeline = merged.plugins.find((p) => p.source.includes("logs-timeline-emitter"))
  assert.equal(timeline.enabled, true)
  assert.deepEqual(timeline.options, { source: "../sessions", route: "/changelog" })
})

test("timeline source and route fall back to their defaults", () => {
  const merged = mergeConfig(base(), { sections: { timeline: {} } })
  const timeline = merged.plugins.find((p) => p.source.includes("logs-timeline-emitter"))
  assert.deepEqual(timeline.options, { source: "../logs", route: "/logs" })
})
