// The dashboard's ordered module registry.
//
// Order is fixed by the skin, not configurable per brain: every brain's
// dashboard should read the same way, and a module absent for lack of data is
// already the only variation that matters. Adding a module is a new file plus a
// line here — no brain edits, no brain-site.yaml key, no schema change.

import type { DashboardModule } from "./types.ts"
import { SummaryModule } from "./summary.ts"
import { DeltaModule } from "./delta.ts"
import { TimelineModule } from "./timeline.ts"
import { NextModule } from "./next.ts"
import { EffortModule } from "./effort.ts"
import { PeopleModule } from "./people.ts"
import { AttentionModule } from "./attention.ts"
import { DecisionsModule } from "./decisions.ts"
import { ActivityModule } from "./activity.ts"
import { HealthModule } from "./health.ts"
import { ExploreModule } from "./explore.ts"

export const MODULES: DashboardModule[] = [
  SummaryModule,
  DeltaModule,
  TimelineModule,
  NextModule,
  EffortModule,
  PeopleModule,
  AttentionModule,
  DecisionsModule,
  ActivityModule,
  HealthModule,
  ExploreModule,
]
