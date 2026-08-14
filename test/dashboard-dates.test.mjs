// Coverage for src/lib/dashboard/dates.mjs. The reason this module exists at all:
// `yaml` parses an unquoted `2026-08-05` into a JS Date, so every date field in
// dashboard.yaml arrives as either a Date or a string depending on how the author
// quoted it — and a build running in BST must not shift either one by a day.

import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeDate, toUtcDay, daysBetween } from "../src/lib/dashboard/dates.mjs"

test("normalizeDate accepts a YYYY-MM-DD string", () => {
  assert.equal(normalizeDate("2026-08-05"), "2026-08-05")
})

test("normalizeDate accepts a Date, as yaml produces for an unquoted ISO date", () => {
  assert.equal(normalizeDate(new Date(Date.UTC(2026, 7, 5))), "2026-08-05")
})

test("normalizeDate returns null for junk rather than throwing", () => {
  assert.equal(normalizeDate("not a date"), null)
  assert.equal(normalizeDate(undefined), null)
  assert.equal(normalizeDate(""), null)
  assert.equal(normalizeDate("2026-13-45"), null)
})

test("toUtcDay is timezone-stable for a string and its Date equivalent", () => {
  assert.equal(toUtcDay("2026-08-05"), toUtcDay(new Date(Date.UTC(2026, 7, 5))))
})

test("toUtcDay ignores a time component, keeping the calendar day", () => {
  assert.equal(toUtcDay("2026-08-05"), toUtcDay(new Date("2026-08-05T23:30:00Z")))
})

test("daysBetween counts whole days forward", () => {
  assert.equal(daysBetween("2026-08-05", "2026-08-14"), 9)
})

test("daysBetween is negative when the second date precedes the first", () => {
  assert.equal(daysBetween("2026-08-14", "2026-08-05"), -9)
})

test("daysBetween is zero for the same day", () => {
  assert.equal(daysBetween("2026-08-05", "2026-08-05"), 0)
})

test("daysBetween returns null when either side is unparseable", () => {
  assert.equal(daysBetween("nope", "2026-08-05"), null)
  assert.equal(daysBetween("2026-08-05", undefined), null)
})
