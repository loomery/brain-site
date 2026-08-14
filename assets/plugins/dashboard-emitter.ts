// Dashboard home-page emitter. Emits `/` (index.html) as a modular overview of
// the project — countdown, milestone timeline, status, people, activity — but
// ONLY when the brain has not written its own `docs/index.md`. A brain that has
// one keeps it, untouched.
//
// This replaces home-emitter.ts, whose structural page/section listing survives
// as the `explore` module (see dashboard/explore.ts). That is deliberate: it
// means `/` always renders, a brain with no dashboard data is no worse off than
// before, and there is one precedence rule rather than three tiers.
//
// Why an emitter rather than a Quartz config option: Quartz's own
// @quartz-community/folder-page generates a virtual index for any folder lacking
// one, but explicitly excludes the content root — getFolders() collects ancestor
// folder names and the caller filters out ".", so the root is structurally
// excluded from the mechanism regardless of options. A config-only fix does not
// exist; this emitter fills the one gap folder-page deliberately leaves.
//
// Same hand-written-HTML approach as onboarding-emitter.ts and
// logs-timeline-emitter.ts, for the same reason — see either file's banner
// (local plugins load via a genuine Node import(), never esbuild, and
// .brain-site/quartz/**'s extension-less relative imports are unresolvable by
// Node's own loader).
//
// The circularity to avoid: this writes index.html, and page-shell's chrome
// donor logic would happily read index.html back as a donor for this very page.
// emitPage's donorExclude parameter (passed as ["index"]) makes page-shell skip
// index.html for this call, so it always picks a genuine donor. See
// page-shell.ts's DEFAULT_EXCLUDED_DONOR_SLUGS comment.
//
// Today's date is read here, once, and injected into the model. That is the one
// deliberate source of build non-reproducibility in the dashboard, and it is
// inherent to a countdown.

import path from "path"
import type { QuartzEmitterPlugin, FilePath } from "@quartz-community/types"
import { emitPage, escapeHtml } from "./shared/page-shell.ts"
import {
  loadDashboardFiles,
  loadLogActivity,
  gitDateFor,
} from "@loomery/brain-site/lib/dashboard/load.mjs"
import { buildModel } from "@loomery/brain-site/lib/dashboard/model.mjs"
import { listRoles, buildRolePath } from "@loomery/brain-site/lib/onboarding/paths.mjs"
import { MODULES } from "./dashboard/index.ts"
import { humanize, LOOMERY_LOGOMARK } from "./dashboard/render.ts"

interface DashboardOptions {
  facts?: string
  status?: string
  contentDir?: string
  logsDir?: string
  rootDir?: string
  pageTitle?: string
}

interface PageItem {
  slug: string
  title: string
  // True when `title` was derived from the slug via humanize() rather than
  // taken verbatim from frontmatter. A renderer cannot safely tell the two
  // apart by inspecting `title` alone — humanize() strips hyphens, so running
  // it again on a genuine frontmatter title like "AI-led pillar" would mangle
  // it into "AI led pillar". This flag is how later modules (the recently-
  // updated docs list, brain-health counts) recover that provenance without
  // re-deriving anything.
  titleIsDerived: boolean
  filePath: string | null
}

type QuartzContent = [unknown, { data: Record<string, unknown> }]

const RECENT_DOC_LIMIT = 3
const RECENT_LOG_LIMIT = 3

// Exported so tests can assert on `titleIsDerived` directly (it isn't
// observable from the rendered HTML, which only ever shows `title`).
export function adaptContent(content: QuartzContent[]): PageItem[] {
  const items: PageItem[] = []
  for (const [, file] of content) {
    const data = file.data
    const slug = data?.slug as string | undefined
    if (!slug) continue
    if (data.unlisted === true) continue
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const hasFrontmatterTitle = typeof fm?.title === "string" && fm.title.length > 0
    // A page with no frontmatter title falls back to its own slug, humanised
    // the same way explore.ts already humanises folder names — a raw slug
    // ("product-context") reads as a filename, not a title. titleIsDerived
    // records which case this was, since `title` alone doesn't say.
    const title = hasFrontmatterTitle ? (fm!.title as string) : humanize(slug)
    const filePath = typeof data.filePath === "string" ? data.filePath : null
    items.push({ slug, title, titleIsDerived: !hasFrontmatterTitle, filePath })
  }
  return items
}

function hasRootIndex(items: PageItem[]): boolean {
  return items.some((item) => item.slug === "index")
}

// The most recently changed docs, by last-commit date. Only pages Quartz already
// parsed are candidates, so this never has to walk the content directory itself.
function recentDocs(
  pages: PageItem[],
  opts: DashboardOptions,
): Array<{ slug: string; title: string; titleIsDerived: boolean; date: string }> {
  const rootDir = opts.rootDir
  const contentDir = opts.contentDir
  if (!rootDir || !contentDir) return []

  const dated: Array<{ slug: string; title: string; titleIsDerived: boolean; date: string }> = []
  for (const page of pages) {
    if (page.slug === "index") continue
    const rel = page.filePath ?? `${page.slug}.md`
    const abs = path.isAbsolute(rel) ? rel : path.join(contentDir, rel)
    const date = gitDateFor(rootDir, abs)
    if (date !== null)
      dated.push({
        slug: page.slug,
        title: page.title,
        titleIsDerived: page.titleIsDerived,
        date,
      })
  }

  return dated
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, RECENT_DOC_LIMIT)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Onboarding role counts.
//
// The doc shape here is the same {slug, title, roles, onboarding} shape
// onboarding-emitter.ts's own adaptDocs produces, deliberately, so both
// emitters feed buildRolePath identical input and never disagree on ordering.
// ---------------------------------------------------------------------------

interface OnboardingDoc {
  slug: string
  title: string
  roles: string[]
  onboarding?: { order?: number; prerequisites?: string[]; summary?: string; estimate?: string }
}

function adaptOnboardingDocs(content: QuartzContent[]): OnboardingDoc[] {
  const docs: OnboardingDoc[] = []
  for (const [, file] of content) {
    const data = file.data
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const slug = data.slug as string | undefined
    if (!fm || !slug) continue
    const roles = Array.isArray(fm.roles) ? (fm.roles as unknown[]).filter((r) => typeof r === "string") : []
    const title = typeof fm.title === "string" && fm.title.length > 0 ? fm.title : slug
    docs.push({
      slug,
      title,
      roles: roles as string[],
      onboarding: (fm.onboarding as OnboardingDoc["onboarding"]) ?? undefined,
    })
  }
  return docs
}

function onboardingCounts(content: QuartzContent[]): Array<{ role: string; count: number }> {
  const docs = adaptOnboardingDocs(content)
  try {
    return listRoles(docs).map((role: string) => ({ role, count: buildRolePath(docs, role).length }))
  } catch (err) {
    // buildRolePath throws Error("cycle detected: ...") on a cyclic prerequisite
    // graph. `npx brain-site validate` reports that properly; here it must only
    // cost the one module, not the page.
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[DashboardEmitter] onboarding paths unavailable: ${message}`)
    return []
  }
}

const CHROME_STORAGE_KEY = "brain-site-chrome"

// Runs inline, before the dashboard markup, so a stored preference is applied
// before first paint. Deferring it to afterDOMReady would show the default layout
// and then visibly jump.
//
// Only the non-default value needs restoring: the page is emitted expanded, so
// this looks for a stored "collapsed".
//
// Written as a plain (non-module) inline script that is idempotent — it only
// reads storage and sets an attribute — because Quartz's SPA router re-inserts
// body content on navigation and a script with side effects would double them.
const CHROME_SCRIPT =
  `<script data-persist="true">(function(){try{` +
  `var v=localStorage.getItem(${JSON.stringify(CHROME_STORAGE_KEY)});` +
  `if(v==="collapsed"){var r=document.getElementById("quartz-root");` +
  `if(r){r.setAttribute("data-chrome","collapsed");}}` +
  `}catch(e){}})()</script>`

// Pressed=true means the sidebars are shown (matching the button's own label,
// "Sidebars"). Chrome starts expanded, so the button starts pressed.
//
// The onclick string is itself delimited by double quotes, so the storage key
// must be spliced in with single quotes here — matching the single quotes
// already used for 'quartz-root'/'expanded'/'collapsed' below — rather than
// JSON.stringify's double-quoted output, which would terminate the attribute
// early and truncate the handler silently (confirmed: the resulting onclick
// parsed as a SyntaxError, "Unexpected token '}'", and the button rendered
// fine because the *tag* still closed at the stray '>' later in the string,
// hiding the break from visual inspection). CHROME_SCRIPT below is unaffected
// by the same pattern because it sits in a <script> element's text content,
// not an HTML attribute.
const CHROME_TOGGLE =
  `<button type="button" class="dash-chrome-toggle" aria-pressed="true" ` +
  `title="Show or hide the sidebars" onclick="(function(b){` +
  `var r=document.getElementById('quartz-root');` +
  `var next=r.getAttribute('data-chrome')==='expanded'?'collapsed':'expanded';` +
  `r.setAttribute('data-chrome',next);` +
  `b.setAttribute('aria-pressed',String(next==='expanded'));` +
  `try{localStorage.setItem('${CHROME_STORAGE_KEY}',next);}catch(e){}` +
  `})(this)">Sidebars</button>`

// CHROME_SCRIPT runs before any dashboard markup exists (deliberately, to avoid
// a layout jump — see its own comment), so it cannot reach the toggle button to
// sync its aria-pressed state: the button isn't in the DOM yet when that script
// runs. This second, idempotent script runs immediately after the header
// markup (the button now exists) and mirrors #quartz-root's current
// data-chrome onto the button — covering the case where CHROME_SCRIPT restored
// a "collapsed" preference but the button, rendered with its expanded-default
// aria-pressed="true", would otherwise still claim to be pressed.
const CHROME_SYNC =
  `<script data-persist="true">(function(){try{` +
  `var r=document.getElementById("quartz-root");` +
  `var b=document.querySelector(".dash-chrome-toggle");` +
  `if(r&&b){b.setAttribute("aria-pressed",String(r.getAttribute("data-chrome")==="expanded"));}` +
  `}catch(e){}})()</script>`

function renderModules(vm: Record<string, unknown>): string {
  const rendered: string[] = []
  for (const module of MODULES) {
    let html: string | null
    try {
      html = module.render(vm)
    } catch (err) {
      // One broken module must not cost the whole page. This is the same
      // philosophy as emitPage's own last-resort fallback.
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[DashboardEmitter] module "${module.id}" failed and was skipped: ${message}`)
      continue
    }
    if (html !== null && html.length > 0) rendered.push(html)
  }
  return rendered.join("\n")
}

export const DashboardEmitter: QuartzEmitterPlugin<DashboardOptions> = (opts = {}) => ({
  name: "DashboardEmitter",
  async emit(ctx, content, resources): Promise<FilePath[]> {
    const pages = adaptContent(content as QuartzContent[])

    // The brain wrote its own index.md — @quartz-community/content-page already
    // emits index.html for it. Never touch it, and never race that emitter for
    // the same output file.
    if (hasRootIndex(pages)) return []

    const { facts, status, warnings } = loadDashboardFiles({
      factsPath: opts.facts ?? null,
      statusPath: opts.status ?? null,
    })
    const { logs, warnings: logWarnings } = loadLogActivity({
      logsDir: opts.logsDir ?? null,
      limit: RECENT_LOG_LIMIT,
    })
    for (const warning of [...warnings, ...logWarnings]) {
      console.warn(`[DashboardEmitter] ${warning}`)
    }

    const vm = buildModel({
      facts,
      status,
      pageTitle: opts.pageTitle ?? "Home",
      pages,
      activity: { logs, docs: recentDocs(pages, opts) },
      onboarding: onboardingCounts(content as QuartzContent[]),
      today: todayIso(),
    })

    // The client's own logo is the brain's image; Loomery's mark is ours. The
    // separator is only emitted when there are genuinely two marks to pair —
    // a lone "×" beside one logo reads as a mistake.
    const clientLogo =
      vm.clientLogo === null
        ? ""
        : `<img class="dash-client-logo" src="${escapeHtml(String(vm.clientLogo))}" ` +
          `alt="${escapeHtml(String(vm.heading))}">`
    const marks =
      clientLogo === ""
        ? LOOMERY_LOGOMARK
        : `<span class="dash-hero-pair">${clientLogo}<span class="dash-hero-x" aria-hidden="true">×</span>${LOOMERY_LOGOMARK}</span>`

    const heading =
      `<header class="dash-hero">` +
      `<div class="dash-hero-titles">` +
      `<h1 class="dash-heading">${escapeHtml(String(vm.heading))}</h1>` +
      (vm.subtitle === null
        ? ""
        : `<p class="dash-subtitle">${escapeHtml(String(vm.subtitle))}</p>`) +
      `</div>` +
      `<div class="dash-hero-marks">${marks}</div>` +
      CHROME_TOGGLE +
      `</header>` +
      CHROME_SYNC
    const body = `${CHROME_SCRIPT}<div class="dashboard">${heading}${renderModules(vm)}</div>`

    return [
      await emitPage(
        ctx,
        resources,
        "index",
        String(vm.heading),
        body,
        "DashboardEmitter",
        "",
        ["index"],
        'data-chrome="expanded"',
      ),
    ]
  },
})

export default DashboardEmitter
