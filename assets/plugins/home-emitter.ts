// Home-page emitter. Emits `/` (index.html) with a plain, structural listing
// of the brain's top-level pages and sections — but ONLY when the brain has
// not written its own `docs/index.md`. A brain that has one keeps it,
// untouched: this emitter is a fallback, not an override.
//
// Why an emitter rather than a Quartz config option: Quartz's own
// @quartz-community/folder-page plugin already generates a virtual index
// page for any folder that lacks one (see its FolderPage.generate() in
// node_modules/@quartz-community/folder-page/dist/index.js) — but it
// explicitly excludes the content root itself: `getFolders()` walks up a
// file's slug collecting ancestor folder names and the caller filters out
// `f !== "."`, so "." (the root) never lands in the `folders` set that
// virtual pages get generated for. Confirmed by reading that exact
// filter — there is no config flag to turn root-index generation on; the
// root case is structurally excluded from the mechanism regardless of
// options. So a config-only fix does not exist here, and this emitter fills
// the one gap folder-page deliberately leaves.
//
// Same hand-written-HTML approach as onboarding-emitter.ts and
// logs-timeline-emitter.ts, and for the same reason — see either file's
// banner (local plugins are loaded via a genuine Node `import()`, never
// esbuild, and .brain-site/quartz/**'s extension-less relative imports are
// unresolvable by Node's own loader).
//
// The circularity this emitter has to avoid: it writes index.html, and
// page-shell's chrome donor logic would happily read index.html back as a
// donor for *this very page* — on a fresh build with nothing else on disk
// yet, that's this page's own (still being written, or previously-written
// but chrome-less) content, not a real page's chrome. emitPage's
// donorExclude parameter (passed as ["index"] below) makes page-shell skip
// index.html specifically for this call, so it always picks a genuine
// donor (another root-level content page) — never itself. See
// shared/page-shell.ts's DEFAULT_EXCLUDED_DONOR_SLUGS comment for the
// broader exclusion rationale this builds on.

import type { QuartzEmitterPlugin, FilePath } from "@quartz-community/types"
import { escapeHtml, emitPage } from "./shared/page-shell.ts"

interface ContentItem {
  slug: string
  title: string
}

type QuartzContent = [unknown, { data: Record<string, unknown> }]

function adaptContent(content: QuartzContent[]): ContentItem[] {
  const items: ContentItem[] = []
  for (const [, file] of content) {
    const data = file.data
    const slug = data?.slug as string | undefined
    if (!slug) continue
    if (data.unlisted === true) continue
    const fm = data.frontmatter as Record<string, unknown> | undefined
    const title = typeof fm?.title === "string" && fm.title.length > 0 ? fm.title : slug
    items.push({ slug, title })
  }
  return items
}

function hasRootIndex(items: ContentItem[]): boolean {
  return items.some((item) => item.slug === "index")
}

// Display-only humanisation (e.g. `product-context` -> "Product context"):
// hyphens/underscores to spaces, first letter capitalised. Matches the
// convention already used by onboarding-emitter.ts's own `humanize`.
function humanize(title: string): string {
  const spaced = title.replace(/[-_]/g, " ")
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}

function homeBody(items: ContentItem[]): string {
  const topPages: ContentItem[] = []
  const folders = new Set<string>()

  for (const item of items) {
    if (item.slug === "index") continue
    const segments = item.slug.split("/")
    if (segments.length === 1) {
      topPages.push(item)
    } else {
      const folder = segments[0]
      // "tags" is Quartz's own auto-generated tag-index folder, not brain
      // content — @quartz-community/folder-page's own generator excludes it
      // by the same name for the same reason (see this file's banner).
      if (folder !== "tags") folders.add(folder)
    }
  }

  topPages.sort((a, b) => a.title.localeCompare(b.title))
  const sortedFolders = [...folders].sort((a, b) => a.localeCompare(b))

  const pagesHtml =
    topPages.length > 0
      ? `<ul>\n${topPages
          .map((p) => `<li><a href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a></li>`)
          .join("\n")}\n</ul>`
      : "<p>No top-level pages yet.</p>"

  const sectionsHtml =
    sortedFolders.length > 0
      ? `<ul>\n${sortedFolders
          .map((f) => `<li><a href="/${escapeHtml(f)}/">${escapeHtml(humanize(f))}</a></li>`)
          .join("\n")}\n</ul>`
      : "<p>No sections yet.</p>"

  return [
    "<h1>Home</h1>",
    "<p>This brain has no <code>index.md</code> yet, so this is a generated index of what's here.</p>",
    "<h2>Pages</h2>",
    pagesHtml,
    "<h2>Sections</h2>",
    sectionsHtml,
  ].join("\n")
}

export const HomeEmitter: QuartzEmitterPlugin<Record<string, never>> = () => ({
  name: "HomeEmitter",
  async emit(ctx, content, resources): Promise<FilePath[]> {
    const items = adaptContent(content as QuartzContent[])

    // The brain wrote its own index.md — @quartz-community/content-page
    // already emits index.html for it. Never touch it, and never race that
    // emitter for the same output file.
    if (hasRootIndex(items)) return []

    const body = homeBody(items)
    return [
      await emitPage(ctx, resources, "index", "Home", body, "HomeEmitter", "", ["index"]),
    ]
  },
})

export default HomeEmitter
