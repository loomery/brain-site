// One-time (and safe-to-rerun) setup for a brain's local Quartz v5 browsing site.
//
// Ported from the generator's templates/optional-site/site/init-quartz.mjs. This repo
// does NOT vendor Quartz's ~300-file upstream checkout — that would be unmaintainable
// to carry here. Instead this fetches it fresh on first use and lays it down *around*
// the files this package ships (quartz.ts, plugins/, styles/, fonts/) and the files the
// consuming brain ships (brain-site.yaml).
//
// What it does, in order:
//   1. Refuse to continue on Node < 22 (Quartz v5's own requirement).
//   2. If <siteDir>/quartz/ doesn't exist yet, `git clone --depth 1` the upstream Quartz
//      repo into a scratch directory, strip its .git, and merge it into siteDir —
//      skipping any path that already exists there, so this package's own quartz.ts,
//      plugins/ and this script's own outputs are never overwritten by the clone.
//   3. Copy this package's quartz.ts, plugins/**, styles/** and fonts/** into siteDir —
//      these are authoritative and always win.
//   4. Read <siteDir>/brain-site.yaml, validate it, merge it onto the shipped base
//      config, and write the result to <siteDir>/quartz.config.yaml.
//   5. `npm i` and `npx quartz plugin install --from-config` inside siteDir.
//   6. When `then` is "build" or "serve", run `npx quartz build [-d <content>]
//      [--serve]`.

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

// siteDir entries this package (or the consuming brain) already owns before any clone
// ever runs. Reserved names are skipped outright at the TOP LEVEL ONLY, before even
// looking at whether they're a file or a directory — `content` is the load-bearing
// case in the original design (a symlink to ../docs); this package instead resolves
// the content root from brain-site.yaml's `content:` key and never creates that
// symlink, but the name stays reserved so a stray upstream `content/` (Quartz's own
// example vault) never lands here.
const RESERVED_TOP_LEVEL = new Set([
  "quartz.ts",
  "quartz.config.yaml",
  "content",
  "plugins",
  "brain-site.yaml",
])

// Copies src -> dest recursively. Directories always recurse (merging their contents)
// rather than being skipped whole just because the directory itself already exists.
// Skipping happens at the leaf (file) level instead: a file that already exists at the
// destination is left alone (this package's or the brain's own version wins),
// everything else is copied from the fresh clone. `reserved` is only ever passed on
// the initial top-level call. `root` is the top-level site directory the skip log is
// reported relative to — it defaults to `dest` on the initial (non-recursive) call and
// is threaded through unchanged on every recursive call, so a collision several
// directories deep still logs a path locatable from siteDir rather than just a
// basename relative to whichever subdirectory the recursion happens to be in.
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

function vendorQuartz(siteDir) {
  // NOT siteDir/quartz/ itself — see copyPackageAssets, which always lands
  // quartz/styles/*.scss and quartz/static/fonts/*.otf there, clone or no clone.
  // siteDir/package.json is unambiguous: it only ever exists after a real vendor
  // (this function never creates it), and it's also the literal file `npm i` needs.
  const vendoredMarker = path.join(siteDir, "package.json")
  if (fs.existsSync(vendoredMarker)) {
    log("package.json already present — skipping the clone.")
    return
  }

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

    log("Merging into the site directory (skipping this package's own files) ...")
    const skipped = []
    mergeCopy(tmpDir, siteDir, { skippedForLog: skipped, reserved: RESERVED_TOP_LEVEL })
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
function copyPackageAssets(siteDir) {
  fs.copyFileSync(path.join(assetsDir, "quartz.ts"), path.join(siteDir, "quartz.ts"))

  const pluginsSrc = path.join(assetsDir, "plugins")
  if (fs.existsSync(pluginsSrc)) {
    fs.cpSync(pluginsSrc, path.join(siteDir, "plugins"), { recursive: true, force: true })
  }

  const stylesDest = path.join(siteDir, "quartz", "styles")
  fs.mkdirSync(stylesDest, { recursive: true })
  for (const file of fs.readdirSync(path.join(assetsDir, "styles"))) {
    fs.copyFileSync(path.join(assetsDir, "styles", file), path.join(stylesDest, file))
  }

  const fontsDest = path.join(siteDir, "quartz", "static", "fonts")
  fs.mkdirSync(fontsDest, { recursive: true })
  for (const file of fs.readdirSync(path.join(assetsDir, "fonts"))) {
    fs.copyFileSync(path.join(assetsDir, "fonts", file), path.join(fontsDest, file))
  }
}

// Reads <siteDir>/brain-site.yaml, validates it, and returns the parsed override — or
// null plus printed errors on failure. An empty (or missing-keys) file parses to
// `null`, which validateOverride treats as an empty override.
function readOverride(siteDir) {
  const overridePath = path.join(siteDir, "brain-site.yaml")
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

function writeConfig(siteDir, override) {
  const basePath = path.join(assetsDir, "quartz.config.base.yaml")
  const base = YAML.parse(fs.readFileSync(basePath, "utf8"))
  const merged = mergeConfig(base, override ?? {})
  fs.writeFileSync(path.join(siteDir, "quartz.config.yaml"), YAML.stringify(merged))
  return merged
}

function installAndConfigurePlugins(siteDir) {
  log("npm install ...")
  execFileSync("npm", ["i"], { cwd: siteDir, stdio: "inherit" })

  log("Installing plugins declared in quartz.config.yaml ...")
  log(
    "(if you see a build-failed warning for onboarding-emitter, logs-timeline-emitter " +
      "or audience-filter below — that's expected and harmless. The installer tries to " +
      "npm-install/build every local plugin as if it were a package; a bare .ts file has " +
      "no package.json, so it \"fails\" that step, but the plugin is still symlinked in " +
      "and loads and runs fine.)",
  )
  execFileSync("npx", ["quartz", "plugin", "install", "--from-config"], {
    cwd: siteDir,
    stdio: "inherit",
  })
}

function runBuild(siteDir, override, { serve }) {
  const args = ["quartz", "build"]
  const content = override?.content
  if (typeof content === "string" && content.length > 0) {
    args.push("-d", content)
  }
  if (serve) args.push("--serve")
  execFileSync("npx", args, { cwd: siteDir, stdio: "inherit" })
}

export async function runSetup({ siteDir, then }) {
  if (!checkNodeVersion()) return 1

  const { override, ok } = readOverride(siteDir)
  if (!ok) return 1

  vendorQuartz(siteDir)
  copyPackageAssets(siteDir)
  writeConfig(siteDir, override)

  installAndConfigurePlugins(siteDir)

  if (then === "build" || then === "serve") {
    runBuild(siteDir, override, { serve: then === "serve" })
  } else {
    log("Done. Next: npx brain-site build   or   npx brain-site serve")
  }

  return 0
}
