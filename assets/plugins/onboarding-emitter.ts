// Onboarding emitter.
//
// Emits `/onboarding` (an index of roles) and `/onboarding/<role>` (one page per
// role: a role switcher, a Mermaid flowchart of that role's onboarding path, and
// an ordered markdown-style link list — mandatory, not decorative: it's the
// fallback if `click` is inert, and the keyboard/screen-reader-accessible path,
// since Mermaid nodes are not focusable controls).
//
// The path-building logic (topological sort, depth, cycle detection) lives in
// brain-plugins/onboarding/paths.mjs and is consumed here, never reimplemented.
//
// --- Why this writes HTML by hand instead of reusing Quartz's own renderPage ---
//
// The obvious design is "generate a markdown string with a ```mermaid fence and
// let Quartz's normal pipeline render it." That pipeline only runs over files
// parsed from the content directory at the start of a build, though, so reusing
// it from an emitter means importing Quartz's own internal modules
// (createMdProcessor/createHtmlProcessor, renderPage, the `write` helper, etc.)
// from site/quartz/**.
//
// That does not work here. This plugin is a *local* source in quartz.config.yaml
// (`./plugins/onboarding-emitter.ts`), and Quartz only symlinks local plugins —
// it never runs them through esbuild. They're loaded with a genuine runtime
// `import()`, on Node's own ESM resolver. Verified directly:
//
//   node -e "import('./plugins/onboarding-emitter.ts')"                  // works
//   node -e "import('../quartz/plugins/emitters/helpers.ts')"            // fails
//
// Every quartz/** source file uses extension-less relative imports
// (`from "../../util/path"`), which is fine when esbuild bundles the real build
// entrypoint (quartz/build.ts) — esbuild resolves them — but Node's native
// TypeScript support (which is all a symlinked local plugin gets) requires an
// explicit extension on every relative specifier. Importing any site/quartz/**
// module transitively drags in that whole extension-less graph and fails. This
// is not a workaround for a bug on our side; it is really not reachable from a
// local plugin file as shipped, and quartz/** (the vendored Quartz engine) is
// out of this file's ownership.
//
// So instead this plugin builds final HTML directly, using only:
//   - Node builtins (fs, path)
//   - @quartz-community/types (type-only — erased, so its own unresolvable
//     internal imports never execute)
//   - brain-plugins/onboarding/paths.mjs (zero-dependency, plain .mjs)
//   - the *data* Quartz already hands to any emitter: `ctx.hashedResourceNames`
//     (the real, possibly content-hashed index.css/prescript.js/postscript.js
//     filenames) and the `resources: StaticResources` argument (the aggregated
//     CSS/JS every transformer/component registered — this is where the
//     Obsidian-flavored-markdown plugin's Mermaid client script already lives,
//     confirmed by reading its externalResources() in
//     node_modules/@quartz-community/obsidian-flavored-markdown/dist/index.js —
//     it is registered unconditionally whenever `mermaid: true`, not
//     per-page, so it's already present in every emitter's `resources` arg).
//
// The Mermaid code block itself is written directly as the exact HAST shape
// Quartz's own OFM plugin produces for a ```mermaid fence
// (`<pre><code class="mermaid">...</code></pre>`, confirmed by reading that
// plugin's rehype transform) — Mermaid's own client script (bundled via
// `resources`) finds it and renders it; this plugin does no diagram layout of
// its own, matching the design doc's "let Mermaid do the layout".

import type { QuartzEmitterPlugin, FilePath } from "@quartz-community/types"

// brain-plugins/ is deliberately outside site/ — a tested, dependency-free path
// builder, kept out of the Quartz tree so it survives an engine upgrade and is
// consumed as-is here, never reimplemented.
import { buildRolePath, listRoles } from "@loomery/brain-site/lib/onboarding/paths.mjs"
import { escapeHtml, emitPage } from "./shared/page-shell.ts"

// ---------------------------------------------------------------------------
// Adapter: Quartz's parsed content -> the plain {slug, title, roles, onboarding}
// shape buildRolePath/listRoles expect.
// ---------------------------------------------------------------------------

interface OnboardingBlock {
  order?: number
  prerequisites?: string[]
  summary?: string
  estimate?: string
}

interface OnboardingDoc {
  slug: string
  title: string
  roles: string[]
  onboarding?: OnboardingBlock
}

interface PathNode {
  slug: string
  title: string
  summary: string
  estimate: string | null
  depth: number
  isContext: boolean
  prerequisites: string[]
}

type QuartzContent = [unknown, { data: Record<string, unknown> }]

function adaptDocs(content: QuartzContent[]): OnboardingDoc[] {
  const docs: OnboardingDoc[] = []
  for (const [, file] of content) {
    const data = file.data
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const slug = data.slug as string | undefined
    if (!fm || !slug) continue
    const roles = Array.isArray(fm.roles)
      ? (fm.roles as unknown[]).filter((r): r is string => typeof r === "string")
      : []
    const onboarding = (fm.onboarding as OnboardingBlock | undefined) ?? undefined
    // frontmatter.title is Quartz's own resolved title (falls back to the file's
    // stem when no explicit `title:` is set — none of our docs set one) — use
    // the same value the rest of the site already shows, not a fabricated one.
    const title = typeof fm.title === "string" && fm.title.length > 0 ? fm.title : slug
    docs.push({ slug, title, roles, onboarding })
  }
  return docs
}

// Mermaid node IDs cannot contain "/" (or most punctuation) — `technical/context`
// silently breaks the parser otherwise.
function mermaidId(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9]/g, "_")
}

// Display-only humanisation (e.g. `product_context` -> "Product context"):
// hyphens/underscores to spaces, first letter capitalised. Never changes the
// underlying title/slug data.
function humanize(title: string): string {
  const spaced = title.replace(/[-_]/g, " ")
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}

// Mermaid label / click-tooltip text sits inside ["..."] or "..." — strip
// characters that would break that quoting, and keep it single-line (a `<br/>`
// depends on htmlLabels, which is another silent-failure path not worth chasing).
function mermaidSafe(s: string): string {
  return s.replace(/["[\]\n\r]/g, "").trim()
}

// ---------------------------------------------------------------------------
// Mermaid source + role switcher + ordered list, as HTML fragments.
// ---------------------------------------------------------------------------

function roleSwitcherHtml(roles: string[], current: string | undefined): string {
  const parts = [`<a href="/onboarding">All roles</a>`]
  for (const role of roles) {
    parts.push(
      role === current
        ? `<strong>${escapeHtml(humanize(role))}</strong>`
        : `<a href="/onboarding/${role}">${escapeHtml(humanize(role))}</a>`,
    )
  }
  return `<p><strong>Onboarding paths:</strong> ${parts.join(" &middot; ")}</p>`
}

function mermaidSource(nodes: PathNode[]): string {
  const ids = new Map<string, string>()
  for (const n of nodes) ids.set(n.slug, mermaidId(n.slug))

  const lines: string[] = ["flowchart TD"]
  nodes.forEach((n, i) => {
    const id = ids.get(n.slug)!
    const est = n.estimate ? ` (${n.estimate})` : ""
    const contextSuffix = n.isContext ? " (context)" : ""
    // Mermaid (v10+) treats double-quoted node labels as "markdown strings" and
    // its mini markdown renderer chokes on anything that looks like an ordered
    // list marker ("1. ", "1) ") at the start — it silently renders
    // "Unsupported markdown: list" instead of the label. Confirmed by actually
    // rendering this in a browser (plan's own click-to-verify standard applies
    // here too). A middot avoids the CommonMark list-marker pattern entirely.
    const label = mermaidSafe(`${i + 1} · ${humanize(n.title)}${est}${contextSuffix}`)
    lines.push(`  ${id}["${label}"]`)
  })
  for (const n of nodes) {
    const id = ids.get(n.slug)!
    for (const prereq of n.prerequisites) {
      const prereqId = ids.get(prereq)
      if (prereqId) lines.push(`  ${prereqId} --> ${id}`)
    }
  }
  for (const n of nodes) {
    const id = ids.get(n.slug)!
    const tooltip = mermaidSafe(n.summary || n.title)
    lines.push(`  click ${id} "/${n.slug}" "${tooltip}"`)
  }
  return lines.join("\n")
}

// Mandatory, not decorative: the fallback if `click` is inert, the
// keyboard/screen-reader path (Mermaid nodes are not focusable controls), and
// it works without JS.
function orderedListHtml(nodes: PathNode[]): string {
  const items = nodes
    .map((n) => {
      const est = n.estimate ? ` — ${escapeHtml(n.estimate)}` : ""
      const summary = n.summary ? ` — ${escapeHtml(n.summary)}` : ""
      const contextNote = n.isContext ? ` <em>(context, from another role)</em>` : ""
      return `<li><a href="/${n.slug}">${escapeHtml(humanize(n.title))}</a>${est}${summary}${contextNote}</li>`
    })
    .join("\n")
  return `<h2>Path</h2>\n<ol>\n${items}\n</ol>`
}

// The `<pre><code class="mermaid">` shape alone rendered correctly on a hard page
// load but broke with "Syntax error in text" after any client-side (SPA) nav into
// an onboarding page. Root cause, found by reading the client-side re-init script
// itself (node_modules/@quartz-community/obsidian-flavored-markdown/dist/index.js,
// the "nav"/"render" listener): after mermaid.run(), it walks every code.mermaid's
// parent <pre> expecting a sibling `.expand-button` and `#mermaid-container` — chrome
// that Quartz's OWN rehype transform (`mermaidExpand`, same package) normally injects
// around a ```mermaid fence at build time via `parent.children = [expandButton(),
// node, mermaidContainer()]`. This emitter bypasses that transform entirely (see the
// file banner), so those elements never existed, and the missing-element access threw
// mid-listener on every SPA transition — never on a hard load, which is why it looked
// fine until reached by clicking a link. `.clipboard-button` needs no equivalent here:
// a separate script (@quartz-community/syntax-highlighting) unconditionally prepends
// one to every <pre> on "nav"/"render", independent of this transform.
//
// Reproduced and fixed 2026-08-04: confirmed via mermaid.parse() in isolation that the
// diagram source itself was always valid — the failure was purely this missing chrome,
// not a content/escaping bug. Markup below is copied verbatim from `expandButton()` /
// `mermaidContainer()` in that same dist/index.js so it matches byte-for-byte.
const MERMAID_EXPAND_BUTTON =
  '<button class="expand-button" aria-label="Expand mermaid diagram" data-view-component="true">' +
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">' +
  '<path d="M3.72 3.72a.75.75 0 011.06 1.06L2.56 7h10.88l-2.22-2.22a.75.75 0 011.06-1.06l3.5 3.5a.75.75 0 010 1.06l-3.5 3.5a.75.75 0 11-1.06-1.06l2.22-2.22H2.56l2.22 2.22a.75.75 0 11-1.06 1.06l-3.5-3.5a.75.75 0 010-1.06l3.5-3.5z"></path>' +
  "</svg></button>"

const MERMAID_CONTAINER =
  '<div id="mermaid-container" role="dialog"><div id="mermaid-space"><div class="mermaid-content"></div></div></div>'

function rolePathSection(role: string, docs: OnboardingDoc[]): string {
  try {
    // buildRolePath throws `Error("cycle detected: ...")` on a cyclic graph — a
    // build error, not a render-time surprise. Catch it here instead of
    // crashing the whole build: a visibly broken page beats no page.
    const nodes = buildRolePath(docs, role) as PathNode[]
    if (nodes.length === 0) {
      return "<p>No onboarding docs are tagged for this role yet.</p>"
    }
    return [
      `<pre>${MERMAID_EXPAND_BUTTON}<code class="mermaid">${escapeHtml(mermaidSource(nodes))}</code>${MERMAID_CONTAINER}</pre>`,
      orderedListHtml(nodes),
    ].join("\n")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return [
      `<blockquote><p>This role's onboarding path could not be built.</p></blockquote>`,
      `<pre>${escapeHtml(message)}</pre>`,
    ].join("\n")
  }
}

// Page shell (pageShell/emitPage/data-persist handling) lives in
// ./shared/page-shell.ts — extracted there once logs-timeline-emitter.ts
// needed the same thing. See that file for the data-persist rationale: it is
// the fix for a real double-render race this emitter used to have, not
// decorative markup.

// ---------------------------------------------------------------------------
// The emitter itself.
// ---------------------------------------------------------------------------

export const OnboardingEmitter: QuartzEmitterPlugin<Record<string, never>> = () => ({
  name: "OnboardingEmitter",
  async emit(ctx, content, resources): Promise<FilePath[]> {
    const docs = adaptDocs(content as QuartzContent[])
    const roles = listRoles(docs)

    const fps: FilePath[] = []

    const indexBody = [
      "<h1>Onboarding</h1>",
      "<p>Pick a role to see its onboarding path.</p>",
      "<ul>",
      roles
        .map((role) => {
          let count = 0
          try {
            count = buildRolePath(docs, role).length
          } catch {
            count = 0
          }
          return `<li><a href="/onboarding/${role}">${escapeHtml(humanize(role))}</a> — ${count} doc${
            count === 1 ? "" : "s"
          }</li>`
        })
        .join("\n"),
      "</ul>",
    ].join("\n")
    fps.push(await emitPage(ctx, resources, "onboarding", "Onboarding", indexBody, "OnboardingEmitter"))

    for (const role of roles) {
      const body = [
        `<h1>Onboarding: ${escapeHtml(humanize(role))}</h1>`,
        roleSwitcherHtml(roles, role),
        rolePathSection(role, docs),
      ].join("\n")
      fps.push(
        await emitPage(
          ctx,
          resources,
          `onboarding/${role}`,
          `Onboarding: ${humanize(role)}`,
          body,
          "OnboardingEmitter",
        ),
      )
    }

    return fps
  },
})

export default OnboardingEmitter
