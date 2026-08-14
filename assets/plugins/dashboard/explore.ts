// The brain's own page and section index — this is the old HomeEmitter listing,
// preserved as the dashboard's last module.
//
// Keeping it as a module rather than a separate fallback page is what lets `/`
// always render something useful: a brain with neither dashboard file gets
// exactly what it gets today, and there is one precedence rule
// (docs/index.md wins) instead of three tiers.

import { escapeHtml, card, humanize, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const ExploreModule: DashboardModule = {
  id: "explore",
  render(vm: DashboardModel): string | null {
    const pages: Array<{ slug: string; title: string }> = vm.pages ?? []
    const topPages: Array<{ slug: string; title: string }> = []
    const folders = new Set<string>()

    for (const page of pages) {
      if (page.slug === "index") continue
      const segments = page.slug.split("/")
      if (segments.length === 1) {
        topPages.push(page)
        continue
      }
      // "tags" is Quartz's own auto-generated tag index, not brain content —
      // @quartz-community/folder-page excludes it by the same name for the same
      // reason.
      if (segments[0] !== "tags") folders.add(segments[0])
    }

    if (topPages.length === 0 && folders.size === 0) return null

    topPages.sort((a, b) => a.title.localeCompare(b.title))
    const chips = [
      ...topPages.map(
        (p) => `<a class="dash-chip" href="/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a>`,
      ),
      ...[...folders]
        .sort((a, b) => a.localeCompare(b))
        .map(
          (f) =>
            `<a class="dash-chip dash-chip--folder" href="/${escapeHtml(f)}/">${escapeHtml(
              humanize(f),
            )}/</a>`,
        ),
    ]

    return card(
      "Explore the brain",
      PROVENANCE.STATED,
      `<div class="dash-chips">${chips.join("")}</div>`,
      { id: "explore" },
    )
  },
}

export default ExploreModule
