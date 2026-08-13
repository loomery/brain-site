// "Who's on it, right now": the roster joined with each person's current focus.
//
// MIXED provenance, and the split matters — names, roles and orgs are stated
// (hand-written in dashboard.yaml, stable facts), while focus, detail and state
// are assessed at the last sync. This is the clearest case for labelling by
// field rather than by module type.
//
// The roster renders even with no status at all, so "who is on this project" is
// always answerable. Where a brain uses Linear or Jira, sync is what reads open
// issues per assignee and fills the assessed half — never this file, which runs
// in an offline build with no credentials.

import { escapeHtml, card, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

const STATE_LABELS: Record<string, string> = {
  "on-track": "ON TRACK",
  awaiting: "AWAITING",
  blocked: "BLOCKED",
  idle: "IDLE",
}

export const PeopleModule: DashboardModule = {
  id: "people",
  render(vm: DashboardModel): string | null {
    const people = vm.people ?? []
    if (people.length === 0) return null

    const rows = people.map((person: any) => {
      const meta = [person.role, person.org].filter(Boolean).map(String).map(escapeHtml).join(" · ")
      const focus =
        person.focus === null
          ? `<div class="dash-muted">No current focus recorded</div>`
          : `<div class="dash-person-focus">${escapeHtml(person.focus)}</div>`
      const detail =
        person.detail === null ? "" : `<div class="dash-muted">${escapeHtml(person.detail)}</div>`
      const state =
        person.state === null
          ? `<div class="dash-state"></div>`
          : `<div class="dash-state dash-state--${escapeHtml(person.state)}">${escapeHtml(
              STATE_LABELS[person.state] ?? person.state,
            )}</div>`

      return (
        `<div class="dash-person">` +
        `<div class="dash-person-who"><b>${escapeHtml(person.name)}</b>` +
        (meta ? `<span>${meta}</span>` : "") +
        `</div>` +
        `<div class="dash-person-now">${focus}${detail}</div>` +
        state +
        `</div>`
      )
    })

    const note =
      `<p class="dash-muted dash-footnote">Names and roles from <code>dashboard.yaml</code>; ` +
      `focus and state written at the last sync.</p>`

    return card(
      "Who's on it, right now",
      PROVENANCE.MIXED,
      `<div class="dash-people">${rows.join("")}</div>${note}`,
      { id: "people" },
    )
  },
}

export default PeopleModule
