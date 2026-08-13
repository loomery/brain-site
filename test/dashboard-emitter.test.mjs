// Coverage for assets/plugins/dashboard-emitter.ts.
//
// The first four tests are ported verbatim in intent from the deleted
// test/home-emitter.test.mjs: the dashboard absorbed that emitter, so its
// guarantees have to keep holding — emit `/` only when the brain has no
// docs/index.md, list top-level pages and sections, and never treat its own
// output as its own chrome donor.

import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DashboardEmitter, adaptContent } from "../assets/plugins/dashboard-emitter.ts"
import { __resetDonorChromeCacheForTests } from "../assets/plugins/shared/page-shell.ts"

// page-shell.ts caches its chosen chrome donor once per process (deliberate for
// a real build) — reset it so one test's donor cannot leak into the next.
beforeEach(() => {
  __resetDonorChromeCacheForTests()
})

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

// Seeded up front so page-shell's bounded donor poll resolves immediately
// instead of burning its full 3s timeout.
function donorPageHtml() {
  return `<!DOCTYPE html><html><head></head><body>
<div class="left sidebar"><div id="explorer">tree</div></div>
<div class="center">content</div>
<div class="right sidebar"><div id="graph-container">graph</div></div>
</body></html>`
}

function fakeCtx(outputDir) {
  return { argv: { output: outputDir }, hashedResourceNames: {} }
}

function fakeResources() {
  return { css: [], js: [] }
}

const CONTENT = [
  [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
  [{}, { data: { slug: "stakeholders", frontmatter: {} } }],
  [{}, { data: { slug: "technical/context", frontmatter: {} } }],
  [{}, { data: { slug: "tags/ai", frontmatter: {} } }],
]

async function emitTo(dir, { content = CONTENT, options = {} } = {}) {
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())
  const result = await DashboardEmitter({ pageTitle: "Acme Brain", ...options }).emit(
    fakeCtx(dir),
    content,
    fakeResources(),
  )
  return { result, html: fs.existsSync(path.join(dir, "index.html"))
    ? fs.readFileSync(path.join(dir, "index.html"), "utf8")
    : null }
}

test("does not emit when the brain already has its own docs/index.md", async () => {
  const dir = tmpDir("dash-has-index")
  const content = [[{}, { data: { slug: "index", frontmatter: { title: "Home" } } }]]
  const result = await DashboardEmitter({}).emit(fakeCtx(dir), content, fakeResources())
  assert.deepEqual(result, [])
  assert.equal(fs.existsSync(path.join(dir, "index.html")), false)
})

test("emits index.html when there is no index.md", async () => {
  const dir = tmpDir("dash-no-index")
  const { result, html } = await emitTo(dir)
  assert.equal(result.length, 1)
  assert.match(result[0], /index\.html$/)
  assert.match(html, /<!DOCTYPE html>/)
})

test("the explore module lists top-level pages and section folders", async () => {
  const dir = tmpDir("dash-explore")
  const { html } = await emitTo(dir)
  assert.match(html, /href="\/engagement"/)
  assert.match(html, /Engagement/)
  assert.match(html, /href="\/stakeholders"/)
  assert.match(html, /href="\/technical\/"/)
})

test("the explore module humanises a slug with no frontmatter title", async () => {
  const dir = tmpDir("dash-humanise")
  const content = [[{}, { data: { slug: "product-context", frontmatter: {} } }]]
  const { html } = await emitTo(dir, { content })
  assert.match(html, /Product context/)
})

// A humanised fallback title is a display convenience, not the truth — a
// frontmatter title must survive verbatim (humanize() would mangle a real
// hyphenated title like "AI-led pillar"), and later modules (recently-updated
// docs, brain-health counts) need to tell the two cases apart without
// re-deriving anything. adaptContent is exported for exactly this: the flag
// isn't observable from rendered HTML, which only ever shows the display value.
test("a frontmatter title survives verbatim and is not flagged as derived", async () => {
  const content = [[{}, { data: { slug: "ai-led-pillar", frontmatter: { title: "AI-led pillar" } } }]]
  const pages = adaptContent(content)
  assert.equal(pages[0].title, "AI-led pillar")
  assert.equal(pages[0].titleIsDerived, false)

  const dir = tmpDir("dash-title-verbatim")
  const { html } = await emitTo(dir, { content })
  assert.match(html, /AI-led pillar/)
})

test("a slug with no frontmatter title is flagged as derived", async () => {
  const content = [[{}, { data: { slug: "product-context", frontmatter: {} } }]]
  const pages = adaptContent(content)
  assert.equal(pages[0].title, "Product context")
  assert.equal(pages[0].titleIsDerived, true)

  const dir = tmpDir("dash-title-derived")
  const { html } = await emitTo(dir, { content })
  assert.match(html, /Product context/)
})

test("Quartz's own tags/ folder is excluded from sections", async () => {
  const dir = tmpDir("dash-tags")
  const { html } = await emitTo(dir)
  assert.equal(/href="\/tags\/"/.test(html), false)
})

test("an unlisted page is excluded", async () => {
  const dir = tmpDir("dash-unlisted")
  const content = [
    [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
    [{}, { data: { slug: "secret", unlisted: true, frontmatter: { title: "Secret" } } }],
  ]
  const { html } = await emitTo(dir, { content })
  assert.equal(html.includes(">Secret<"), false)
})

test("it never picks its own index.html as its chrome donor", async () => {
  const dir = tmpDir("dash-donor")
  // A stale index.html left by a previous build — usable chrome (both sidebar
  // divs present, so extractChromeFromHtml would happily accept it), but
  // marked "STALE" so it is distinguishable from the legitimate donor
  // (engagement.html, seeded by emitTo with the "tree" marker). A chrome-less
  // stub would pass this test even with donorExclude removed, since
  // extractChromeFromHtml rejects that regardless of exclusion — it wouldn't
  // exercise the mechanism at all. listDonorSlugs sorts "index" first, so if
  // the exclusion were ever dropped, index.html's STALE chrome would win.
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head></head><body>
<div class="left sidebar"><div id="explorer">STALE</div></div>
<div class="center">stale content</div>
<div class="right sidebar"><div id="graph-container">STALE</div></div>
</body></html>`,
  )
  const { html } = await emitTo(dir)
  assert.match(html, /<div class="left sidebar"><div id="explorer">tree<\/div><\/div>/)
  assert.equal(html.includes("STALE"), false)
})

test("the page heading falls back to pageTitle with no dashboard.yaml", async () => {
  const dir = tmpDir("dash-heading-fallback")
  const { html } = await emitTo(dir)
  assert.match(html, /Acme Brain/)
})

test("the page heading uses project when dashboard.yaml supplies one", async () => {
  const dir = tmpDir("dash-heading-project")
  const brain = tmpDir("dash-heading-brain")
  fs.writeFileSync(path.join(brain, "dashboard.yaml"), "project: Secret Escapes\n")
  const { html } = await emitTo(dir, {
    options: { facts: path.join(brain, "dashboard.yaml") },
  })
  assert.match(html, /Secret Escapes/)
})

test("a malformed dashboard.yaml warns but still emits a page", async () => {
  const dir = tmpDir("dash-malformed")
  const brain = tmpDir("dash-malformed-brain")
  fs.writeFileSync(path.join(brain, "dashboard.yaml"), "project: [unclosed\n")
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    const { result, html } = await emitTo(dir, {
      options: { facts: path.join(brain, "dashboard.yaml") },
    })
    assert.equal(result.length, 1)
    assert.match(html, /Acme Brain/)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.some((w) => w.includes("dashboard.yaml")), true)
})

test("a build with no dashboard files at all emits only the explore module", async () => {
  const dir = tmpDir("dash-bare")
  const { html } = await emitTo(dir)
  assert.match(html, /Explore the brain/)
  assert.equal(html.includes("Timeline"), false)
})

test("a brain that has never written the dashboard files produces no warnings", async () => {
  const dir = tmpDir("dash-quiet")
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => warnings.push(String(msg))
  try {
    await emitTo(dir)
  } finally {
    console.warn = originalWarn
  }
  // Both files are optional by design. Warning on every build for an absent
  // optional file would train people to ignore the warnings that matter.
  assert.deepEqual(
    warnings.filter((w) => w.includes("DashboardEmitter")),
    [],
  )
})
