#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import YAML from "yaml"
import { runSetup } from "../src/commands/setup.mjs"
import { runValidate } from "../src/commands/validate.mjs"

function flag(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = argv[i + 1]
  if (value === undefined || value.startsWith("--")) {
    process.stderr.write(`brain-site: --${name} requires a value\n`)
    process.stderr.write(`usage: brain-site <setup|build|serve|validate>\n`)
    process.exit(1)
  }
  return value
}

// This package may know a brain's frontmatter conventions; it must never know a brain's
// paths. `validate` therefore takes its docs root from the brain's own brain-site.yaml
// `content:` key — the same key `setup` and `build` resolve — rather than assuming
// "docs", which only ever worked because the first consumer happened to use that name.
// A brain with `content: notes` used to get "docs directory not found" from the bare
// `npx brain-site validate` its own AGENTS.md tells it to run.
//
// Returns null if there is no readable/usable `content:` — the caller falls back and
// says so, rather than failing on a repo that has no override file at all.
function contentFromOverride(rootDir) {
  const overridePath = path.join(rootDir, "brain-site.yaml")
  let raw
  try {
    raw = fs.readFileSync(overridePath, "utf8")
  } catch {
    return null
  }
  let parsed
  try {
    parsed = YAML.parse(raw)
  } catch (err) {
    process.stderr.write(`brain-site: could not parse ${overridePath}: ${err.message}\n`)
    return null
  }
  const content = parsed?.content
  return typeof content === "string" && content.length > 0 ? content : null
}

const DEFAULT_DOCS_DIR = "docs"

const [command, ...argv] = process.argv.slice(2)
const rootDir = process.cwd()

switch (command) {
  case "setup":
    process.exit(await runSetup({ rootDir }))
  case "validate": {
    const override = flag(argv, "docs", null)
    const fromConfig = override === null ? contentFromOverride(rootDir) : null
    const dir = override ?? fromConfig ?? DEFAULT_DOCS_DIR
    const fellBack = override === null && fromConfig === null
    process.exit(
      runValidate({
        docsRoot: path.resolve(rootDir, dir),
        // The two dashboard files live at the repository root by convention, so
        // validating them needs the root itself — not the docs directory, which
        // a brain can point anywhere via `content:`.
        rootDir,
        // Only set when neither --docs nor brain-site.yaml's `content:` supplied the
        // path, so a "not found" error can say where the path came from.
        sourceHint: fellBack
          ? `no --docs flag and no usable \`content:\` in brain-site.yaml, so this fell back to "${DEFAULT_DOCS_DIR}"`
          : null,
      }),
    )
  }
  case "build":
  case "serve":
    process.exit(await runSetup({ rootDir, then: command }))
  default:
    process.stderr.write(`brain-site: unknown command "${command ?? ""}"\n`)
    process.stderr.write(`usage: brain-site <setup|build|serve|validate>\n`)
    process.exit(1)
}
