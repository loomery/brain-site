// Types shared by the dashboard's module renderers.
//
// DashboardModel is deliberately loose. The model is built in
// src/lib/dashboard/model.mjs — plain ESM, because it must be unit-testable
// without a Quartz build and importable by the CLI — so a structural interface
// here would be a second copy of a contract that test/dashboard-model.test.mjs
// already pins precisely. Duplicating it would let the two drift silently, which
// is worse than an index signature.

export type DashboardModel = Record<string, any>

export const PROVENANCE = {
  STATED: "stated",
  ASSESSED: "assessed",
  MIXED: "mixed",
} as const

export type Provenance = (typeof PROVENANCE)[keyof typeof PROVENANCE]

export interface DashboardModule {
  id: string
  // Returns null when this module's slice of the model is absent, which is how
  // presence-driven modularity works: a brain gets the modules it has data for
  // and nothing configures that.
  render(vm: DashboardModel): string | null
}
