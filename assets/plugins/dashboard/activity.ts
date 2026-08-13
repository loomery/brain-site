// "Recent activity": the latest session logs beside the most recently changed
// docs. Both stated — filenames off disk and `git log -1` per file.
//
// One card with two columns rather than two cards, because they answer the same
// question: where is this brain actually moving? A column with no data is
// omitted rather than rendered empty.
//
// Log entries link to the timeline page's own anchors. logs-timeline-emitter.ts
// gives each entry section an id equal to its filename and its "Jump to" list
// links to `#${filename}`, so reusing that value here points all three at one id
// rather than three.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import { formatShortDate } from "./timeline.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

function column(heading: string, rowsHtml: string[]): string {
  return (
    `<div class="dash-activity-col">` +
    `<p class="dash-muted dash-activity-heading">${escapeHtml(heading)}</p>` +
    `<ul class="dash-list">${rowsHtml.map((row) => `<li>${row}</li>`).join("")}</ul></div>`
  )
}

function dateSuffix(date: string | null): string {
  return date === null ? "" : ` <span class="dash-muted">${escapeHtml(formatShortDate(date))}</span>`
}

export const ActivityModule: DashboardModule = {
  id: "activity",
  render(vm: DashboardModel): string | null {
    const logs = vm.activity?.logs ?? []
    const docs = vm.activity?.docs ?? []
    if (logs.length === 0 && docs.length === 0) return null

    const columns: string[] = []

    if (logs.length > 0) {
      columns.push(
        column(
          "Latest logs",
          logs.map(
            (log: any) =>
              `<a href="/logs#${escapeHtml(log.filename)}">${escapeHtml(log.title)}</a>` +
              dateSuffix(log.date),
          ),
        ),
      )
    }

    if (docs.length > 0) {
      columns.push(
        column(
          "Recently updated",
          docs.map(
            (doc: any) =>
              `<a href="/${escapeHtml(doc.slug)}">${escapeHtml(doc.title)}</a>` +
              dateSuffix(doc.date),
          ),
        ),
      )
    }

    return card(
      "Recent activity",
      PROVENANCE.STATED,
      `<div class="dash-activity">${columns.join("")}</div>`,
      { id: "activity" },
    )
  },
}

export default ActivityModule
