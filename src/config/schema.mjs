// Allowlist validation for a brain's brain-site.yaml override.
//
// Deliberately an allowlist rather than a permissive merge: an unrecognised key is
// almost always a typo or a brain quietly forking the skin, and both should be loud.
//
// There is deliberately no brain-local plugin key here. An earlier `extraPlugins` was
// validated and then read by nothing at all, so a brain that set it got exit 0 and no
// plugin. Failing loudly as an unknown key beats accepting-and-discarding; a real
// brain-local plugin hook is tracked as a follow-up.

const TOP_LEVEL = new Set(["pageTitle", "content", "sections", "static"])
const SECTIONS = new Set(["timeline"])
const TIMELINE = new Set(["source", "route"])

function checkStringField(value, name, errors) {
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${name} must be a string, got ${typeof value}`)
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
  checkStringField(config.static, "static", errors)

  const sections = config.sections
  if (sections !== undefined) {
    if (!isPlainObject(sections)) {
      errors.push(`sections must be an object, got ${describeType(sections)}`)
    } else {
      for (const key of Object.keys(sections)) {
        if (!SECTIONS.has(key)) {
          errors.push(`unknown section "${key}" — allowed: ${[...SECTIONS].join(", ")}`)
        }
      }
      const timeline = sections.timeline
      if (timeline !== undefined) {
        if (!isPlainObject(timeline)) {
          errors.push(`sections.timeline must be an object, got ${describeType(timeline)}`)
        } else {
          for (const key of Object.keys(timeline)) {
            if (!TIMELINE.has(key)) {
              errors.push(
                `unknown key "sections.timeline.${key}" — allowed: ${[...TIMELINE].join(", ")}`,
              )
            }
          }
          checkStringField(timeline.source, "sections.timeline.source", errors)
          checkStringField(timeline.route, "sections.timeline.route", errors)
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

function describeType(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}
