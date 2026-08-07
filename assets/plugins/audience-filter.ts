import type { QuartzFilterPlugin } from "@quartz-community/types"
import { shouldPublish } from "@loomery/brain-site/lib/audience/validate.mjs"

export const AudienceFilter: QuartzFilterPlugin<{ audience: string }> = (opts) => ({
  name: "AudienceFilter",
  shouldPublish(_ctx, [_tree, vfile]) {
    return shouldPublish(vfile.data?.frontmatter, opts?.audience ?? "internal")
  },
})
