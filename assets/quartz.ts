import { componentRegistry } from "./quartz/components/registry"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { LoomeryBrandTitle } from "./plugins/shared/brand-page-title"
import { ExplorerWithHome } from "./plugins/shared/explorer-with-home"

// Loomery co-branded page title. Full component swap, not an option override — @quartz-community/page-title's
// PageTitle takes no configurable options at all (its package.json declares
// `defaultOptions: {}`), so the only way to change what it renders is to
// replace the registered component outright. `componentRegistry.register`
// keyed on the exact `source:` string from quartz.config.yaml
// ("@quartz-community/page-title") is what buildLayoutForEntries actually
// looks up for that plugin entry (confirmed by reading extractPluginName +
// buildLayoutForEntries in quartz/plugins/loader/config-loader.ts — for a
// bare npm-style source string like this one, extractPluginName returns it
// unchanged, and that's the literal key page-title's own loader registers
// itself under too). Must run before loadQuartzConfig(), same as the Explorer
// overrides below: componentLoader.ts's own registration of the real
// PageTitle under this same key is guarded with `if (!componentRegistry.get(
// pluginName))`, so registering first here makes it skip re-registering and
// leaves this override in place — verified by an actual build, not just by
// reading the guard.
componentRegistry.register(
  "@quartz-community/page-title",
  LoomeryBrandTitle,
  "@quartz-community/page-title",
)

// Full component swap for the Explorer, same reasoning and same
// componentRegistry.register call shape as LoomeryBrandTitle above — this
// package's own ExplorerWithHome wraps the real Explorer to add a persistent
// "Home" link, since the Explorer's own file tree is built entirely from
// parsed content and the dashboard is emitted by DashboardEmitter, so it can
// never appear in that tree. Must run before loadQuartzConfig() for the same
// reason as the page-title swap: componentLoader.ts's own registration of the
// real Explorer under this same key only happens `if (!componentRegistry.get(
// pluginName))`, so registering first here wins and stays.
//
// Unlike LoomeryBrandTitle, ExplorerWithHome deliberately does NOT set a
// `.displayName` on itself — see that file's own comment on why: it must
// still be called as a real `(opts) => QuartzComponent` constructor so the
// setOptionOverrides call below keeps reaching the real Explorer's
// filterFn/mapFn/sortFn, which it forwards through unchanged.
componentRegistry.register(
  "@quartz-community/explorer",
  ExplorerWithHome,
  "@quartz-community/explorer",
)

// Explorer sidebar overrides (brain-specific).
//
// Registered directly against componentRegistry rather than via the documented
// `ExternalPlugin.Explorer(...)` / `.quartz/plugins` indirection: that generated
// registry only covers plugins installed as directories under `.quartz/plugins/`
// (git-sourced or local-file plugins with their own `dist/index.d.ts`), and never
// picks up npm-installed component packages like `@quartz-community/explorer`
// (confirmed by reading quartz/cli/plugin-git-handlers.js's regeneratePluginIndex,
// which only walks PLUGINS_DIR). The override lookup key that config-loader.ts
// actually uses at instantiation time is `extractPluginName(entry.source)`, which
// for a bare npm-style source string returns the string verbatim — so the key
// below must match `quartz.config.yaml`'s Explorer `source:` field exactly. These
// overrides reach the real Explorer via ExplorerWithHome's own forwarding, above.
componentRegistry.setOptionOverrides("@quartz-community/explorer", {
  // Keep the stock default (hide the auto-generated tags folder) and additionally
  // hide docs/meta/ — if this brain uses that convention for internal build-tooling
  // docs, they aren't brain content a reader should browse to. Harmless no-op if
  // docs/meta/ doesn't exist. filterFn replaces the default outright, so both
  // conditions must be re-stated here, not just the new one.
  filterFn: (node: { slugSegment?: string; isFolder: boolean }) =>
    node.slugSegment !== "tags" && node.slugSegment !== "meta",
  // Files/folders without a `title:` frontmatter fall back to their raw slug
  // segment (e.g. "technical", "onboarding-status"). Capitalise the first letter
  // of each word for display; leave the rest of each word untouched so deliberate
  // internal casing (EValuate, BoQ, MoSCoW) survives if it ever appears in a title.
  mapFn: (node: { displayName?: string; slugSegment?: string }) => {
    const raw = node.displayName || node.slugSegment || ""
    node.displayName = raw
      .replace(/[-_]+/g, " ")
      .split(" ")
      .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
    return node
  },
  // Pin "Change log" (docs/logs.md, slug "logs") to the very bottom of the
  // Explorer regardless of alphabetical position — it's a process/meta entry,
  // not brain content, so it shouldn't compete for space among the docs
  // someone's actually trying to find. Everything else keeps the Explorer's
  // own default sort: folders before files, alphabetical within each group
  // (replicated here since a custom sortFn replaces the default outright,
  // same reasoning as filterFn above).
  sortFn: (
    a: { isFolder: boolean; slugSegment?: string; displayName?: string },
    b: { isFolder: boolean; slugSegment?: string; displayName?: string },
  ) => {
    const aLast = a.slugSegment === "logs" && !a.isFolder
    const bLast = b.slugSegment === "logs" && !b.isFolder
    if (aLast !== bLast) return aLast ? 1 : -1
    if ((!a.isFolder && !b.isFolder) || (a.isFolder && b.isFolder)) {
      return (a.displayName ?? "").localeCompare(b.displayName ?? "", undefined, {
        numeric: true,
        sensitivity: "base",
      })
    }
    return !a.isFolder && b.isFolder ? 1 : -1
  },
})

const config = await loadQuartzConfig()
export default config
export const layout = await loadQuartzLayout()
