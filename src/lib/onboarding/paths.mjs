const prereqsOf = (d) => d.onboarding?.prerequisites ?? []

function subgraph(docs, role) {
  const bySlug = new Map(docs.map((d) => [d.slug, d]))
  const chosen = new Map()
  const visit = (slug, isContext) => {
    const d = bySlug.get(slug)
    if (!d || !d.onboarding) return
    const seen = chosen.get(slug)
    if (seen) {
      if (!isContext) seen.isContext = false
      return
    }
    const entry = { doc: d, isContext }
    chosen.set(slug, entry)
    for (const p of prereqsOf(d)) visit(p, true)
  }
  for (const d of docs) {
    if (d.onboarding && (d.roles ?? []).includes(role)) visit(d.slug, false)
  }
  return chosen
}

export function detectCycles(docs) {
  const bySlug = new Map(docs.map((d) => [d.slug, d]))
  const cycles = []
  const state = new Map()
  const stack = []
  const walk = (slug) => {
    if (!bySlug.has(slug)) return
    if (state.get(slug) === "done") return
    if (state.get(slug) === "open") {
      cycles.push(stack.slice(stack.indexOf(slug)))
      return
    }
    state.set(slug, "open")
    stack.push(slug)
    for (const p of prereqsOf(bySlug.get(slug))) walk(p)
    stack.pop()
    state.set(slug, "done")
  }
  for (const d of docs) walk(d.slug)
  return cycles
}

export function buildRolePath(docs, role) {
  const cycles = detectCycles(docs)
  if (cycles.length) {
    throw new Error(`cycle detected: ${cycles.map((c) => c.join(" -> ")).join("; ")}`)
  }
  const chosen = subgraph(docs, role)
  const depthOf = new Map()
  const depth = (slug) => {
    if (depthOf.has(slug)) return depthOf.get(slug)
    const entry = chosen.get(slug)
    const parents = entry ? prereqsOf(entry.doc).filter((p) => chosen.has(p)) : []
    const d = parents.length ? Math.max(...parents.map(depth)) + 1 : 0
    depthOf.set(slug, d)
    return d
  }
  return [...chosen.values()]
    .map(({ doc: d, isContext }) => ({
      slug: d.slug,
      title: d.title,
      summary: d.onboarding?.summary ?? "",
      estimate: d.onboarding?.estimate ?? null,
      depth: depth(d.slug),
      isContext,
      prerequisites: prereqsOf(d).filter((p) => chosen.has(p)),
    }))
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        (chosen.get(a.slug).doc.onboarding?.order ?? Infinity) -
          (chosen.get(b.slug).doc.onboarding?.order ?? Infinity) ||
        a.title.localeCompare(b.title),
    )
}

export function listRoles(docs) {
  return [...new Set(docs.flatMap((d) => d.roles ?? []))].sort()
}
