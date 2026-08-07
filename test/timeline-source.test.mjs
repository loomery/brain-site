import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { resolveTimelineSource } from "../src/config/timeline-source.mjs"

const BASE_DIR = "/tmp/brain/.brain-site"

test("a configured source resolves relative to the base directory", () => {
  const resolved = resolveTimelineSource({ source: "../logs" }, BASE_DIR)
  assert.equal(resolved, path.resolve(BASE_DIR, "../logs"))
})

test("a differently-named source directory is honoured", () => {
  const resolved = resolveTimelineSource({ source: "../sessions" }, BASE_DIR)
  assert.equal(resolved, path.resolve(BASE_DIR, "../sessions"))
})

test("no options at all yields null rather than a guessed path", () => {
  assert.equal(resolveTimelineSource(undefined, BASE_DIR), null)
})

test("options without a source yield null", () => {
  assert.equal(resolveTimelineSource({ route: "/logs" }, BASE_DIR), null)
})

test("an absolute source is used as-is", () => {
  assert.equal(resolveTimelineSource({ source: "/var/logs" }, BASE_DIR), "/var/logs")
})
