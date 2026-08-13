// Onboarding: role-based reading paths, as chips linking into the existing
// /onboarding/<role> pages that onboarding-emitter.ts already emits.
//
// This module deliberately links rather than duplicates. The path building
// (topological sort, depth, cycle detection) lives in
// src/lib/onboarding/paths.mjs and is consumed by the emitter — reimplementing
// any of it here would give a brain two orderings that can disagree.
//
// Absent until some doc carries `roles:` frontmatter. A brain that has not
// declared roles has no reading path to offer, and an empty "pick your role"
// card would be worse than no card.

import { escapeHtml, card, humanize, PROVENANCE } from "./render.ts"
import type { DashboardModel, DashboardModule } from "./types.ts"

export const OnboardingModule: DashboardModule = {
  id: "onboarding",
  render(vm: DashboardModel): string | null {
    const roles = (vm.onboarding ?? []).filter((entry: any) => entry.count > 0)
    if (roles.length === 0) return null

    const chips = roles.map(
      (entry: any) =>
        `<a class="dash-chip dash-chip--role" href="/onboarding/${encodeURIComponent(
          entry.role,
        )}">${escapeHtml(humanize(entry.role))} <b>${entry.count}</b></a>`,
    )
    chips.push(`<a class="dash-chip" href="/onboarding">All roles</a>`)

    return card(
      "Onboarding",
      PROVENANCE.STATED,
      `<p class="dash-muted dash-footnote">New here? Pick your role for an ordered reading path.</p>` +
        `<div class="dash-chips">${chips.join("")}</div>`,
      { id: "onboarding" },
    )
  },
}

export default OnboardingModule
