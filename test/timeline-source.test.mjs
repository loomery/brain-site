import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { resolveTimelineSource } from "../src/config/timeline-source.mjs"

const SITE_DIR = "/tmp/brain/site"

test("a configured source resolves relative to the site directory", () => {
  const resolved = resolveTimelineSource({ source: "../logs" }, SITE_DIR)
  assert.equal(resolved, path.resolve(SITE_DIR, "../logs"))
})

test("a differently-named source directory is honoured", () => {
  const resolved = resolveTimelineSource({ source: "../sessions" }, SITE_DIR)
  assert.equal(resolved, path.resolve(SITE_DIR, "../sessions"))
})

test("no options at all yields null rather than a guessed path", () => {
  assert.equal(resolveTimelineSource(undefined, SITE_DIR), null)
})

test("options without a source yield null", () => {
  assert.equal(resolveTimelineSource({ route: "/logs" }, SITE_DIR), null)
})

test("an absolute source is used as-is", () => {
  assert.equal(resolveTimelineSource({ source: "/var/logs" }, SITE_DIR), "/var/logs")
})
