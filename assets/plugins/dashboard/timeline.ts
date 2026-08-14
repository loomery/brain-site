// The fisheye timeline.
//
// Emits the same data twice, deliberately:
//
//   1. `.dash-fisheye` — the horizontal bar, `aria-hidden="true"`. It is a
//      positional graphic built from absolutely-positioned markers; there is no
//      reading order in it that a screen reader could usefully linearise.
//   2. `.dash-spine` — an ordered list of the same nodes. Always in the DOM, so
//      it is the accessible representation, and *also* the vertical layout the
//      stylesheet promotes below 800px, where the bar cannot fit (dates alone
//      need ~70px each).
//
// One source of truth rendered two ways beats a bar plus a separately-generated
// fallback that can disagree with it. Every width and offset is computed
// server-side in model.mjs — this file only places what it is given.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// "2026-08-14" -> "14 Aug". Formatted from the ISO parts rather than via
// toLocaleDateString: a build's locale and timezone must not change the output.
export function formatShortDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  const [, , month, day] = match
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`
}

function relativeDays(days: number): string {
  if (days === 0) return "today"
  if (days === 1) return "tomorrow"
  return `in ${days} days`
}

function agoDays(days: number): string {
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}

function nodeMarkup(
  node: { date: string; name: string; done: boolean; synthetic: boolean },
  atEnd: boolean,
): string {
  const position = atEnd ? "left:100%" : "left:0"
  const classes = ["dash-node", node.done ? "dash-node--done" : "", node.synthetic ? "dash-node--bound" : ""]
    .filter(Boolean)
    .join(" ")
  return (
    `<span class="${classes}" style="${position}"></span>` +
    `<span class="dash-node-name" style="${position}">${escapeHtml(node.name)}</span>` +
    `<span class="dash-node-date" style="${position}">${escapeHtml(formatShortDate(node.date))}</span>`
  )
}

function barMarkup(segments: any[]): string {
  const parts = segments.map((segment) => {
    const inner: string[] = [`<span class="dash-track"></span>`]
    if (segment.kind === "current" && segment.today !== null) {
      inner.push(`<span class="dash-fill" style="width:${segment.today.offsetPct}%"></span>`)
    }
    inner.push(nodeMarkup(segment.startNode, false))
    if (segment.endNode !== null) inner.push(nodeMarkup(segment.endNode, true))
    if (segment.kind === "current" && segment.today !== null) {
      const left = `left:${segment.today.offsetPct}%`
      inner.push(`<span class="dash-today" style="${left}"></span>`)
      if (segment.today.label !== null) {
        inner.push(
          `<span class="dash-today-label" style="${left}">${escapeHtml(segment.today.label)}</span>`,
        )
      }
    }
    // flex-basis is server-computed: the current gap gets a fixed 35% so a
    // position inside it is readable, the rest share 65% by true duration.
    return (
      `<div class="dash-seg dash-seg--${segment.kind}" style="flex-basis:${segment.basis}%">` +
      inner.join("") +
      `</div>`
    )
  })
  return `<div class="dash-fisheye" aria-hidden="true">${parts.join("")}</div>`
}

function spineMarkup(segments: any[], todayIso: string): string {
  const rows: string[] = []
  const push = (node: any, extraClass = "") => {
    rows.push(
      `<li class="dash-spine-row${extraClass}">` +
        `<time datetime="${escapeHtml(node.date)}">${escapeHtml(formatShortDate(node.date))}</time>` +
        `<span>${escapeHtml(node.name)}</span></li>`,
    )
  }

  for (const segment of segments) {
    push(segment.startNode, segment.startNode.done ? " dash-spine-row--done" : "")
    if (segment.kind === "current") {
      const label = segment.today?.label
      rows.push(
        `<li class="dash-spine-row dash-spine-row--today">` +
          `<time datetime="${escapeHtml(todayIso)}">Today</time>` +
          `<span>${label === null || label === undefined ? "You are here" : escapeHtml(label)}</span></li>`,
      )
    }
    if (segment.endNode !== null) push(segment.endNode)
  }

  return `<ol class="dash-spine">${rows.join("")}</ol>`
}

function legendMarkup(legend: any): string {
  const left =
    legend.pastName === null
      ? ""
      : `<span>Since <strong>${escapeHtml(legend.pastName)}</strong> · ${escapeHtml(
          agoDays(legend.pastDaysAgo),
        )}</span>`

  let right = ""
  if (legend.overranDays > 0) {
    right = `<span class="dash-legend-next dash-legend-next--over">Overran by <strong>${legend.overranDays} days</strong></span>`
  } else if (legend.nextIsEnd) {
    right = `<span class="dash-legend-next">Ends <strong>${escapeHtml(
      relativeDays(legend.nextInDays),
    )}</strong></span>`
  } else if (legend.nextName !== null) {
    right = `<span class="dash-legend-next">Next: <strong>${escapeHtml(
      legend.nextName,
    )}</strong> · ${escapeHtml(relativeDays(legend.nextInDays))}</span>`
  }

  if (left === "" && right === "") return ""
  return `<p class="dash-legend">${left}${right}</p>`
}

function plainMarkup(timeline: any): string {
  return (
    `<div class="dash-plainbar" aria-hidden="true">` +
    `<span class="dash-track"></span>` +
    `<span class="dash-fill" style="width:${timeline.progressPct}%"></span>` +
    `<span class="dash-today" style="left:${timeline.progressPct}%"></span>` +
    `</div>` +
    `<p class="dash-legend"><span>${escapeHtml(timeline.todayLabel)}</span></p>`
  )
}

export const TimelineModule: DashboardModule = {
  id: "timeline",
  render(vm: DashboardModel): string | null {
    const timeline = vm.timeline
    if (timeline === null) return null

    const body =
      timeline.mode === "plain"
        ? plainMarkup(timeline)
        : barMarkup(timeline.segments) +
          legendMarkup(timeline.legend) +
          spineMarkup(timeline.segments, vm.today)

    return card("Timeline", PROVENANCE.STATED, body, { id: "timeline" })
  },
}

export default TimelineModule
