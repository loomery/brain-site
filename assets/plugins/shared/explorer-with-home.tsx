// Wraps the real @quartz-community/explorer component to add a persistent
// "Home" link above its file tree — the only route back to `/` once the
// sidebars are open, since the Explorer's own tree is built entirely
// client-side from parsed content (fetchData -> contentIndex.json) and the
// dashboard is emitted by DashboardEmitter, never a parsed content file, so
// it can never appear as a node in that tree by any filterFn/mapFn tweak.
//
// A wrap, not a replacement: the real Explorer's tree-building, folding,
// search-filtering and afterDOMLoaded wiring are untouched. Registered under
// the exact same key ("@quartz-community/explorer") the Explorer overrides in
// quartz.ts already target, so `componentRegistry.setOptionOverrides` there
// keeps working unchanged — config-loader.ts merges those overrides into the
// options object passed to whatever constructor is registered under that key
// (confirmed by reading its instantiate branch), and this wrapper forwards
// that same object into the real Explorer(opts) untouched.
//
// This propagates everywhere with no other change. DashboardEmitter,
// onboarding-emitter.ts and logs-timeline-emitter.ts never render their own
// sidebar — page-shell.ts's donor-chrome mechanism copies the real rendered
// `<div class="left sidebar">` HTML verbatim from an already-built content
// page (see that file's banner). Because the Home link is static markup
// sitting inside that same div, it is captured and copied along with
// everything else — one change here reaches every hand-written page too.
import { Explorer } from "@quartz-community/explorer"
import { pathToRoot } from "../../quartz/util/path"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "../../quartz/components/types"

// Root-level donor pages only ever have depth 0 (page-shell.ts's own
// listDonorSlugs reads the output directory non-recursively for exactly this
// reason), so pathToRoot(donor's own slug) is always literally ".". That is
// what makes this href portable: page-shell.ts's toRootRelative() special-
// cases url === "." into href="/", so the link resolves correctly from a
// hand-written page at any depth, not just from the donor's own location.
// No "is this the current page" highlight: that is genuinely per-page data, and
// page-shell.ts's own donor-chrome mechanism can only copy chrome that was
// rendered for a DIFFERENT page (a real one, never the dashboard/onboarding/logs
// pages themselves, which never donate to each other — see page-shell.ts's
// DEFAULT_EXCLUDED_DONOR_SLUGS and this file's own banner). A hand-written page
// would therefore always display whatever aria-current value the donor's own
// slug produced, not its own — always false in practice, since the donor is
// never literally "index". Confirmed by building and inspecting a real page:
// aria-current was null on the dashboard itself. Rather than ship a highlight
// that is structurally incapable of firing on the one page it exists to
// indicate, this link carries no page-specific state at all, the same way
// page-shell.ts strips the real TOC/backlinks for the same reason.
function HomeLink({ fileData }: QuartzComponentProps) {
  return (
    <a href={pathToRoot(fileData.slug)} class="explorer-home-link">
      <svg
        class="explorer-home-icon"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M3 11.5 12 4l9 7.5M5.5 10v9.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      Home
    </a>
  )
}

// Not a bare QuartzComponent: must stay a genuine `(opts) => QuartzComponent`
// constructor, matching the real Explorer's own shape, and must NOT set
// `.displayName` on itself — config-loader.ts's buildLayoutForEntries branches
// on `!("displayName" in reg.component)` to decide "constructor to call with
// options" versus "instance to use as-is" (confirmed by reading that exact
// condition). Setting displayName here would skip calling this constructor
// with opts at all, silently dropping every filterFn/mapFn/sortFn override
// quartz.ts sets for the Explorer.
const ExplorerWithHomeConstructor: QuartzComponentConstructor<Record<string, unknown>> = (
  opts,
) => {
  const InnerExplorer = Explorer(opts as never)

  const Wrapped: QuartzComponent = (props: QuartzComponentProps) => (
    <>
      <HomeLink {...props} />
      <InnerExplorer {...props} />
    </>
  )

  // componentResources.ts (the emitter that collects every page's CSS/scripts)
  // reads `.css` / `.beforeDOMLoaded` / `.afterDOMLoaded` directly off each
  // top-level registered component — it does not walk into what a component
  // renders. Composing InnerExplorer inside Wrapped's JSX does not carry these
  // over on its own, so they are forwarded explicitly.
  Wrapped.css = [InnerExplorer.css, ExplorerWithHomeCss].filter(Boolean) as never
  Wrapped.beforeDOMLoaded = InnerExplorer.beforeDOMLoaded
  Wrapped.afterDOMLoaded = InnerExplorer.afterDOMLoaded

  return Wrapped
}

const ExplorerWithHomeCss = `
.explorer-home-link {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  padding: 0.15rem 0;
  color: var(--dark);
  font-family: var(--headerFont);
  font-size: 0.95rem;
  font-weight: 600;
  text-decoration: none;
}

.explorer-home-link:hover {
  color: var(--tertiary);
}

.explorer-home-icon {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
}
`

export const ExplorerWithHome = ExplorerWithHomeConstructor
export default ExplorerWithHome
