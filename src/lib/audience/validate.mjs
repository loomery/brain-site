export const VALID_AUDIENCES = ["internal", "client"]
export const VALID_ROLES = ["engineering", "product", "design", "delivery"]
export const VALID_STATUSES = ["current", "stale", "draft"]

export function shouldPublish(frontmatter, audience) {
  const declared = frontmatter?.audience
  if (!Array.isArray(declared)) return false
  if (!declared.every((a) => VALID_AUDIENCES.includes(a))) return false
  return declared.includes(audience)
}

export function validateDocs(docs) {
  const known = new Set(docs.map((d) => d.slug))
  const errors = []
  const fail = (slug, message) => errors.push({ slug, message })

  for (const { slug, frontmatter: fm = {} } of docs) {
    if (!Array.isArray(fm.audience)) {
      fail(slug, "missing or malformed `audience` — must be an array")
    } else {
      for (const a of fm.audience) {
        if (!VALID_AUDIENCES.includes(a)) fail(slug, `unknown audience "${a}"`)
      }
    }
    if (fm.status !== undefined && !VALID_STATUSES.includes(fm.status)) {
      fail(slug, `unknown status "${fm.status}"`)
    }
    for (const r of fm.roles ?? []) {
      if (!VALID_ROLES.includes(r)) fail(slug, `unknown role "${r}"`)
    }
    for (const p of fm.onboarding?.prerequisites ?? []) {
      if (!known.has(p)) fail(slug, `prerequisite "${p}" does not resolve to a known doc`)
    }
  }
  return { ok: errors.length === 0, errors }
}
