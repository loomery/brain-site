// Allowlist validation for a brain's brain-site.yaml override.
//
// Deliberately an allowlist rather than a permissive merge: an unrecognised key is
// almost always a typo or a brain quietly forking the skin, and both should be loud.
// `extraPlugins` is the one declared escape hatch — see design doc §2.2.

const TOP_LEVEL = new Set(["pageTitle", "content", "sections", "extraPlugins"])
const SECTIONS = new Set(["timeline"])
const TIMELINE = new Set(["source", "route"])

function checkStringField(value, name, errors) {
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${name} must be a string, got ${typeof value}`)
  }
}

export function validateOverride(override) {
  const errors = []
  const config = override ?? {}

  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL.has(key)) {
      errors.push(`unknown key "${key}" — allowed: ${[...TOP_LEVEL].join(", ")}`)
    }
  }

  checkStringField(config.pageTitle, "pageTitle", errors)
  checkStringField(config.content, "content", errors)
  checkStringField(config.extraPlugins, "extraPlugins", errors)

  const sections = config.sections
  if (sections !== undefined) {
    for (const key of Object.keys(sections)) {
      if (!SECTIONS.has(key)) {
        errors.push(`unknown section "${key}" — allowed: ${[...SECTIONS].join(", ")}`)
      }
    }
    const timeline = sections.timeline
    if (timeline !== undefined) {
      for (const key of Object.keys(timeline)) {
        if (!TIMELINE.has(key)) {
          errors.push(`unknown key "sections.timeline.${key}"`)
        }
      }
      checkStringField(timeline.source, "sections.timeline.source", errors)
      checkStringField(timeline.route, "sections.timeline.route", errors)
    }
  }

  return { ok: errors.length === 0, errors }
}
