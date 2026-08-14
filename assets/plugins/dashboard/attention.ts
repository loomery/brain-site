// "Needs attention": the narrative counterpart to the deterministic `behind`
// counter. Entirely assessed.
//
// Sorted by severity rather than kept in file order: the list's whole job is to
// put the worst thing first, and sync has no reason to author it in priority
// order.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export const AttentionModule: DashboardModule = {
  id: "attention",
  render(vm: DashboardModel): string | null {
    const items = vm.attention ?? []
    if (items.length === 0) return null

    const rows = [...items]
      .map((item: any, index: number) => ({ item, index }))
      .sort((a, b) => {
        const rank = (entry: any) => SEVERITY_RANK[entry.item.severity] ?? 3
        // Index as tiebreak keeps the sort stable, so two entries of equal
        // severity stay in the order sync wrote them.
        return rank(a) - rank(b) || a.index - b.index
      })
      .map(({ item }) => {
        const severity = typeof item.severity === "string" ? item.severity : "none"
        const detail =
          typeof item.detail === "string"
            ? ` <span class="dash-muted">· ${escapeHtml(item.detail)}</span>`
            : ""
        return (
          `<span class="dash-sev dash-sev--${escapeHtml(severity)}"></span>` +
          `${escapeHtml(item.text)}${detail}`
        )
      })

    return card("Needs attention", PROVENANCE.ASSESSED, list(rows), { id: "attention" })
  },
}

export default AttentionModule
