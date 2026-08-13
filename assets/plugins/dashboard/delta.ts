// "Since you last looked" — the highest value-per-token module on the page, and
// the one a reader benefits from most on a Monday morning. Entirely assessed:
// this is sync's own prose summary of what moved.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const DeltaModule: DashboardModule = {
  id: "delta",
  render(vm: DashboardModel): string | null {
    if (vm.delta === null) return null
    const since = vm.delta.since === null ? null : formatShortDate(vm.delta.since)
    const label = since === null ? "Since you last looked" : `Since you last looked · ${since}`
    return card(
      label,
      PROVENANCE.ASSESSED,
      `<p class="dash-delta">${escapeHtml(vm.delta.text)}</p>`,
      { id: "delta" },
    )
  },
}

export default DeltaModule
