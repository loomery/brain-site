// Shared page-shell for hand-written local emitters (onboarding-emitter.ts,
// logs-timeline-emitter.ts). Extracted once a second consumer needed it —
// see docs/meta/2026-08-04-brain-frontend-design.md §10 on why premature
// extraction is avoided; two concrete callers is not premature.
//
// Why these emitters build HTML by hand instead of reusing Quartz's own
// renderPage: local plugins (a `./plugins/*.ts` source in quartz.config.yaml)
// are loaded via a genuine Node runtime `import()`, never through esbuild.
// Every quartz/** source file uses extension-less relative imports
// (`from "../../util/path"`), which esbuild resolves at the real build's
// entrypoint but Node's native TypeScript support cannot. Verified directly:
//
//   node -e "import('./plugins/onboarding-emitter.ts')"                // works
//   node -e "import('../quartz/plugins/emitters/helpers.ts')"          // fails
//
// So this module uses only Node builtins, @quartz-community/types
// (type-only — erased), and the *data* Quartz already hands any emitter:
// `ctx.hashedResourceNames` and the aggregated `resources: StaticResources`.

import fs from "fs"
import path from "path"
import type { BuildCtx, StaticResources, FilePath } from "@quartz-community/types"

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// `data-persist="true"` on every resource tag is load-bearing, not decorative.
// Quartz's SPA router (quartz/components/scripts/spa.inline.ts) only keeps head
// elements carrying this attribute across a client-side navigation; a real
// Quartz page marks every one, inline scripts included (confirmed by reading a
// built content page's raw HTML). Omit it and micromorph treats every resource
// tag on a hand-written page as new on each nav into it and re-inserts them —
// harmless for `type="module"` scripts (per-URL singleton evaluation) but a
// classic (non-module) script re-executes its top-level code on every fresh
// insertion. That is exactly how the Mermaid bundle's own `"nav"` listener
// registration got silently duplicated and produced a double-render race
// (.brain-site/plugins/onboarding-emitter.ts's fix commit has the full trace).
function cssTag(resource: { content: string; inline?: boolean }): string {
  return resource.inline
    ? `<style data-persist="true">${resource.content}</style>`
    : `<link rel="stylesheet" href="${resource.content}" data-persist="true">`
}

function jsTag(resource: {
  contentType: "external" | "inline"
  loadTime: "beforeDOMReady" | "afterDOMReady"
  moduleType?: "module"
  src?: string
  script?: string
}): string {
  const moduleAttr = resource.moduleType === "module" ? ' type="module"' : ""
  return resource.contentType === "external"
    ? `<script src="${resource.src}"${moduleAttr} data-persist="true"></script>`
    : `<script${moduleAttr} data-persist="true">${resource.script}</script>`
}

// ---------------------------------------------------------------------------
// Real sidebar chrome (Explorer, Search, Graph), lifted from an already-built
// real page rather than hand-copied.
//
// A hand-written page can't call Quartz's real component renderers (see the
// file banner), but the Explorer/Search/Graph sidebar content is *not* baked
// in by those renderers anyway — it's a mostly-static container (with a
// `data-data-fns` attribute carrying the Explorer's sort/filter/map functions
// as serialized strings, evaluated client-side) that the already-included
// resource scripts populate at runtime. So instead of reproducing that
// container by hand — fragile, and silently drifts from whatever Quartz
// actually emits on the next dependency bump — this reads it verbatim off a
// real rendered page and reuses it. Table of Contents and Backlinks are
// excluded: those are genuinely per-page data, and copying them from an
// unrelated page would show wrong information, not missing information.
//
// The donor is not a fixed filename (see findDonorChrome below): every
// content page carries identical chrome, so any already-built root-level
// page will do, with index.html preferred only because it's the
// conventional, most-likely-already-built one. A brain with no docs/index.md
// (this package must never require one — see the file's governing
// principle) still has other root-level content pages Quartz built from its
// actual docs, so those remain valid donors.

let cachedChrome: { left: string; right: string; extraCss: string } | null = null

// Test-only escape hatch: cachedChrome is a deliberate once-per-build
// singleton (a real build calls loadRealPageChrome many times across many
// emitted pages and should only ever search the output directory once), but
// that same singleton would leak a donor chosen by one test into every test
// that runs after it in the same process. Not used anywhere in the actual
// emit path.
export function __resetDonorChromeCacheForTests(): void {
  cachedChrome = null
}

function findBalancedDiv(html: string, openTag: string): { inner: string; start: number; end: number } | null {
  const start = html.indexOf(openTag)
  if (start === -1) return null
  let depth = 1
  let i = start + openTag.length
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return { inner: html.slice(start + openTag.length, i - 6), start, end: i }
}

function stripDivsByClass(html: string, classAttr: string): string {
  let result = html
  for (;;) {
    const openTag = `<div class="${classAttr}">`
    const idx = result.indexOf(openTag)
    if (idx === -1) return result
    const found = findBalancedDiv(result, openTag)
    if (!found) return result
    result = result.slice(0, found.start) + result.slice(found.end)
  }
}

// index.html's own relative URLs (`href="."`, `href="./component-x.css"`)
// resolve correctly *from the site root* where index.html actually lives.
// Reused verbatim on a page nested one or two segments deeper
// (/onboarding/engineering), the exact same href resolves to
// /onboarding/component-x.css instead — a 404, confirmed by reading actual
// network requests: every relative stylesheet 404'd on a nested page while
// the one link this file already built as a root-relative "/…" path (the
// pre-existing indexCss include) loaded fine. That 404 is why the Explorer
// and Search looked like unstyled boxes even after the CSS *files* were
// wired in: most of them never loaded. Rewriting every `./`/bare-`.` href to
// a root-relative "/…" makes the same markup depth-independent.
function toRootRelative(html: string): string {
  return html.replace(/(href|src)="(\.\/?[^"]*)"/g, (_m, attr, url) => {
    const rest = url === "." ? "" : url.replace(/^\.\//, "")
    return `${attr}="/${rest}"`
  })
}

// The sidebar chrome also carries its own <script> tags (postscript.js, the
// resource-after-*.js bundles) — already covered by this page's own
// `resources.js`-driven beforeDomJs/afterDomJs. Left in place, the
// root-relative fix above would make them load successfully (instead of
// 404ing) and register their listeners a *second* time — the same class of
// bug the data-persist fix (see cssTag/jsTag above) exists to prevent, just
// via a different path. The chrome should be structure only; scripts stay
// owned by this file's existing single inclusion point.
//
// One exception is declared by hand in pageShell's <head> instead: the inline
// `const fetchData = fetch(".../static/contentIndex.json")` bootstrap. It is
// not in `resources.js` (it's injected by the real renderer, like the
// component stylesheets), and the Explorer's client script awaits that exact
// global to build its file tree — without it the Explorer finds its container
// but logs "Trie result: null / No trie or empty children" and renders an
// empty sidebar. Declared with a root-relative URL for the same
// depth-independence reason as toRootRelative above.
function stripScriptTags(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
}

export interface DonorChrome {
  left: string
  right: string
  extraCss: string
}

// Every content page carries identical sidebar chrome, so the donor is
// selected by *availability*, not by a fixed filename — except for pages
// known in advance to be unsuitable donors, which are never candidates
// regardless of what's on disk:
//   - "404": verified to contain no sidebar containers at all.
//   - "logs" / "onboarding": these hand-written emitters' own outputs. A
//     stale one from a previous build has the sidebar *containers* but an
//     *empty* Explorer inside them (today's fallback, see below) — accepting
//     one as a donor would silently propagate that emptiness forward rather
//     than fixing it.
// A caller can extend this with its own slug(s) via loadRealPageChrome's
// second argument — see the home-page emitter, which must never treat its
// own (about-to-be-generated) index.html as its own donor.
const DEFAULT_EXCLUDED_DONOR_SLUGS = new Set(["404", "logs", "onboarding"])

export function extractChromeFromHtml(html: string): DonorChrome | null {
  const leftFound = findBalancedDiv(html, '<div class="left sidebar">')
  const rightFound = findBalancedDiv(html, '<div class="right sidebar">')
  if (!leftFound || !rightFound) return null

  // Per-page data — wrong if copied from an unrelated page — not merely
  // absent chrome.
  const right = stripDivsByClass(stripDivsByClass(rightFound.inner, "toc"), "backlinks")

  const left = toRootRelative(stripScriptTags(leftFound.inner))
  const rightClean = toRootRelative(stripScriptTags(right))

  // A container with nothing in it (e.g. a stale hand-written page emitted
  // before any donor was available, or a real page whose layout genuinely
  // carries no sidebar content) is not a usable donor — reject it so the
  // caller keeps searching rather than silently propagating emptiness.
  if (left.trim().length === 0 || rightClean.trim().length === 0) return null

  // The per-component stylesheets (Explorer, Search, Graph, etc.) that make
  // this chrome actually look like anything are NOT part of the `resources`
  // argument this plugin's own emitter receives — they get attached to
  // `resources.css` per-layout by the real component-tree renderer this
  // page shell can't call (see the file banner), so a hand-written page's
  // own `resources.css` list is missing every one of them: confirmed by
  // diffing `<link ... component-*.css>` tags between a synthetic page and
  // a real one — 0 vs 18. They're the same 18 files on every real page
  // (registered site-wide, not per-page), so lifting every stylesheet
  // `<link>` out of this same already-rendered page's <head> is exact, not
  // approximate — this is the actual, current set for this build, not a
  // hand-maintained guess that drifts on the next dependency bump.
  // Also lift `rel="preconnect"` hints for the Google Fonts CDN, not just
  // the stylesheet links themselves — without them the browser doesn't
  // start that connection until it parses the stylesheet link, which
  // widens the window where Mermaid measures node-box sizes against a
  // fallback font before the real webfont swaps in and overflows them
  // (found by reproducing it: `document.fonts.ready` fixed a page that
  // looked broken on load, confirming a font-load race, not a content bug).
  // This narrows that window; it does not close it on a slow connection.
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/)
  const extraCss = headMatch
    ? (headMatch[1].match(/<link[^>]*rel="(?:stylesheet|preconnect)"[^>]*>/g) ?? []).join("\n")
    : ""

  return { left, right: rightClean, extraCss: toRootRelative(extraCss) }
}

// Root-level pages only: `readdir(outputDir)` is deliberately non-recursive,
// so a nested page (e.g. technical/context.html) is never even a candidate —
// see toRootRelative's own comment for why reusing a nested page's relative
// URLs verbatim would produce broken asset links. index.html sorts first
// when present and usable: every content page carries identical chrome, so
// any donor is exact, but index.html is the conventional, most-likely-
// already-built one, so preferring it avoids picking arbitrarily.
function listDonorSlugs(outputDir: string, excludeSlugs: Set<string>): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(outputDir)
  } catch {
    return []
  }
  const slugs = entries
    .filter((name) => name.endsWith(".html"))
    .map((name) => name.slice(0, -".html".length))
    .filter((slug) => !excludeSlugs.has(slug))
  slugs.sort((a, b) => {
    if (a === "index") return -1
    if (b === "index") return 1
    return a.localeCompare(b)
  })
  return slugs
}

// Pure, synchronous-per-candidate donor search against an already-built (or
// partially-built) output directory — no polling, no module-level caching.
// Exported so tests can drive it directly against a fixture directory of
// small HTML files rather than a full Quartz build.
export function findDonorChrome(
  outputDir: string,
  excludeSlugs: Set<string> = new Set(),
): DonorChrome | null {
  const merged = new Set([...DEFAULT_EXCLUDED_DONOR_SLUGS, ...excludeSlugs])
  for (const slug of listDonorSlugs(outputDir, merged)) {
    let html: string
    try {
      html = fs.readFileSync(path.join(outputDir, `${slug}.html`), "utf8")
    } catch {
      continue
    }
    const chrome = extractChromeFromHtml(html)
    if (chrome) return chrome
  }
  return null
}

// The catch: emitters run concurrently (quartz/processors/emit.ts runs all
// non-dispatcher emitters via `Promise.all`), so there is no ordering
// guarantee that any other page has already been written by the time this
// runs. This polls with a bounded timeout and falls back to empty chrome
// (today's behavior, not a regression) if no usable donor turns up in time —
// a best-effort enhancement, not a dependency this can silently break on.
async function loadRealPageChrome(
  ctx: BuildCtx,
  excludeSlugs: Set<string> = new Set(),
): Promise<DonorChrome> {
  if (cachedChrome) return cachedChrome

  const outputDir = ctx.argv.output
  const deadline = Date.now() + 3000
  for (;;) {
    const chrome = findDonorChrome(outputDir, excludeSlugs)
    if (chrome) {
      cachedChrome = chrome
      return chrome
    }
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  console.warn(
    "[page-shell] real sidebar chrome unavailable, falling back to empty: no usable donor page found",
  )
  cachedChrome = { left: "", right: "", extraCss: "" }
  return cachedChrome
}

export async function pageShell(
  ctx: BuildCtx,
  resources: StaticResources,
  slug: string,
  title: string,
  bodyHtml: string,
  // Real page order (confirmed by reading a built page's own right sidebar):
  // graph, then table of contents, then backlinks. `chrome.right` above is
  // graph only (toc/backlinks are stripped as genuinely page-specific — see
  // loadRealPageChrome's own comment), so a caller-supplied TOC is appended
  // after it to match. Optional and empty by default so existing callers
  // (onboarding-emitter.ts) are unaffected.
  tocHtml: string = "",
  // Slugs that must never be picked as this page's own donor, on top of the
  // built-in exclusions (see DEFAULT_EXCLUDED_DONOR_SLUGS). Empty by default
  // so existing callers (onboarding-emitter.ts, logs-timeline-emitter.ts) are
  // unaffected. The home-page emitter passes its own slug ("index") here:
  // it is the one caller that can be *writing* that exact file, so it must
  // never treat its own (possibly still-empty) output as a donor for itself.
  donorExclude: Iterable<string> = [],
): Promise<string> {
  const hashed = ctx.hashedResourceNames ?? {}
  const indexCss = hashed["index.css"] ?? "index.css"
  const prescript = hashed["prescript.js"] ?? "prescript.js"
  const postscript = hashed["postscript.js"] ?? "postscript.js"

  const chrome = await loadRealPageChrome(ctx, new Set(donorExclude))

  const headCss = [
    `<link rel="stylesheet" href="/${indexCss}" data-persist="true">`,
    ...resources.css.map(cssTag),
    chrome.extraCss,
  ].join("\n")
  const beforeDomJs = resources.js
    .filter((r) => r.loadTime === "beforeDOMReady")
    .map(jsTag)
    .join("\n")
  const afterDomJs = resources.js
    .filter((r) => r.loadTime === "afterDOMReady")
    .map(jsTag)
    .join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
${headCss}
<script src="/${prescript}" type="application/javascript" data-persist="true"></script>
<script type="application/javascript" data-persist="true">const fetchData = fetch("/static/contentIndex.json").then(data => data.json())</script>
${beforeDomJs}
</head>
<body data-slug="${escapeHtml(slug)}">
<div id="quartz-root" class="page" data-frame="default">
<div id="quartz-body">
<div class="left sidebar">${chrome.left}</div>
<div class="center">
<div class="page-header"></div>
<article class="popover-hint">
${bodyHtml}
</article>
<hr>
<div class="page-footer"></div>
</div>
<div class="right sidebar">${chrome.right}${tocHtml}</div>
</div>
</div>
${afterDomJs}
<script src="/${postscript}" type="module" data-persist="true"></script>
</body>
</html>
`
}

// write() replicated (~5 lines) rather than imported — see the file banner:
// .brain-site/quartz/plugins/emitters/helpers.ts cannot be imported from a local
// plugin, since its own relative imports are extension-less and unresolvable
// by Node's runtime loader.
async function writeHtml(ctx: BuildCtx, slug: string, content: string): Promise<FilePath> {
  const outPath = path.join(ctx.argv.output, `${slug}.html`)
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true })
  await fs.promises.writeFile(outPath, content)
  return outPath as FilePath
}

// A build must never crash over one broken hand-written page — last-resort
// fallback that doesn't depend on ctx.hashedResourceNames/resources at all, in
// case those were themselves the problem.
export async function emitPage(
  ctx: BuildCtx,
  resources: StaticResources,
  slug: string,
  title: string,
  bodyHtml: string,
  loggerLabel: string,
  tocHtml: string = "",
  donorExclude: Iterable<string> = [],
): Promise<FilePath> {
  try {
    const html = await pageShell(ctx, resources, slug, title, bodyHtml, tocHtml, donorExclude)
    return await writeHtml(ctx, slug, html)
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
    console.warn(`[${loggerLabel}] falling back to bare HTML for /${slug}: ${message}`)
    const bare = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      title,
    )}</title></head><body><h1>${escapeHtml(title)}</h1><p>This page could not be rendered.</p><pre>${escapeHtml(
      message,
    )}</pre></body></html>`
    return await writeHtml(ctx, slug, bare)
  }
}
