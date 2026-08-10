// Logs timeline emitter. Emits `/logs`: every logs/*.md session entry rendered
// in full on one page, newest first, so a reader can scroll through the whole
// change history rather than opening files one at a time.
//
// logs/ is a sibling of the content root (docs/, passed to Quartz via the resolved,
// absolute `-d` flag), not a descendant — same situation src/ is in — so Quartz's normal content
// pipeline never sees it and there is nothing to filter or index. This emitter
// reads it directly off disk at build time, the same technique
// onboarding-emitter.ts uses for its role-path data.
//
// logs/ is internal-only by convention (AGENTS.md: "one file per change
// session — what each agent did and assumed"), not per-doc audience
// frontmatter — these are process notes, not brain content. If a client build
// is ever wired up (design §7, currently disabled — nothing is published),
// this emitter must not run for it.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { QuartzEmitterPlugin, FilePath } from "@quartz-community/types"
import { escapeHtml, emitPage } from "./shared/page-shell.ts"
// This package's own zero-dependency Markdown renderer — NOT unified/remark/rehype.
// Those were resolved out of Quartz's own node_modules, which broke: a fresh clone of
// upstream Quartz no longer declares `rehype-stringify` (or any hast-to-html package)
// as a direct dependency, so that import throws ERR_MODULE_NOT_FOUND at build time.
// Quartz's plugin loader swallows that error internally and just skips registering
// this emitter with a warning ("Could not load plugin ... to detect category.
// Skipping.") — so the failure was silent: no /logs page, no loud crash. Found and
// fixed while building the Warp Brain Generator's site scaffolding (a fresh Quartz
// clone reproduced it immediately); backported here rather than left on the old
// approach, which only kept working in this repo because rehype-stringify happened
// to already be a tracked dependency there. See this package's
// src/lib/markdown/render.mjs (imported below as
// @loomery/brain-site/lib/markdown/render.mjs) and its own banner for the full story.
import { renderMarkdown } from "@loomery/brain-site/lib/markdown/render.mjs"
import { resolveTimelineSource } from "@loomery/brain-site/config/timeline-source.mjs"

const SKIP_FILES = new Set(["README.md", ".gitkeep"])

interface LogEntry {
  filename: string
  html: string
}

// .brain-site/plugins/logs-timeline-emitter.ts -> .brain-site/ is one level up. This is
// a fact about the generated tree's own shape, not about the brain's layout — and by
// the time opts reaches here in the real pipeline, opts.source is already an absolute
// path (resolved by setup's resolveOverridePaths against the repository root), so this
// is only ever consulted as a fallback base for an already-relative source.
function generatedDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

function loadLogEntries(logsDir: string): LogEntry[] {
  const files = fs
    .readdirSync(logsDir)
    .filter((name) => name.endsWith(".md") && !SKIP_FILES.has(name))
    .sort()
    // Filenames are YYYY-MM-DD-prefixed (AGENTS.md's own convention), so
    // reverse-alphabetical is newest-day-first. There is no time component,
    // so multiple entries on the same date sort by slug, not true chronology
    // within that day — acceptable given the convention has no finer grain.
    .reverse()

  return files.map((filename) => {
    const raw = fs.readFileSync(path.join(logsDir, filename), "utf8")
    const html = renderMarkdown(raw)
    return { filename, html }
  })
}

// Each log's own H1 already starts with its date ("# YYYY-MM-DD — ..."), so the
// jump list links directly to that text rather than re-prepending `e.date` —
// doing both produced a visible duplicate ("2026-08-04 — 2026-08-04 — ...").
function jumpListHtml(entries: LogEntry[]): string {
  const items = entries
    .map((e) => `<li><a href="#${escapeHtml(e.filename)}">${escapeHtml(titleOf(e))}</a></li>`)
    .join("\n")
  return `<h2>Jump to</h2>\n<ul>\n${items}\n</ul>`
}

// The rendered HTML's first heading *is* the log's own title (every logs/*.md
// starts `# YYYY-MM-DD — <description>`, per AGENTS.md's own convention) — reuse
// it rather than re-deriving one from the filename, so the jump list and the
// section itself never disagree.
function titleOf(entry: LogEntry): string {
  const m = entry.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!m) return entry.filename
  return m[1].replace(/<[^>]+>/g, "").trim()
}

function entrySectionHtml(entry: LogEntry): string {
  // Demote the entry's own H1 to an H2 (keeps exactly one real H1 on the
  // page — everything else nests under it in the document outline) and give
  // the H2 itself the anchor id, not a wrapping <section>. The real Quartz
  // TOC's scroll-highlight script (table-of-contents' toc.inline.ts) queries
  // `h1[id], h2[id], ...` directly — an id one level up on a wrapper is
  // invisible to it, confirmed by reading that script rather than assumed.
  // "Jump to" already links to `#${filename}`, so reusing that same value
  // here (instead of a separately slugified heading id) keeps both the
  // in-body jump list and the new sidebar TOC pointed at one id, not two.
  const body = entry.html
    .replace(/<h1([^>]*)>/, `<h2$1 id="${escapeHtml(entry.filename)}">`)
    .replace(/<\/h1>/, "</h2>")
  return `<section>\n${body}\n</section>`
}

// Real sidebar TOC markup, copied verbatim from a built page (the button's
// SVG, class names, and the `aria-controls`/`id` mismatch on the header/list
// pair) rather than approximated — the collapse toggle actually keys off
// `nextElementSibling`, not `aria-controls` (confirmed by reading
// table-of-contents' toc.inline.ts), so that mismatch is a harmless pre-
// existing upstream quirk, not a bug introduced here; matching it exactly
// keeps this page consistent with every other page rather than fixing an
// inconsistency that isn't this file's to fix.
const FOLD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="fold">' +
  "<polyline points=\"6 9 12 15 18 9\"></polyline></svg>"

function tocHtml(entries: LogEntry[]): string {
  const items = [
    `<li class="depth-0"><a href="#change-log" data-for="change-log">Change log</a></li>`,
    ...entries.map(
      (e) =>
        `<li class="depth-1"><a href="#${escapeHtml(e.filename)}" data-for="${escapeHtml(
          e.filename,
        )}">${escapeHtml(titleOf(e))}</a></li>`,
    ),
    `<li class="overflow-end"></li>`,
  ].join("")
  return (
    `<div class="toc"><button type="button" class="toc-header" aria-controls="toc-0" ` +
    `aria-expanded="true"><h3>Table of Contents</h3>${FOLD_ICON}</button>` +
    `<ul id="list-0" class="toc-content overflow">${items}</ul></div>`
  )
}

export const LogsTimelineEmitter: QuartzEmitterPlugin<{ source?: string; route?: string }> = (
  opts,
) => ({
  name: "LogsTimelineEmitter",
  async emit(ctx, _content, resources): Promise<FilePath[]> {
    const logsDir = resolveTimelineSource(opts, generatedDir())
    if (logsDir === null) return []

    let entries: LogEntry[]
    try {
      entries = loadLogEntries(logsDir)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[LogsTimelineEmitter] could not read ${logsDir}: ${message}`)
      entries = []
    }

    const body = [
      '<h1 id="change-log">Change log</h1>',
      "<p>Every session log in this brain, newest first. Internal only — see " +
        "<code>logs/README.md</code> for the convention these follow.</p>",
      entries.length > 0
        ? jumpListHtml(entries)
        : "<p>No log entries found.</p>",
      "<hr>",
      entries.map(entrySectionHtml).join("\n<hr>\n"),
    ].join("\n")

    return [
      await emitPage(
        ctx,
        resources,
        "logs",
        "Change log",
        body,
        "LogsTimelineEmitter",
        entries.length > 0 ? tocHtml(entries) : "",
      ),
    ]
  },
})

export default LogsTimelineEmitter
