// Walks a docs root, hand-parses each file's frontmatter, and runs it through
// src/lib/audience/validate.mjs's validateDocs. Prints `<slug>: <message>`
// per error and returns non-zero if any file fails.
//
// Zero dependencies by design — this is a hand-rolled reader for the flat keys this
// repo actually uses (`audience`, `status`, `roles`, and a nested
// `onboarding.prerequisites`), not a general YAML parser. It only needs to understand
// the inline-array style (`audience: [internal, client]`) that every doc in this repo
// uses today; it does not support YAML block-list (`- item`) syntax.
//
// Known limitation: validateDocs checks that every `prerequisites` slug
// resolves against the *whole* docs/ tree. It cannot tell whether a
// prerequisite that resolves here would still resolve inside a client-only
// build (i.e. an internal-only doc used as a prerequisite for a client-visible
// one). That gap is tracked as design doc §15 open question 5 — not fixed here.
//
// Ported from the brain's brain-plugins/validate-cli.mjs. Two changes only: the docs
// root is a parameter instead of derived from the script's own location, and this
// exports a function instead of calling main() at import time. Everything else —
// SKIP_DIRS, walk, the frontmatter parser, toSlug, and every output string — is
// verbatim; Task 8's diff depends on identical behaviour.

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, extname } from "node:path"
import { validateDocs } from "../lib/audience/validate.mjs"

// Transient / non-content directories — never validated, per AGENTS.md
// ("docs/inbox/ is transient") and the plan (source-materials is raw input,
// not a doc in the onboarding contract).
const SKIP_DIRS = new Set(["inbox", "source-materials"])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(join(dir, entry.name), out)
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

function stripQuotes(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function parseInlineArray(raw) {
  const inner = raw.trim()
  if (inner === "") return []
  return inner
    .split(",")
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0)
}

// Parses only what this repo's frontmatter actually contains: flat
// `key: value` and `key: [a, b]` lines, plus one level of nesting under
// `onboarding:`. Anything else (multi-line block scalars, anchors, block
// lists) is simply not read — these keys don't use them today.
function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") return {}

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i
      break
    }
  }
  if (end === -1) return {}

  const frontmatter = {}
  let blockKey = null

  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = line.match(/^\s*/)[0].length

    if (indent === 0) {
      blockKey = null
      const arrayMatch = line.match(/^([A-Za-z0-9_]+):\s*\[(.*)\]\s*$/)
      const blockMatch = line.match(/^([A-Za-z0-9_]+):\s*$/)
      const scalarMatch = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/)
      if (arrayMatch) {
        frontmatter[arrayMatch[1]] = parseInlineArray(arrayMatch[2])
      } else if (blockMatch) {
        blockKey = blockMatch[1]
        frontmatter[blockKey] = {}
      } else if (scalarMatch) {
        frontmatter[scalarMatch[1]] = stripQuotes(scalarMatch[2])
      }
    } else if (blockKey) {
      const trimmed = line.trim()
      const arrayMatch = trimmed.match(/^([A-Za-z0-9_]+):\s*\[(.*)\]\s*$/)
      const scalarMatch = trimmed.match(/^([A-Za-z0-9_]+):\s*(.+)$/)
      if (arrayMatch) {
        frontmatter[blockKey][arrayMatch[1]] = parseInlineArray(arrayMatch[2])
      } else if (scalarMatch) {
        frontmatter[blockKey][scalarMatch[1]] = stripQuotes(scalarMatch[2])
      }
    }
  }

  return frontmatter
}

function toSlug(filePath, docsRoot) {
  const rel = relative(docsRoot, filePath).replace(/\\/g, "/")
  return rel.slice(0, -extname(rel).length)
}

export function runValidate({ docsRoot }) {
  const files = walk(docsRoot)
  const docs = files.map((filePath) => ({
    slug: toSlug(filePath, docsRoot),
    frontmatter: parseFrontmatter(readFileSync(filePath, "utf8")),
  }))

  const { ok, errors } = validateDocs(docs)

  if (!ok) {
    for (const { slug, message } of errors) {
      console.error(`${slug}: ${message}`)
    }
    const failingDocs = new Set(errors.map((e) => e.slug)).size
    console.error(`\n${errors.length} error(s) across ${failingDocs} file(s).`)
    return 1
  }

  console.log(`ok: ${docs.length} docs validated, 0 errors.`)
  return 0
}
