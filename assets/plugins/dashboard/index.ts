// The dashboard's ordered module registry.
//
// Order is fixed by the skin, not configurable per brain: every brain's
// dashboard should read the same way, and a module absent for lack of data is
// already the only variation that matters. Adding a module is a new file plus a
// line here — no brain edits, no brain-site.yaml key, no schema change.

import type { DashboardModule } from "./types.ts"
import { ExploreModule } from "./explore.ts"

export const MODULES: DashboardModule[] = [ExploreModule]
