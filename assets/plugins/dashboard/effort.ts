// Effort: days sold against days used and in flight.
//
// Every number is stated — hand-written in dashboard.yaml's `effort` block — and
// the module is absent when `soldDays` is missing. That is deliberate: a burn
// figure nobody is tracking would be invented, and an invented number on a page
// labelled "stated" is worse than a missing module.

import { card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const EffortModule: DashboardModule = {
  id: "effort",
  render(vm: DashboardModel): string | null {
    const effort = vm.effort
    if (effort === null) return null

    const bar =
      `<div class="dash-burn">` +
      `<span class="dash-burn-used" style="width:${effort.usedPct}%"></span>` +
      `<span class="dash-burn-flight" style="left:${effort.usedPct}%;width:${effort.inFlightPct}%"></span>` +
      `</div>`

    const legend =
      `<p class="dash-muted dash-burn-legend">` +
      `<span class="dash-burn-key dash-burn-key--used">${effort.usedDays} used</span> · ` +
      `<span class="dash-burn-key dash-burn-key--flight">${effort.inFlightDays} in flight</span> · ` +
      `<span>${effort.leftDays} left of ${effort.soldDays} days</span></p>`

    return card("Effort", PROVENANCE.STATED, bar + legend, { id: "effort" })
  },
}

export default EffortModule
