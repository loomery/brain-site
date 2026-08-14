// Date handling for the dashboard's two YAML files.
//
// Two things force this to exist rather than using Date directly:
//
//   1. `yaml` resolves an unquoted `2026-08-05` to a JS Date, but a quoted
//      `"2026-08-05"` to a string. Both are legal in a hand-written
//      dashboard.yaml, so every date field is Date | string.
//   2. `new Date("2026-08-05")` is parsed as UTC midnight, but
//      `new Date(2026, 7, 5)` and every getMonth()/getDate() reader are
//      *local*. Mixing them shifts a calendar day for any build west of UTC
//      or during BST — which for a countdown means an off-by-one day left.
//
// So: everything is normalized to a UTC-midnight millisecond value, and all
// arithmetic happens there. Nothing in this module knows what a milestone is.

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function pad(n) {
  return String(n).padStart(2, "0")
}

export function normalizeDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
  }
  if (typeof value !== "string") return null
  const match = ISO_DAY.exec(value.trim())
  if (!match) return null
  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const ms = Date.UTC(year, month - 1, day)
  const round = new Date(ms)
  // Rejects 2026-13-45 and 2026-02-30, which Date.UTC would silently roll over.
  if (
    round.getUTCFullYear() !== year ||
    round.getUTCMonth() !== month - 1 ||
    round.getUTCDate() !== day
  ) {
    return null
  }
  return `${y}-${m}-${d}`
}

export function toUtcDay(value) {
  const iso = normalizeDate(value)
  if (iso === null) return null
  const [y, m, d] = iso.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysBetween(a, b) {
  const from = toUtcDay(a)
  const to = toUtcDay(b)
  if (from === null || to === null) return null
  return Math.round((to - from) / MS_PER_DAY)
}
