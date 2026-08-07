import { test } from "node:test"
import assert from "node:assert/strict"
import { renderMarkdown } from "../src/lib/markdown/render.mjs"

test("renders an ATX heading", () => {
  assert.equal(renderMarkdown("# Title"), "<h1>Title</h1>")
  assert.equal(renderMarkdown("### Sub"), "<h3>Sub</h3>")
})
test("renders a simple paragraph", () => {
  assert.equal(renderMarkdown("Hello world."), "<p>Hello world.</p>")
})
test("soft-wraps consecutive lines into one paragraph", () => {
  assert.equal(renderMarkdown("Line one\nLine two."), "<p>Line one Line two.</p>")
})
test("a blank line separates paragraphs", () => {
  assert.equal(renderMarkdown("First.\n\nSecond."), "<p>First.</p>\n<p>Second.</p>")
})
test("renders bold and italic", () => {
  assert.equal(renderMarkdown("**bold** and *italic*"), "<p><strong>bold</strong> and <em>italic</em></p>")
})
test("renders inline code without applying inline rules inside it", () => {
  assert.equal(renderMarkdown("Use `**not bold**` here"), "<p>Use <code>**not bold**</code> here</p>")
})
test("renders a link", () => {
  assert.equal(renderMarkdown("[Loomery](https://loomery.com)"), '<p><a href="https://loomery.com">Loomery</a></p>')
})
test("renders an unordered list", () => {
  assert.equal(renderMarkdown("- a\n- b"), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>")
})
test("renders an ordered list", () => {
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol>\n<li>a</li>\n<li>b</li>\n</ol>")
})
test("renders a fenced code block verbatim, without inline rules or escaping surprises", () => {
  assert.equal(
    renderMarkdown("```\nconst x = 1 < 2\n```"),
    "<pre><code>const x = 1 &lt; 2</code></pre>"
  )
})
test("renders a blockquote", () => {
  assert.equal(renderMarkdown("> quoted text"), "<blockquote><p>quoted text</p></blockquote>")
})
test("renders a horizontal rule", () => {
  assert.equal(renderMarkdown("---"), "<hr>")
})
test("escapes raw HTML-significant characters in plain text", () => {
  assert.equal(renderMarkdown("a < b & c > d"), "<p>a &lt; b &amp; c &gt; d</p>")
})
test("a realistic log-entry excerpt renders without throwing and preserves structure", () => {
  const md = [
    "# 2026-01-01 — Did a thing",
    "",
    "**Agent:** Claude Code (Sonnet 5)",
    "",
    "**Changed:** `sources.yaml`, `docs/engagement.md`",
    "",
    "**Grounded in:**",
    "- Granola folder \"Acme\"",
    "- Slack `#delivery-acme`",
    "",
    "**Assumed:** nothing unusual.",
  ].join("\n")
  const html = renderMarkdown(md)
  assert.match(html, /<h1>2026-01-01 — Did a thing<\/h1>/)
  assert.match(html, /<strong>Agent:<\/strong> Claude Code \(Sonnet 5\)/);
  assert.match(html, /<code>sources\.yaml<\/code>/)
  assert.match(html, /<ul>\n<li>Granola folder/)
  assert.match(html, /<code>#delivery-acme<\/code>/)
});
