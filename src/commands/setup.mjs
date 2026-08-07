// One-time (and safe-to-rerun) setup for a brain's local Quartz v5 browsing site.
//
// Ported from the generator's templates/optional-site/site/init-quartz.mjs. This repo
// does NOT vendor Quartz's ~300-file upstream checkout — that would be unmaintainable
// to carry here. Instead this fetches it fresh on first use and lays it down inside a
// disposable, gitignored `.brain-site/` directory at the repository root — never at the
// root itself, so nothing generated ever collides with the two files a brain tracks:
// `package.json` (the `@loomery/brain-site` version pin) and `brain-site.yaml` (the
// override). `setup` must never read, write, or merge into the root `package.json` —
// see the design doc for why a generated file and a tracked file were once forced to
// share a path, and why that was the bug.
//
// What it does, in order:
//   1. Refuse to continue on Node < 22 (Quartz v5's own requirement).
//   2. Read <rootDir>/brain-site.yaml, validate it, and resolve its `content` and
//      `sections.timeline.source` paths (relative to rootDir) to absolute paths, so
//      nothing downstream has to know or guess what directory it's running from.
//   3. If <rootDir>/.brain-site/quartz/build.ts doesn't exist yet, `git clone --depth 1`
//      the upstream Quartz repo into a scratch directory, strip its .git, and merge it
//      into .brain-site/ — skipping any path that already exists there, so this
//      package's own quartz.ts and plugins/ are never overwritten by the clone.
//      Quartz's own package.json lands in .brain-site/ and is used as-is; it is never
//      merged with anything.
//   4. Copy this package's quartz.ts, plugins/**, styles/** and fonts/** into
//      .brain-site/ — these are authoritative and always win.
//   5. Merge the resolved override onto the shipped base config, and write the result
//      to .brain-site/quartz.config.yaml.
//   6. `npm i` and `npx quartz plugin install --from-config` inside .brain-site/.
//   7. When `then` is "build" or "serve", run `npx quartz build [-d <content>]
//      [--serve]` inside .brain-site/.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import { validateOverride } from "../config/schema.mjs"
import { mergeConfig } from "../config/merge.mjs"

const QUARTZ_REPO_URL = "https://github.com/jackyzha0/quartz.git"
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const assetsDir = path.join(packageDir, "assets")
const GENERATED_DIR_NAME = ".brain-site"
const DEFAULT_TIMELINE_SOURCE = "logs"

function log(message) {
  process.stdout.write(`[brain-site] ${message}\n`)
}

function logError(message) {
  process.stderr.write(`[brain-site] ${message}\n`)
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0])
  if (major < 22) {
    logError(
      `Node ${process.versions.node} is too old — Quartz v5 needs Node >= 22. ` +
        `Run \`nvm use 22\` (or \`nvm install 22\` if you don't have it yet), then re-run this command.`,
    )
    return false
  }
  return true
}

// Top-level entries inside .brain-site/ this package already owns before any clone
// ever runs. Reserved names are skipped outright at the TOP LEVEL ONLY, before even
// looking at whether they're a file or a directory. `content` stays reserved so a stray
// upstream `content/` (Quartz's own example vault) never lands here and is never
// confused with the brain's real content root, which this package resolves from
// brain-site.yaml's `content:` key instead of any fixed path.
const RESERVED_TOP_LEVEL = new Set(["quartz.ts", "quartz.config.yaml", "content", "plugins"])

// Copies src -> dest recursively. Directories always recurse (merging their contents)
// rather than being skipped whole just because the directory itself already exists.
// Skipping happens at the leaf (file) level instead: a file that already exists at the
// destination is left alone (this package's own version wins), everything else is
// copied from the fresh clone. `reserved` is only ever passed on the initial top-level
// call. `root` is the top-level generated directory the skip log is reported relative
// to — it defaults to `dest` on the initial (non-recursive) call and is threaded
// through unchanged on every recursive call, so a collision several directories deep
// still logs a path locatable from the generated directory rather than just a basename
// relative to whichever subdirectory the recursion happens to be in.
function mergeCopy(src, dest, { skippedForLog, reserved = null, root = dest }) {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const to = path.join(dest, entry.name)
    if (reserved && reserved.has(entry.name)) {
      skippedForLog.push(path.relative(root, to))
      continue
    }
    const from = path.join(src, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      mergeCopy(from, to, { skippedForLog, root })
      continue
    }
    if (fs.existsSync(to)) {
      skippedForLog.push(path.relative(root, to))
      continue
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}

function vendorQuartz(generatedDir) {
  // quartz/build.ts only ever comes from the upstream clone (this package's own
  // assets never ship a file by that name — they only ever land quartz/styles/*.scss
  // and quartz/static/fonts/*.otf under quartz/, via copyPackageAssets, clone or no
  // clone), so its presence is unambiguous evidence the vendor step already ran.
  const vendoredMarker = path.join(generatedDir, "quartz", "build.ts")
  if (fs.existsSync(vendoredMarker)) {
    log("quartz/build.ts already present — skipping the clone.")
    return
  }

  fs.mkdirSync(generatedDir, { recursive: true })

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "brain-site-vendor-"))
  try {
    log(`Cloning ${QUARTZ_REPO_URL} (shallow) ...`)
    execFileSync("git", ["clone", "--depth", "1", QUARTZ_REPO_URL, tmpDir], { stdio: "inherit" })
    fs.rmSync(path.join(tmpDir, ".git"), { recursive: true, force: true })

    // Upstream ships its own quartz.config.yaml (the "default" project config, meant
    // to be replaced by whoever installs Quartz) — this package generates its own at
    // quartz.config.yaml, so rename upstream's instead of letting mergeCopy skip it
    // silently. Kept purely as a reference; Quartz never reads this filename.
    const upstreamConfig = path.join(tmpDir, "quartz.config.yaml")
    if (fs.existsSync(upstreamConfig)) {
      fs.renameSync(upstreamConfig, path.join(tmpDir, "quartz.config.default.yaml"))
    }

    // Quartz's own package.json (its `bin.quartz` entry and the ~80 dependencies it
    // needs to build) lands in .brain-site/ untouched — it is generated, gitignored,
    // and disposable, same as everything else here. It must never be merged with the
    // brain's own root package.json (that file is tracked and holds nothing but the
    // version pin) — see the file banner.
    log("Merging into the generated directory (skipping this package's own files) ...")
    const skipped = []
    mergeCopy(tmpDir, generatedDir, { skippedForLog: skipped, reserved: RESERVED_TOP_LEVEL })
    if (skipped.length > 0) {
      log(`Kept this package's own version of: ${skipped.join(", ")}`)
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// Copies this package's own authoritative files — quartz.ts, plugins/**, styles/**,
// fonts/** — into the generated tree. Always overwrites: unlike the upstream merge,
// these are ours and always win. Fonts are binary; copied with fs.cpSync (which uses
// copyFileSync under the hood), never through any text-processing path.
function copyPackageAssets(generatedDir) {
  fs.copyFileSync(path.join(assetsDir, "quartz.ts"), path.join(generatedDir, "quartz.ts"))

  const pluginsSrc = path.join(assetsDir, "plugins")
  if (fs.existsSync(pluginsSrc)) {
    fs.cpSync(pluginsSrc, path.join(generatedDir, "plugins"), { recursive: true, force: true })
  }

  const stylesDest = path.join(generatedDir, "quartz", "styles")
  fs.mkdirSync(stylesDest, { recursive: true })
  for (const file of fs.readdirSync(path.join(assetsDir, "styles"))) {
    fs.copyFileSync(path.join(assetsDir, "styles", file), path.join(stylesDest, file))
  }

  const fontsDest = path.join(generatedDir, "quartz", "static", "fonts")
  fs.mkdirSync(fontsDest, { recursive: true })
  for (const file of fs.readdirSync(path.join(assetsDir, "fonts"))) {
    fs.copyFileSync(path.join(assetsDir, "fonts", file), path.join(fontsDest, file))
  }
}

// Reads <rootDir>/brain-site.yaml, validates it, and returns the parsed override — or
// null plus printed errors on failure. An empty (or missing-keys) file parses to
// `null`, which validateOverride treats as an empty override.
function readOverride(rootDir) {
  const overridePath = path.join(rootDir, "brain-site.yaml")
  let raw
  try {
    raw = fs.readFileSync(overridePath, "utf8")
  } catch (err) {
    logError(`could not read ${overridePath}: ${err.message}`)
    return { override: null, ok: false }
  }

  const parsed = YAML.parse(raw)
  const { ok, errors } = validateOverride(parsed)
  if (!ok) {
    for (const message of errors) logError(message)
    return { override: null, ok: false }
  }
  return { override: parsed, ok: true }
}

// Resolves the override's brain-relative path fields (`content`,
// `sections.timeline.source`) against rootDir into absolute paths, before they reach
// the generated config or the build command's `-d` flag. This is the one place that
// does this arithmetic — everything downstream (mergeConfig, the `-d` flag, the
// logs-timeline-emitter plugin) receives an already-absolute path and never has to know
// what directory it's running from or work out a relative offset to rootDir.
// `sections.timeline.source`'s default (when `sections.timeline` is declared but
// `source` is omitted) is "logs" — a sibling of the tracked brain-site.yaml at rootDir
// — resolved the same way as an explicit value.
function resolveOverridePaths(rootDir, override) {
  if (!override) return override
  const resolved = { ...override }

  if (typeof override.content === "string" && override.content.length > 0) {
    resolved.content = path.resolve(rootDir, override.content)
  }

  const timeline = override.sections?.timeline
  if (timeline !== undefined) {
    const source =
      typeof timeline.source === "string" && timeline.source.length > 0
        ? timeline.source
        : DEFAULT_TIMELINE_SOURCE
    resolved.sections = {
      ...override.sections,
      timeline: { ...timeline, source: path.resolve(rootDir, source) },
    }
  }

  return resolved
}

function writeConfig(generatedDir, resolvedOverride) {
  const basePath = path.join(assetsDir, "quartz.config.base.yaml")
  const base = YAML.parse(fs.readFileSync(basePath, "utf8"))
  const merged = mergeConfig(base, resolvedOverride ?? {})
  fs.writeFileSync(path.join(generatedDir, "quartz.config.yaml"), YAML.stringify(merged))
  return merged
}

function installAndConfigurePlugins(generatedDir) {
  log("npm install ...")
  execFileSync("npm", ["i"], { cwd: generatedDir, stdio: "inherit" })

  log("Installing plugins declared in quartz.config.yaml ...")
  log(
    "(if you see a build-failed warning for onboarding-emitter, logs-timeline-emitter " +
      "or audience-filter below — that's expected and harmless. The installer tries to " +
      "npm-install/build every local plugin as if it were a package; a bare .ts file has " +
      "no package.json, so it \"fails\" that step, but the plugin is still symlinked in " +
      "and loads and runs fine.)",
  )
  execFileSync("npx", ["quartz", "plugin", "install", "--from-config"], {
    cwd: generatedDir,
    stdio: "inherit",
  })
}

function runBuild(generatedDir, resolvedOverride, { serve }) {
  const args = ["quartz", "build"]
  const content = resolvedOverride?.content
  if (typeof content === "string" && content.length > 0) {
    args.push("-d", content)
  }
  if (serve) args.push("--serve")
  execFileSync("npx", args, { cwd: generatedDir, stdio: "inherit" })
}

export async function runSetup({ rootDir, then }) {
  if (!checkNodeVersion()) return 1

  const { override, ok } = readOverride(rootDir)
  if (!ok) return 1
  const resolvedOverride = resolveOverridePaths(rootDir, override)

  const generatedDir = path.join(rootDir, GENERATED_DIR_NAME)

  vendorQuartz(generatedDir)
  copyPackageAssets(generatedDir)
  writeConfig(generatedDir, resolvedOverride)

  installAndConfigurePlugins(generatedDir)

  if (then === "build" || then === "serve") {
    runBuild(generatedDir, resolvedOverride, { serve: then === "serve" })
  } else {
    log("Done. Next: npx brain-site build   or   npx brain-site serve")
  }

  return 0
}
