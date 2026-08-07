// Merges the shipped base Quartz config with a brain's override, producing the
// effective config that setup writes to .brain-site/quartz.config.yaml.
//
// Written to a real file rather than merged in memory so the effective config stays
// readable and diffable when a page renders wrong — see design doc §2.5.

const TIMELINE_PLUGIN = "logs-timeline-emitter"
const TIMELINE_DEFAULTS = { source: "../logs", route: "/logs" }

function clone(value) {
  return structuredClone(value)
}

export function mergeConfig(base, override) {
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

  return merged
}
