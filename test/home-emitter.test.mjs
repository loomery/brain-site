// Coverage for assets/plugins/home-emitter.ts: it must emit `/` only when the
// brain has not written its own docs/index.md, and must never treat its own
// output as its own chrome donor (see that file's banner for the
// circularity this guards against).

import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { HomeEmitter } from "../assets/plugins/home-emitter.ts"
import { __resetDonorChromeCacheForTests } from "../assets/plugins/shared/page-shell.ts"

// page-shell.ts caches the chosen chrome donor once per process (deliberate
// for a real build — see its own comment) — reset it before every test here
// so one test's donor choice can't leak into the next.
beforeEach(() => {
  __resetDonorChromeCacheForTests()
})

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

// A donor page seeded up front so page-shell's bounded poll resolves
// immediately instead of burning its full 3s timeout waiting for a donor
// that will never appear in these fixtures.
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

test("does not emit a home page when the brain already has docs/index.md", async () => {
  const dir = tmpDir("home-has-index")
  const content = [[{}, { data: { slug: "index", frontmatter: { title: "Home" } } }]]

  const result = await HomeEmitter().emit(fakeCtx(dir), content, fakeResources())

  assert.deepEqual(result, [])
  assert.equal(fs.existsSync(path.join(dir, "index.html")), false)
})

test("emits a generated home page listing top-level pages and sections when there is no index.md", async () => {
  const dir = tmpDir("home-no-index")
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())

  const content = [
    [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
    [{}, { data: { slug: "technical/context", frontmatter: {} } }],
    [{}, { data: { slug: "technical/decisions", frontmatter: {} } }],
  ]

  const result = await HomeEmitter().emit(fakeCtx(dir), content, fakeResources())

  assert.equal(result.length, 1)
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8")
  assert.match(html, /<a href="\/engagement">Engagement<\/a>/)
  assert.match(html, /<a href="\/technical\/">Technical<\/a>/)
})

test("excludes unlisted pages and the auto-generated tags folder from the generated listing", async () => {
  const dir = tmpDir("home-unlisted")
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())

  const content = [
    [{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }],
    [{}, { data: { slug: "secret", frontmatter: { title: "Secret" }, unlisted: true } }],
    [{}, { data: { slug: "tags/foo", frontmatter: {} } }],
  ]

  const result = await HomeEmitter().emit(fakeCtx(dir), content, fakeResources())

  assert.equal(result.length, 1)
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8")
  assert.doesNotMatch(html, /Secret/)
  assert.doesNotMatch(html, /tags/)
})

test("never treats its own generated index.html as its own chrome donor", async () => {
  const dir = tmpDir("home-no-self-donor")
  // A previous run's generated home page, sitting on disk already — chrome
  // sourced from elsewhere (non-empty), so it would otherwise look like a
  // perfectly usable donor if this emitter didn't exclude its own slug.
  fs.writeFileSync(
    path.join(dir, "index.html"),
    donorPageHtml().replace("tree", "STALE FROM PREVIOUS RUN"),
  )
  fs.writeFileSync(path.join(dir, "engagement.html"), donorPageHtml())

  const content = [[{}, { data: { slug: "engagement", frontmatter: { title: "Engagement" } } }]]

  await HomeEmitter().emit(fakeCtx(dir), content, fakeResources())

  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8")
  assert.doesNotMatch(html, /STALE FROM PREVIOUS RUN/)
})
