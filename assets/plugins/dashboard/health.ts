// "Brain health": can I trust what I am reading right now?
//
// MIXED. The source list is assessed — sync knows what it wired, and nothing at
// build time can verify a connector. The doc count is stated (counted from what
// Quartz parsed), and the sync age is arithmetic on the status file's own
// generatedAt.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { daysBetween } from "@loomery/brain-site/lib/dashboard/dates.mjs"
import type { DashboardModel, DashboardModule } from "./types.ts"

const STATE_MARKS: Record<string, string> = { wired: "✓", partial: "△", absent: "✗" }

function syncPhrase(generatedAt: string | null, today: string): string | null {
  if (generatedAt === null) return null
  const age = daysBetween(generatedAt, today)
  if (age === null) return null
  if (age <= 0) return "Synced today"
  if (age === 1) return "Synced yesterday"
  return `Synced ${age} days ago`
}

export const HealthModule: DashboardModule = {
  id: "health",
  render(vm: DashboardModel): string | null {
    const sources = vm.sources ?? []
    const sync = syncPhrase(vm.generatedAt, vm.today)
    if (sources.length === 0 && sync === null) return null

    const chips = sources.map((source: any) => {
      const state = typeof source.state === "string" ? source.state : "absent"
      const mark = STATE_MARKS[state] ?? ""
      const title = typeof source.note === "string" ? ` title="${escapeHtml(source.note)}"` : ""
      return (
        `<span class="dash-chip dash-chip--${escapeHtml(state)}"${title}>` +
        `${mark} ${escapeHtml(source.name)}</span>`
      )
    })

    const notes = sources
      .filter((source: any) => typeof source.note === "string")
      .map((source: any) => `${escapeHtml(source.name)}: ${escapeHtml(source.note)}`)

    const facts = [sync, `${(vm.pages ?? []).length} docs`, ...notes].filter(Boolean)

    return card(
      "Brain health",
      PROVENANCE.MIXED,
      (chips.length > 0 ? `<div class="dash-chips">${chips.join("")}</div>` : "") +
        `<p class="dash-muted dash-footnote">${facts.join(" · ")}</p>`,
      { id: "health" },
    )
  },
}

export default HealthModule
