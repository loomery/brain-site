// Donor-selection coverage for assets/plugins/shared/page-shell.ts's
// findDonorChrome/extractChromeFromHtml. Driven against fixture directories of
// small hand-written HTML files rather than a full Quartz build — see that
// file's own banner for why the donor is picked by availability, not a fixed
// filename, and what must never be picked.

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { findDonorChrome, extractChromeFromHtml } from "../assets/plugins/shared/page-shell.ts"

function tmpDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

// A minimal but realistic real-page shape: sidebar containers with actual
// content inside them, plus a stylesheet link in <head> to exercise extraCss.
function realPageHtml({ leftContent = '<div id="explorer">tree</div>', rightContent = '<div id="graph-container">graph</div>' } = {}) {
  return `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="./component-explorer.css">
</head><body>
<div id="quartz-body">
<div class="left sidebar">${leftContent}</div>
<div class="center">content</div>
<div class="right sidebar">${rightContent}</div>
</div>
</body></html>`
}

function emptyChromePageHtml() {
  // What page-shell itself writes when it fell back to empty chrome — the
  // containers exist, but there is nothing inside them.
  return `<!DOCTYPE html><html><head></head><body>
<div class="left sidebar"></div>
<div class="center">content</div>
<div class="right sidebar"></div>
</body></html>`
}

function noSidebarPageHtml() {
  return `<!DOCTYPE html><html><head></head><body><h1>Not Found</h1></body></html>`
}

function write(dir, slug, html) {
  fs.mkdirSync(path.dirname(path.join(dir, `${slug}.html`)), { recursive: true })
  fs.writeFileSync(path.join(dir, `${slug}.html`), html)
}

// --- extractChromeFromHtml ---------------------------------------------------

test("extractChromeFromHtml returns null when sidebar containers are absent", () => {
  assert.equal(extractChromeFromHtml(noSidebarPageHtml()), null)
})

test("extractChromeFromHtml returns null when both sidebar containers are empty", () => {
  assert.equal(extractChromeFromHtml(emptyChromePageHtml()), null)
})

test("extractChromeFromHtml extracts non-empty left/right content and rewrites relative URLs", () => {
  const chrome = extractChromeFromHtml(realPageHtml())
  assert.match(chrome.left, /id="explorer"/)
  assert.match(chrome.right, /id="graph-container"/)
  assert.match(chrome.extraCss, /href="\/component-explorer\.css"/)
})

test("extractChromeFromHtml strips toc/backlinks divs out of the right sidebar", () => {
  const html = realPageHtml({
    rightContent: '<div id="graph-container">graph</div><div class="toc">page toc</div><div class="backlinks">links</div>',
  })
  const chrome = extractChromeFromHtml(html)
  assert.match(chrome.right, /graph-container/)
  assert.doesNotMatch(chrome.right, /page toc/)
  assert.doesNotMatch(chrome.right, /backlinks/)
})

// --- findDonorChrome ----------------------------------------------------------

test("findDonorChrome prefers index.html when it is present and usable", () => {
  const dir = tmpDir("prefer-index")
  write(dir, "index", realPageHtml({ leftContent: "<div>FROM INDEX</div>" }))
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir)
  assert.match(chrome.left, /FROM INDEX/)
})

test("findDonorChrome falls back to another root page when index.html is absent", () => {
  const dir = tmpDir("fallback-root-page")
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir)
  assert.match(chrome.left, /FROM ENGAGEMENT/)
})

test("findDonorChrome never picks 404.html", () => {
  const dir = tmpDir("no-404")
  write(dir, "404", noSidebarPageHtml())
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir)
  assert.match(chrome.left, /FROM ENGAGEMENT/)
})

test("findDonorChrome never picks a nested page even when it is the only usable one", () => {
  const dir = tmpDir("no-nested")
  write(dir, "technical/context", realPageHtml({ leftContent: "<div>FROM NESTED</div>" }))
  const chrome = findDonorChrome(dir)
  assert.equal(chrome, null)
})

test("findDonorChrome never picks the emitters' own outputs (logs.html, onboarding.html)", () => {
  const dir = tmpDir("no-emitter-outputs")
  write(dir, "logs", realPageHtml({ leftContent: "<div>FROM LOGS</div>" }))
  write(dir, "onboarding", realPageHtml({ leftContent: "<div>FROM ONBOARDING</div>" }))
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir)
  assert.match(chrome.left, /FROM ENGAGEMENT/)
})

test("findDonorChrome never picks a page whose chrome is empty, even if otherwise eligible", () => {
  const dir = tmpDir("no-empty-chrome")
  write(dir, "index", emptyChromePageHtml())
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir)
  assert.match(chrome.left, /FROM ENGAGEMENT/)
})

test("findDonorChrome returns null when nothing suitable exists at all", () => {
  const dir = tmpDir("nothing-suitable")
  write(dir, "404", noSidebarPageHtml())
  write(dir, "logs", realPageHtml({ leftContent: "<div>FROM LOGS</div>" }))
  write(dir, "index", emptyChromePageHtml())
  const chrome = findDonorChrome(dir)
  assert.equal(chrome, null)
})

test("findDonorChrome returns null against an output directory that doesn't exist yet", () => {
  const chrome = findDonorChrome(path.join(os.tmpdir(), "brain-site-does-not-exist-xyz"))
  assert.equal(chrome, null)
})

test("findDonorChrome honours an explicit exclude set (the home-page-emitter circularity case)", () => {
  const dir = tmpDir("explicit-exclude")
  write(dir, "index", realPageHtml({ leftContent: "<div>FROM INDEX</div>" }))
  write(dir, "engagement", realPageHtml({ leftContent: "<div>FROM ENGAGEMENT</div>" }))
  const chrome = findDonorChrome(dir, new Set(["index"]))
  assert.match(chrome.left, /FROM ENGAGEMENT/)
  assert.doesNotMatch(chrome.left, /FROM INDEX/)
})
