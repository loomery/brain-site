// The summary strip: RAG, countdown, and the three counters in one row.
//
// Provenance is MIXED and that is the point — the days-left number is stated
// (arithmetic on a hand-written end date), the RAG is assessed (a model's
// judgement at last sync), and the counters are derived from the milestone list.
// Three different origins in one card, which is exactly why the label is per
// card rather than per module type.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

function counter(key: string, value: number, label: string): string {
  return (
    `<div class="dash-counter dash-counter--${key}">` +
    `<b data-counter="${key}">${value}</b><span>${escapeHtml(label)}</span></div>`
  )
}

export const SummaryModule: DashboardModule = {
  id: "summary",
  render(vm: DashboardModel): string | null {
    const { rag, countdown, counters, phase } = vm
    const hasCounters = counters.done + counters.behind + counters.attention > 0
    if (rag === null && countdown === null && !hasCounters) return null

    const parts: string[] = []

    if (rag !== null) {
      const level = typeof rag.level === "string" ? rag.level : "unknown"
      parts.push(
        `<span class="dash-rag dash-rag--${escapeHtml(level)}" title="${escapeHtml(level)}"></span>`,
      )
    }

    const headlineParts: string[] = []
    if (countdown !== null) {
      headlineParts.push(
        countdown.overranDays > 0
          ? `<strong>${countdown.overranDays} days over</strong>`
          : `<strong>${countdown.daysLeft} days left</strong>`,
      )
    }
    if (rag?.level) headlineParts.push(escapeHtml(String(rag.level)))
    if (phase !== null) {
      headlineParts.push(`phase ${phase.index} of ${phase.count}: ${escapeHtml(phase.name)}`)
    }

    const detail: string[] = []
    if (countdown !== null) detail.push(`Ends ${escapeHtml(countdown.endsOn)}`)
    if (rag?.headline) detail.push(escapeHtml(String(rag.headline)))

    parts.push(
      `<div class="dash-summary-text">` +
        `<div class="dash-summary-headline">${headlineParts.join(" · ")}</div>` +
        (detail.length > 0 ? `<div class="dash-muted">${detail.join(" · ")}</div>` : "") +
        `</div>`,
    )

    parts.push(
      `<div class="dash-counters">` +
        counter("done", counters.done, "Done") +
        counter("behind", counters.behind, "Behind") +
        counter("attention", counters.attention, "Attention") +
        `</div>`,
    )

    return card("Status", PROVENANCE.MIXED, `<div class="dash-summary">${parts.join("")}</div>`, {
      id: "status",
    })
  },
}

export default SummaryModule
