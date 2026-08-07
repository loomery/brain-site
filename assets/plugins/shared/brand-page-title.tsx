// Loomery co-branded PageTitle override — replaces @quartz-community/page-title
// entirely (registered against that exact source key in quartz.ts, following
// the same componentRegistry pattern already used there for the Explorer
// overrides). Renders "Loomery × <client>" with the Loomery logomark, matching
// how loomery.com pairs the logomark with the wordmark for co-branded work.
//
// Reusable across every brain this generator produces — nothing client-specific
// is hardcoded here:
//   - The Loomery half (logomark SVG, "Loomery", the "×", colours, fonts) is
//     fixed brand furniture — identical for every brain this generator produces.
//   - The client half is NOT hardcoded. It is derived from `cfg.pageTitle`
//     (configuration.pageTitle in quartz.config.yaml, templated from the
//     project name at scaffold time) via deriveClientName() below. TO REBRAND
//     FOR A DIFFERENT CLIENT: change `pageTitle` in site/quartz.config.yaml —
//     nothing in this file needs to change. Current convention this assumes:
//     pageTitle is "<Client>-<Project> Brain" (e.g. "Eque2-Chalkstring Brain"
//     -> "Eque2") for brains whose project name itself has that shape. If a
//     generated brain's pageTitle doesn't fit that shape (the common case —
//     most project names have no hyphen), deriveClientName() falls back to
//     the whole title (minus a trailing "Brain") rather than guessing further,
//     which is the desired result: "Loomery × Bite Engineering", not a
//     truncated fragment.
//
// Uses an inlined SVG (not the wordmark PNGs) because mint (#15FFB9) reads
// correctly as-is on both the white light surface and the ink dark surface —
// one asset, no per-theme swapping, no binary file added to the repo.
import { pathToRoot } from "../../quartz/util/path"
import type { QuartzComponent, QuartzComponentProps } from "../../quartz/components/types"

const LOGOMARK_VIEWBOX = "0 0 247 247"

/** Exported for testing/reuse — see the file banner for the convention this assumes. */
export function deriveClientName(pageTitle: string): string {
  const withoutSuffix = (pageTitle ?? "").replace(/\s+Brain\s*$/i, "").trim()
  const [firstSegment] = withoutSuffix.split("-")
  const trimmed = firstSegment?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : withoutSuffix
}

const LoomeryBrandTitleComponent: QuartzComponent = ({
  fileData,
  cfg,
  displayClass,
}: QuartzComponentProps) => {
  const baseDir = pathToRoot(fileData.slug)
  const clientName = deriveClientName(cfg.pageTitle)
  const classes = ["page-title", "loomery-brand-title", displayClass].filter(Boolean).join(" ")

  return (
    <h2 class={classes}>
      <a href={baseDir} class="loomery-brand-link" aria-label={`${cfg.pageTitle} — home`}>
        <svg
          class="loomery-logomark"
          viewBox={LOGOMARK_VIEWBOX}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="0" y="0" width="111.054" height="247" fill="currentColor" />
          <circle cx="190.994" cy="190.994" r="56.006" fill="currentColor" />
        </svg>
        <span class="loomery-brand-text">
          <span class="loomery-brand-loomery">Loomery</span>
          <span class="loomery-brand-times">&#215;</span>
          {clientName && <span class="loomery-brand-client">{clientName}</span>}
        </span>
      </a>
    </h2>
  )
}

LoomeryBrandTitleComponent.css = `
.loomery-brand-title {
  font-size: 1.75rem;
  margin: 0;
  font-family: var(--titleFont);
  min-width: 0;
}

.loomery-brand-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  color: var(--dark);
  text-decoration: none;
}

.loomery-logomark {
  flex: 0 0 auto;
  width: 1.5rem;
  height: 1.5rem;
  /* Brand mint reads correctly as-is on both the white light surface and the
     ink dark surface — no per-theme colour swap needed. */
  color: #15ffb9;
}

.loomery-brand-text {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}

.loomery-brand-loomery {
  flex: 0 0 auto;
}

.loomery-brand-times {
  flex: 0 0 auto;
  font-weight: 400;
}

.loomery-brand-client {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media all and (max-width: 800px) {
  .loomery-brand-title {
    font-size: 1.3rem;
  }

  .loomery-logomark {
    width: 1.15rem;
    height: 1.15rem;
  }
}
`

// `displayName` is load-bearing, not decorative: buildLayoutForEntries (quartz/
// plugins/loader/config-loader.ts) tells a "constructor to instantiate"
// (\`(opts) => QuartzComponent\`, how every real Quartz component package
// registers itself — confirmed by decompiling @quartz-community/page-title's
// own dist/index.js, which exports \`() => PageTitle\`, not \`PageTitle\`
// directly) apart from "a component to use as-is" purely by checking whether
// \`displayName\` is already set on the registered function. Without this,
// buildLayoutForEntries calls this component as if it were a zero-arg
// constructor at config-load time (before any page exists), which throws
// "Cannot destructure property 'fileData' of 'undefined'" — reproduced
// directly, this fixes it.
LoomeryBrandTitleComponent.displayName = "LoomeryBrandTitle"

export const LoomeryBrandTitle = LoomeryBrandTitleComponent
export default LoomeryBrandTitle
