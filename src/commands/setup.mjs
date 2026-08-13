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
//   2. Read <rootDir>/brain-site.yaml, validate it, and resolve its `content`,
//      `sections.timeline.source` and `static` paths (relative to rootDir) to absolute
//      paths, so nothing downstream has to know or guess what directory it's running
//      from.
//   3. Register .brain-site/ in <rootDir>/.git/info/exclude — NOT .gitignore — before
//      the directory exists. See "Why the generated tree is excluded, not gitignored"
//      below.
//   4. If <rootDir>/.brain-site/quartz/build.ts doesn't exist yet, `git clone --depth 1`
//      the upstream Quartz repo into a scratch directory, strip its .git, and merge it
//      into .brain-site/ — skipping any path that already exists there, so this
//      package's own quartz.ts and plugins/ are never overwritten by the clone.
//      Quartz's own package.json lands in .brain-site/ and is used as-is; it is never
//      merged with anything.
//   5. Copy this package's quartz.ts, plugins/**, styles/** and fonts/** into
//      .brain-site/ — these are authoritative and always win.
//   6. If `static:` is set, copy its contents into .brain-site/quartz/static/. Brain-owned
//      content always wins and stale copies are pruned; only this package's own fonts/**
//      is protected from being clobbered. See copyBrainStatic.
//   7. Merge the resolved override onto the shipped base config, and write the result
//      to .brain-site/quartz.config.yaml.
//   8. `npm i` and `npx quartz plugin install --from-config` inside .brain-site/.
//   9. When `then` is "build" or "serve", run `npx quartz build [-d <content>]
//      [--serve]` inside .brain-site/.
//
// Why the generated tree is excluded, not gitignored (design doc §2.6): Quartz's
// Static emitter copies quartz/static/** via globby(pattern, { gitignore: true }).
// globby only reads .gitignore files — if .brain-site/ is listed there, every file
// beneath it matches an ignore rule and globby returns nothing, so fonts, the favicon,
// the OG image and any brain-owned static/ content silently vanish from the build
// while sitting on disk untouched. git/info/exclude gets git the same "don't track
// this" result without a .gitignore file for globby to read.

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import { validateOverride } from "../config/schema.mjs"
import { mergeConfig, TIMELINE_DEFAULTS } from "../config/merge.mjs"

const QUARTZ_REPO_URL = "https://github.com/jackyzha0/quartz.git"
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const assetsDir = path.join(packageDir, "assets")
const GENERATED_DIR_NAME = ".brain-site"
// Imported, never restated: merge.mjs holds the one copy of the timeline defaults.
const DEFAULT_TIMELINE_SOURCE = TIMELINE_DEFAULTS.source

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

// Normalizes a .gitignore/.git/info/exclude line for comparison against
// GENERATED_DIR_NAME: strips a leading "/" (an anchor to the file's own directory,
// still the repo root here) and any trailing "/" (directory marker) or "/**".
function normalizeIgnoreLine(line) {
  return line
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/\*\*$/, "")
    .replace(/\/+$/, "")
}

// If the brain's own .gitignore already lists .brain-site/, that ignore rule is what
// makes globby's `{ gitignore: true }` treat every file beneath it as ignored — see the
// file banner. This is now a bug in the *consuming* repo, not something setup can fix
// on its brain-site.yaml — write access to .gitignore is that repo's, so setup never
// edits it. It does refuse to continue: returns false, and the caller exits non-zero.
// A warning was not enough — the consequence is every static asset silently dropped from
// the build, and a warning is one block in a wall of `npm i` output.
function checkGitignoreForConflict(rootDir) {
  const gitignorePath = path.join(rootDir, ".gitignore")
  let contents
  try {
    contents = fs.readFileSync(gitignorePath, "utf8")
  } catch {
    return true
  }

  const hasConflict = contents
    .split(/\r?\n/)
    .some((line) => line.trim().length > 0 && normalizeIgnoreLine(line) === GENERATED_DIR_NAME)

  if (hasConflict) {
    logError("=".repeat(72))
    logError(
      `ERROR: .gitignore lists "${GENERATED_DIR_NAME}/". This silently breaks the ` +
        "build: Quartz's Static emitter copies quartz/static/** using globby's " +
        "{ gitignore: true } option, which reads .gitignore files, so every font, the " +
        "favicon, the OG image and any brain-owned static/ content beneath " +
        `${GENERATED_DIR_NAME}/ will be treated as ignored and silently dropped from ` +
        "every build.",
    )
    logError(
      `Remove the "${GENERATED_DIR_NAME}/" line from .gitignore — setup already keeps ` +
        `${GENERATED_DIR_NAME}/ out of git via .git/info/exclude, which globby never reads.`,
    )
    logError("=".repeat(72))
    return false
  }

  return true
}

// Resolves the git directory whose info/exclude git actually reads for rootDir.
//
// Ask git rather than parse: `git rev-parse --git-common-dir` returns the *common* git
// directory, which is the only one whose `info/exclude` git consults. That distinction
// is the whole point of this function. In a linked worktree, `.git` is a *file* pointing
// at `<main>/.git/worktrees/<name>/` — the per-worktree git dir. Writing `info/exclude`
// there has no effect at all: git reads exclude patterns only from the common dir, so
// `.brain-site/` stays untracked-and-visible, and the next `git add -A` in that worktree
// commits ~1,500 files of upstream Quartz. (For a submodule the two coincide, so the old
// gitdir-pointer parse happened to be right there and wrong here.)
//
// Falls back to the gitdir-pointer parse only if git itself can't be run. Returns null
// when neither shape is found, rather than throwing — the caller treats that as "not a
// git repo (or one setup can't find)" and continues without exclude support.
function findGitDir(rootDir) {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    if (out.length > 0) {
      // Relative output (commonly a bare ".git") is relative to the repository root,
      // which is the cwd we asked from.
      return path.isAbsolute(out) ? out : path.resolve(rootDir, out)
    }
  } catch {
    // git missing, or rootDir is not inside a work tree — fall through.
  }

  return findGitDirWithoutGit(rootDir)
}

// Fallback for when the `git` binary isn't available: read <rootDir>/.git directly.
// Correct for a plain repo and for a submodule; for a linked worktree it can only find
// the per-worktree git dir, which is why it is the fallback and not the primary path.
function findGitDirWithoutGit(rootDir) {
  const gitPath = path.join(rootDir, ".git")
  let stat
  try {
    stat = fs.statSync(gitPath)
  } catch {
    return null
  }

  if (stat.isDirectory()) return gitPath

  if (stat.isFile()) {
    const contents = fs.readFileSync(gitPath, "utf8")
    const match = contents.match(/^gitdir:\s*(.+)$/m)
    if (!match) return null
    const gitDir = match[1].trim()
    const resolved = path.isAbsolute(gitDir) ? gitDir : path.resolve(rootDir, gitDir)
    // A linked worktree's git dir is <common>/worktrees/<name>; the common dir is two
    // levels up. Only the common dir's info/exclude is ever read.
    const parts = resolved.split(path.sep)
    if (parts.length >= 3 && parts[parts.length - 2] === "worktrees") {
      return parts.slice(0, -2).join(path.sep)
    }
    return resolved
  }

  return null
}

// Registers .brain-site/ in .git/info/exclude — never .gitignore (see the file
// banner) — so git ignores the generated tree without globby ever seeing a rule for
// it. Idempotent: checks for an existing entry (in whatever form — with or without a
// leading/trailing slash) before appending, so re-running setup never duplicates the
// line. Must run before the generated directory is created, so there is no window in
// which it exists un-ignored.
//
// Returns false only when the consuming repo's .gitignore conflicts (see
// checkGitignoreForConflict) — that is fatal, and setup exits non-zero. A repo with no
// git dir at all is not fatal: it warns and returns true.
function ensureGitExclude(rootDir) {
  if (!checkGitignoreForConflict(rootDir)) return false

  const gitDir = findGitDir(rootDir)
  if (gitDir === null) {
    logError(
      `could not locate a .git directory at or above ${rootDir} — skipping ` +
        `.git/info/exclude setup. ${GENERATED_DIR_NAME}/ will not be automatically ` +
        "ignored by git; if this is a real git repository, add it yourself.",
    )
    return true
  }

  const infoDir = path.join(gitDir, "info")
  fs.mkdirSync(infoDir, { recursive: true })
  const excludePath = path.join(infoDir, "exclude")

  let existing = ""
  try {
    existing = fs.readFileSync(excludePath, "utf8")
  } catch {
    existing = ""
  }

  const alreadyPresent = existing
    .split(/\r?\n/)
    .some((line) => line.trim().length > 0 && normalizeIgnoreLine(line) === GENERATED_DIR_NAME)
  if (alreadyPresent) return true

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n")
  fs.appendFileSync(
    excludePath,
    `${needsLeadingNewline ? "\n" : ""}${GENERATED_DIR_NAME}/\n`,
  )
  return true
}

// Top-level entries inside .brain-site/ this package already owns before any clone
// ever runs. Reserved names are skipped outright at the TOP LEVEL ONLY, before even
// looking at whether they're a file or a directory. `content` stays reserved so a stray
// upstream `content/` (Quartz's own example vault) never lands here and is never
// confused with the brain's real content root, which this package resolves from
// brain-site.yaml's `content:` key instead of any fixed path.
const RESERVED_TOP_LEVEL = new Set(["quartz.ts", "quartz.config.yaml", "content", "plugins"])

// Top-level entries of quartz/static/ that this package owns and a brain's `static:`
// must never clobber — see copyBrainStatic. Only the fonts this package ships.
const PACKAGE_OWNED_STATIC = new Set(["fonts"])

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

// Merges resolvedOverride.static (already an absolute path — see resolveOverridePaths)
// into .brain-site/quartz/static/, so a brain's own images resolve at the /static/**
// URLs it embeds them with, without this shared package carrying anything
// client-specific. A no-op when `static:` is unset — most brains won't set it.
//
// Brain-owned content always wins here, the same way copyPackageAssets' files always
// win. This deliberately does NOT reuse mergeCopy's skip-if-exists leaf rule: under that
// rule an author who regenerated assets/static/<name> got the previous run's copy served
// forever, and the log blamed the package ("kept this package's own version of ...") for
// what was actually the brain's own stale file.
//
// Ownership, per top-level entry of the brain's static directory:
//   - a directory (other than fonts/) — the brain owns that whole subtree: it is removed
//     and re-copied, so an edited file is refreshed AND a deleted one stops being
//     published.
//   - a file — overwritten from the brain.
//   - fonts/ — the one exception. copyPackageAssets has already placed this package's
//     own .otf files there, and those must not be clobbered, so inside fonts/ the
//     package's version wins and brain-only files merge in around it. Nothing under
//     fonts/ is pruned.
// Everything the brain does not name (upstream Quartz's own icon.png, og-image.png,
// giscus/) is left untouched — it is not brain-owned, so its absence from the brain's
// static directory says nothing.
//
// Returns false (after logging a clear error, not throwing) if `static:` names a path
// that doesn't exist or isn't a directory, so setup can fail cleanly rather than crash.
function copyBrainStatic(generatedDir, resolvedOverride) {
  const staticSrc = resolvedOverride?.static
  if (typeof staticSrc !== "string" || staticSrc.length === 0) return true

  let stat
  try {
    stat = fs.statSync(staticSrc)
  } catch {
    logError(`static: directory not found: ${staticSrc}`)
    return false
  }
  if (!stat.isDirectory()) {
    logError(`static: not a directory: ${staticSrc}`)
    return false
  }

  const dest = path.join(generatedDir, "quartz", "static")
  fs.mkdirSync(dest, { recursive: true })

  const keptForLog = []
  for (const entry of fs.readdirSync(staticSrc, { withFileTypes: true })) {
    const from = path.join(staticSrc, entry.name)
    const to = path.join(dest, entry.name)

    if (PACKAGE_OWNED_STATIC.has(entry.name)) {
      mergeCopy(from, to, { skippedForLog: keptForLog, root: dest })
      continue
    }

    if (entry.isDirectory()) {
      fs.rmSync(to, { recursive: true, force: true })
      fs.cpSync(from, to, { recursive: true, force: true })
      continue
    }

    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  if (keptForLog.length > 0) {
    log(`static: kept this package's own version of: ${keptForLog.join(", ")}`)
  }
  return true
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
// `sections.timeline.source`, `static`) against rootDir into absolute paths, before
// they reach the generated config or the build command's `-d` flag. This is the one
// place that does this arithmetic — everything downstream (mergeConfig, the `-d` flag,
// the logs-timeline-emitter plugin, copyBrainStatic) receives an already-absolute path
// and never has to know what directory it's running from or work out a relative offset
// to rootDir. `sections.timeline.source`'s default (when `sections.timeline` is
// declared but `source` is omitted) is "logs" — a sibling of the tracked
// brain-site.yaml at rootDir — resolved the same way as an explicit value. `static` has
// no default: an unset `static` stays unset, since most brains don't have one.
function resolveOverridePaths(rootDir, override) {
  if (!override) return override
  const resolved = { ...override }

  if (typeof override.content === "string" && override.content.length > 0) {
    resolved.content = path.resolve(rootDir, override.content)
  }

  if (typeof override.static === "string" && override.static.length > 0) {
    resolved.static = path.resolve(rootDir, override.static)
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

function writeConfig(generatedDir, resolvedOverride, rootDir) {
  const basePath = path.join(assetsDir, "quartz.config.base.yaml")
  const base = YAML.parse(fs.readFileSync(basePath, "utf8"))
  const merged = mergeConfig(base, resolvedOverride ?? {}, rootDir)
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

  // Must run before the generated directory can possibly exist — see the file banner
  // and design doc §2.6. A .gitignore conflict is fatal, not a warning: continuing
  // produces a build with every static asset silently missing.
  if (!ensureGitExclude(rootDir)) return 1

  const generatedDir = path.join(rootDir, GENERATED_DIR_NAME)

  vendorQuartz(generatedDir)
  copyPackageAssets(generatedDir)
  if (!copyBrainStatic(generatedDir, resolvedOverride)) return 1
  writeConfig(generatedDir, resolvedOverride, rootDir)

  installAndConfigurePlugins(generatedDir)

  if (then === "build" || then === "serve") {
    runBuild(generatedDir, resolvedOverride, { serve: then === "serve" })
  } else {
    log("Done. Next: npx brain-site build   or   npx brain-site serve")
  }

  return 0
}

// Exported for test/setup-units.test.mjs only. This module carries every filesystem and
// git side effect in the package, so its pure-ish helpers are tested directly against
// real temporary directories rather than through runSetup (which clones and npm-installs).
export {
  findGitDir,
  findGitDirWithoutGit,
  ensureGitExclude,
  checkGitignoreForConflict,
  copyBrainStatic,
  copyPackageAssets,
  resolveOverridePaths,
}
