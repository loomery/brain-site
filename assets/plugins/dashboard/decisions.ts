// "Recent decisions": what got settled lately and by whom. Assessed.
//
// This is the module that stops the same question being re-litigated, and it is
// the highest-value thing a newcomer can read after the engagement summary.
// Newest first — an undated entry sorts last rather than being dropped, since
// "we decided this, date unrecorded" is still worth knowing.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const DecisionsModule: DashboardModule = {
  id: "decisions",
  render(vm: DashboardModel): string | null {
    const items = vm.decisions ?? []
    if (items.length === 0) return null

    const rows = [...items]
      .sort((a: any, b: any) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
      .map((item: any) => {
        const meta = [
          typeof item.by === "string" ? escapeHtml(item.by) : null,
          typeof item.date === "string" ? escapeHtml(formatShortDate(item.date)) : null,
        ].filter(Boolean)
        const suffix =
          meta.length > 0 ? ` <span class="dash-muted">· ${meta.join(", ")}</span>` : ""
        return `${escapeHtml(item.text)}${suffix}`
      })

    return card("Recent decisions", PROVENANCE.ASSESSED, list(rows), { id: "decisions" })
  },
}

export default DecisionsModule
