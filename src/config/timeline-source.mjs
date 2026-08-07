import path from "node:path"

// The skin renders the changelog opinionatedly; it does not get to decide where the
// source material lives. Returning null rather than guessing a default is the point —
// the default (../logs) is applied once, in the config merge, so there is exactly one
// place that knows it. See design doc §2.
export function resolveTimelineSource(options, siteDir) {
  const source = options?.source
  if (typeof source !== "string" || source.length === 0) return null
  return path.resolve(siteDir, source)
}
