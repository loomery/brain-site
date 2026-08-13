// Merges the shipped base Quartz config with a brain's override, producing the
// effective config that setup writes to .brain-site/quartz.config.yaml.
//
// Written to a real file rather than merged in memory so the effective config stays
// readable and diffable when a page renders wrong — see design doc §2.5.

import path from "node:path"

const TIMELINE_PLUGIN = "logs-timeline-emitter"
const DASHBOARD_PLUGIN = "dashboard-emitter"
// The single source of truth for the timeline defaults. `source` is brain-root-relative
// ("logs"), matching what setup resolves against rootDir — an earlier "../logs" here was
// a relic of the old site/ layout and disagreed with setup.mjs.
export const TIMELINE_DEFAULTS = { source: "logs", route: "/logs" }

// The two dashboard filenames are a convention this package owns — a brain does
// not get to rename them, which is why there is no brain-site.yaml key for
// either. Their *location* is the brain's, and arrives as rootDir.
export const DASHBOARD_FACTS_FILE = "dashboard.yaml"
export const DASHBOARD_STATUS_FILE = "dashboard.status.yaml"

function clone(value) {
  return structuredClone(value)
}

// Every path handed to the emitter is already absolute: `content` and
// `sections.timeline.source` were resolved by setup's resolveOverridePaths,
// and the two dashboard files are resolved here against rootDir. Nothing
// downstream has to know what directory the build is running from.
function applyDashboardOptions(merged, config, rootDir) {
  const options = { pageTitle: merged.configuration.pageTitle }

  if (typeof rootDir === "string" && rootDir.length > 0) {
    options.rootDir = rootDir
    options.facts = path.join(rootDir, DASHBOARD_FACTS_FILE)
    options.status = path.join(rootDir, DASHBOARD_STATUS_FILE)
  }
  if (typeof config.content === "string" && config.content.length > 0) {
    options.contentDir = config.content
  }
  const timelineSource = config.sections?.timeline?.source
  if (typeof timelineSource === "string" && timelineSource.length > 0) {
    options.logsDir = timelineSource
  }

  for (const plugin of merged.plugins) {
    if (plugin.source.includes(DASHBOARD_PLUGIN)) {
      plugin.enabled = true
      plugin.options = options
    }
  }
}

export function mergeConfig(base, override, rootDir) {
  const merged = clone(base)
  const config = override ?? {}

  if (config.pageTitle !== undefined) {
    merged.configuration.pageTitle = config.pageTitle
  }

  const timeline = config.sections?.timeline
  for (const plugin of merged.plugins) {
    if (!plugin.source.includes(TIMELINE_PLUGIN)) continue
    if (timeline === undefined) {
      plugin.enabled = false
      continue
    }
    plugin.enabled = true
    plugin.options = { ...TIMELINE_DEFAULTS, ...timeline }
  }

  // After the pageTitle assignment, so the dashboard's heading fallback gets the
  // brain's own title rather than the base config's.
  applyDashboardOptions(merged, config, rootDir)

  return merged
}
