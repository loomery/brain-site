import path from "node:path"

// The skin renders the changelog opinionatedly; it does not get to decide where the
// source material lives. Returning null rather than guessing a default is the point —
// the default ("logs", a sibling of the tracked brain-site.yaml at the repository
// root) is applied once, by setup's resolveOverridePaths, so there is exactly one
// place that knows it. By the time options reaches here in the real pipeline, `source`
// is already an absolute path (see the "absolute source is used as-is" case below) —
// `baseDir` only matters for a caller that hands this a still-relative source, which
// setup.mjs's own pipeline never does. See design doc §2.
export function resolveTimelineSource(options, baseDir) {
  const source = options?.source
  if (typeof source !== "string" || source.length === 0) return null
  return path.resolve(baseDir, source)
}
