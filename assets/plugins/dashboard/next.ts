// "What's next": the next few dated obligations, merged from milestones and
// commitments. Both are stated — the merge happens in model.mjs.
//
// Capped at five. This module answers "what is expected of me this week", not
// "what is the plan" — the timeline above already covers the plan, and repeating
// it here would make the page longer without making it more useful.

import { escapeHtml, card, list, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import { daysBetween } from "@loomery/brain-site/lib/dashboard/dates.mjs"
import type { DashboardModel, DashboardModule } from "./types.ts"

const MAX_ROWS = 5
// Anything falling within this many days of today is highlighted as imminent.
const SOON_DAYS = 2

export const NextModule: DashboardModule = {
  id: "next",
  render(vm: DashboardModel): string | null {
    const items = vm.next ?? []
    if (items.length === 0) return null

    const rows = items.slice(0, MAX_ROWS).map((item: any) => {
      // daysBetween, never `new Date(item.date)`: the whole point of dates.mjs
      // is that one place owns UTC-stable day arithmetic.
      const away = daysBetween(vm.today, item.date)
      const isSoon = away !== null && away <= SOON_DAYS
      const owner =
        item.owner === null ? "" : ` <span class="dash-muted">— ${escapeHtml(item.owner)}</span>`
      return (
        `<span class="dash-next-row${isSoon ? " dash-next-row--soon" : ""}">` +
        `<time datetime="${escapeHtml(item.date)}">${escapeHtml(formatShortDate(item.date))}</time>` +
        ` ${escapeHtml(item.text)}${owner}</span>`
      )
    })

    return card("What's next", PROVENANCE.STATED, list(rows), { id: "next" })
  },
}

export default NextModule
