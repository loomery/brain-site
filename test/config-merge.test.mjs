import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"
import { mergeConfig, TIMELINE_DEFAULTS } from "../src/config/merge.mjs"

const BASE_PATH = fileURLToPath(new URL("../assets/quartz.config.base.yaml", import.meta.url))

function baseFixture() {
  return YAML.parse(fs.readFileSync(BASE_PATH, "utf8"))
}

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

// The default source is brain-root-relative ("logs"), the same value setup.mjs resolves
// against the brain root — there is exactly one copy of these defaults, exported from
// merge.mjs and imported by setup.mjs.
test("timeline source and route fall back to their defaults", () => {
  const merged = mergeConfig(base(), { sections: { timeline: {} } })
  const timeline = merged.plugins.find((p) => p.source.includes("logs-timeline-emitter"))
  assert.deepEqual(timeline.options, { source: "logs", route: "/logs" })
})

test("the exported timeline defaults are the single source of truth", () => {
  assert.deepEqual(TIMELINE_DEFAULTS, { source: "logs", route: "/logs" })
})

// ---------------------------------------------------------------------------
// Dashboard emitter options
//
// The package may know a brain's *conventions* but never its *paths*, so the two
// dashboard filenames are fixed here while their location comes from rootDir —
// the same division resolveOverridePaths already applies to content and the
// timeline source.

function dashboardOptionsOf(merged) {
  return merged.plugins.find((p) => p.source.includes("dashboard-emitter")).options
}

test("the dashboard emitter is enabled and given absolute paths for both files", () => {
  const merged = mergeConfig(baseFixture(), { content: "/brains/acme/docs" }, "/brains/acme")
  const plugin = merged.plugins.find((p) => p.source.includes("dashboard-emitter"))
  assert.equal(plugin.enabled, true)
  assert.equal(plugin.options.facts, path.join("/brains/acme", "dashboard.yaml"))
  assert.equal(plugin.options.status, path.join("/brains/acme", "dashboard.status.yaml"))
  assert.equal(plugin.options.rootDir, "/brains/acme")
  assert.equal(plugin.options.contentDir, "/brains/acme/docs")
})

test("the dashboard emitter receives the effective pageTitle for its heading fallback", () => {
  const merged = mergeConfig(baseFixture(), { pageTitle: "Acme Brain" }, "/brains/acme")
  assert.equal(dashboardOptionsOf(merged).pageTitle, "Acme Brain")
})

test("logsDir is passed only when a timeline section is configured", () => {
  const withTimeline = mergeConfig(
    baseFixture(),
    { sections: { timeline: { source: "/brains/acme/logs" } } },
    "/brains/acme",
  )
  assert.equal(dashboardOptionsOf(withTimeline).logsDir, "/brains/acme/logs")

  const without = mergeConfig(baseFixture(), {}, "/brains/acme")
  assert.equal(dashboardOptionsOf(without).logsDir, undefined)
})

test("omitting rootDir still yields a valid config, with no file paths", () => {
  const merged = mergeConfig(baseFixture(), { pageTitle: "Acme Brain" })
  const options = dashboardOptionsOf(merged)
  assert.equal(options.facts, undefined)
  assert.equal(options.status, undefined)
  assert.equal(options.pageTitle, "Acme Brain")
})

test("no plugin entry references the retired home-emitter", () => {
  const merged = mergeConfig(baseFixture(), {}, "/brains/acme")
  assert.equal(merged.plugins.some((p) => p.source.includes("home-emitter")), false)
})
