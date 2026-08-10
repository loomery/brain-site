// Unit coverage for src/commands/setup.mjs's filesystem and git side effects, against
// real temporary directories.
//
// setup.mjs carries every side effect in this package and was the origin of both of the
// extraction's worst bugs — the exclude entry written to a linked worktree's own git dir
// (where git never reads it) and brain-owned static assets never being re-copied. Both
// are regression-tested here. The network clone and `npm i` are deliberately not tested.

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import {
  findGitDir,
  findGitDirWithoutGit,
  ensureGitExclude,
  checkGitignoreForConflict,
  copyBrainStatic,
  copyPackageAssets,
  resolveOverridePaths,
} from "../src/commands/setup.mjs"

function tmp(prefix) {
  // realpath: on macOS os.tmpdir() is a /var -> /private/var symlink, and git reports
  // the resolved path, so comparisons need the resolved form too.
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `brain-site-${prefix}-`)))
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

function initRepo(dir) {
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-qm", "seed")
  return dir
}

function excludeLines(gitDir) {
  return fs
    .readFileSync(path.join(gitDir, "info", "exclude"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
}

// --- findGitDir / ensureGitExclude ------------------------------------------------

test("findGitDir returns the .git directory of a normal repo", () => {
  const dir = initRepo(tmp("repo"))
  assert.equal(findGitDir(dir), path.join(dir, ".git"))
})

test("findGitDir returns null when there is no git directory at all", () => {
  const dir = tmp("nogit")
  assert.equal(findGitDir(dir), null)
})

test("ensureGitExclude registers .brain-site/ where git actually reads it", () => {
  const dir = initRepo(tmp("exclude"))
  assert.equal(ensureGitExclude(dir), true)
  assert.ok(excludeLines(path.join(dir, ".git")).includes(".brain-site/"))

  // The behavioural assertion, not just the file contents: git must honour it.
  fs.mkdirSync(path.join(dir, ".brain-site", "quartz"), { recursive: true })
  fs.writeFileSync(path.join(dir, ".brain-site", "quartz", "build.ts"), "x\n")
  assert.equal(git(dir, "status", "--porcelain").trim(), "")
})

// I1 regression test. In a linked worktree, `.git` is a file pointing at
// <main>/.git/worktrees/<name>/ — but git reads info/exclude only from the *common* git
// dir. Writing the per-worktree file left .brain-site/ untracked-and-visible, so the next
// `git add -A` in that worktree committed the whole upstream Quartz tree.
test("ensureGitExclude in a linked worktree writes where git status respects it", () => {
  const main = initRepo(tmp("wt-main"))
  const wt = path.join(tmp("wt-parent"), "feature")
  git(main, "worktree", "add", "-q", "-b", "feature", wt)

  assert.ok(fs.statSync(path.join(wt, ".git")).isFile(), "precondition: .git is a file")

  assert.equal(ensureGitExclude(wt), true)

  fs.mkdirSync(path.join(wt, ".brain-site", "quartz"), { recursive: true })
  fs.writeFileSync(path.join(wt, ".brain-site", "quartz", "build.ts"), "x\n")
  assert.equal(
    git(wt, "status", "--porcelain").trim(),
    "",
    "git must ignore .brain-site/ inside the worktree",
  )

  // And concretely: the entry landed in the common dir, not the per-worktree one.
  assert.ok(excludeLines(path.join(main, ".git")).includes(".brain-site/"))
  const perWorktreeInfo = path.join(main, ".git", "worktrees", "feature", "info", "exclude")
  assert.equal(fs.existsSync(perWorktreeInfo), false, "no per-worktree exclude file written")
})

test("findGitDir resolves a linked worktree to the common git dir", () => {
  const main = initRepo(tmp("wt2-main"))
  const wt = path.join(tmp("wt2-parent"), "feature")
  git(main, "worktree", "add", "-q", "-b", "feature", wt)
  assert.equal(findGitDir(wt), path.join(main, ".git"))
})

// The no-git-binary fallback must reach the same answer for a worktree, since it is what
// runs on a machine without git on PATH.
test("the git-less fallback also resolves a worktree to the common git dir", () => {
  const main = initRepo(tmp("wt3-main"))
  const wt = path.join(tmp("wt3-parent"), "feature")
  git(main, "worktree", "add", "-q", "-b", "feature", wt)
  assert.equal(findGitDirWithoutGit(wt), path.join(main, ".git"))
})

test("the git-less fallback follows a submodule-style gitdir pointer as-is", () => {
  const dir = tmp("submodule")
  const realGitDir = path.join(dir, "parent", ".git", "modules", "sub")
  fs.mkdirSync(realGitDir, { recursive: true })
  const work = path.join(dir, "parent", "sub")
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, ".git"), `gitdir: ${realGitDir}\n`)
  assert.equal(findGitDirWithoutGit(work), realGitDir)
})

test("ensureGitExclude on a directory with no .git warns but does not fail setup", () => {
  const dir = tmp("nogit2")
  assert.equal(ensureGitExclude(dir), true)
})

test("ensureGitExclude is idempotent across two runs", () => {
  const dir = initRepo(tmp("idempotent"))
  ensureGitExclude(dir)
  ensureGitExclude(dir)
  const lines = excludeLines(path.join(dir, ".git")).filter((l) => l === ".brain-site/")
  assert.equal(lines.length, 1)
})

test("ensureGitExclude appends without eating an existing exclude file's last line", () => {
  const dir = initRepo(tmp("append"))
  const excludePath = path.join(dir, ".git", "info", "exclude")
  fs.mkdirSync(path.dirname(excludePath), { recursive: true })
  fs.writeFileSync(excludePath, "*.log") // no trailing newline
  ensureGitExclude(dir)
  const lines = excludeLines(path.join(dir, ".git"))
  assert.deepEqual(lines, ["*.log", ".brain-site/"])
})

// M4: a .gitignore listing .brain-site/ is fatal — globby's { gitignore: true } would
// silently drop every static asset from the build.
test("a .gitignore listing .brain-site/ is fatal, not a warning", () => {
  const dir = initRepo(tmp("conflict"))
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.brain-site/\n")
  assert.equal(checkGitignoreForConflict(dir), false)
  assert.equal(ensureGitExclude(dir), false)
})

test("an unrelated .gitignore is not treated as a conflict", () => {
  const dir = initRepo(tmp("noconflict"))
  fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n.brain-site.bak/\n")
  assert.equal(checkGitignoreForConflict(dir), true)
})

// --- copyBrainStatic -------------------------------------------------------------

// Lays out a generated tree with this package's own assets in place (fonts included),
// plus a brain-owned static directory, and returns the paths involved.
function staticFixture() {
  const root = tmp("static")
  const generated = path.join(root, ".brain-site")
  fs.mkdirSync(generated, { recursive: true })
  copyPackageAssets(generated)

  // Upstream Quartz's own static files, which the brain does not own.
  const dest = path.join(generated, "quartz", "static")
  fs.writeFileSync(path.join(dest, "icon.png"), "upstream-icon")

  const brainStatic = path.join(root, "assets", "static")
  fs.mkdirSync(path.join(brainStatic, "insights"), { recursive: true })
  fs.writeFileSync(path.join(brainStatic, "insights", "roadmap-after.svg"), "v1")

  return { root, generated, dest, brainStatic }
}

// I2 regression test. copyBrainStatic reused a skip-if-exists leaf rule, so a
// regenerated brain asset was never re-copied — the stale copy was served forever, and
// the log blamed the package for the brain's own stale file.
test("copyBrainStatic re-copies a brain file that changed since the last run", () => {
  const { generated, dest, brainStatic } = staticFixture()
  const published = path.join(dest, "insights", "roadmap-after.svg")

  assert.equal(copyBrainStatic(generated, { static: brainStatic }), true)
  assert.equal(fs.readFileSync(published, "utf8"), "v1")

  fs.writeFileSync(path.join(brainStatic, "insights", "roadmap-after.svg"), "v2")
  assert.equal(copyBrainStatic(generated, { static: brainStatic }), true)
  assert.equal(fs.readFileSync(published, "utf8"), "v2", "the edited brain asset must win")
})

test("copyBrainStatic stops publishing a brain file the brain deleted", () => {
  const { generated, dest, brainStatic } = staticFixture()
  copyBrainStatic(generated, { static: brainStatic })
  assert.ok(fs.existsSync(path.join(dest, "insights", "roadmap-after.svg")))

  fs.rmSync(path.join(brainStatic, "insights", "roadmap-after.svg"))
  copyBrainStatic(generated, { static: brainStatic })
  assert.equal(fs.existsSync(path.join(dest, "insights", "roadmap-after.svg")), false)
})

test("copyBrainStatic leaves static files the brain does not own alone", () => {
  const { generated, dest, brainStatic } = staticFixture()
  copyBrainStatic(generated, { static: brainStatic })
  assert.equal(fs.readFileSync(path.join(dest, "icon.png"), "utf8"), "upstream-icon")
})

test("copyBrainStatic never clobbers this package's own fonts", () => {
  const { generated, dest, brainStatic } = staticFixture()
  const fontsDir = path.join(dest, "fonts")
  const shipped = fs.readdirSync(fontsDir)
  assert.ok(shipped.length > 0, "precondition: the package ships fonts")
  const victim = path.join(fontsDir, shipped[0])
  const before = fs.readFileSync(victim)

  fs.mkdirSync(path.join(brainStatic, "fonts"), { recursive: true })
  fs.writeFileSync(path.join(brainStatic, "fonts", shipped[0]), "brain-clobber")
  fs.writeFileSync(path.join(brainStatic, "fonts", "brain-only.otf"), "brain-only")

  assert.equal(copyBrainStatic(generated, { static: brainStatic }), true)
  assert.deepEqual(fs.readFileSync(victim), before, "the package's own font must survive")
  assert.equal(fs.readFileSync(path.join(fontsDir, "brain-only.otf"), "utf8"), "brain-only")
  assert.ok(fs.existsSync(victim))
})

test("copyBrainStatic is a no-op when static: is unset", () => {
  const { generated } = staticFixture()
  assert.equal(copyBrainStatic(generated, {}), true)
  assert.equal(copyBrainStatic(generated, null), true)
})

test("copyBrainStatic fails cleanly when static: names a missing path", () => {
  const { generated, root } = staticFixture()
  assert.equal(copyBrainStatic(generated, { static: path.join(root, "nope") }), false)
})

test("copyBrainStatic fails cleanly when static: names a file", () => {
  const { generated, root } = staticFixture()
  const file = path.join(root, "a-file")
  fs.writeFileSync(file, "x")
  assert.equal(copyBrainStatic(generated, { static: file }), false)
})

// --- resolveOverridePaths --------------------------------------------------------

test("resolveOverridePaths resolves relative paths against the root", () => {
  const resolved = resolveOverridePaths("/brains/acme", {
    content: "docs",
    static: "assets/static",
    sections: { timeline: { source: "logs", route: "/logs" } },
  })
  assert.equal(resolved.content, path.join("/brains/acme", "docs"))
  assert.equal(resolved.static, path.join("/brains/acme", "assets", "static"))
  assert.equal(resolved.sections.timeline.source, path.join("/brains/acme", "logs"))
  assert.equal(resolved.sections.timeline.route, "/logs", "route is a URL, not a path")
})

test("resolveOverridePaths passes absolute paths through untouched", () => {
  const resolved = resolveOverridePaths("/brains/acme", {
    content: "/elsewhere/docs",
    static: "/elsewhere/static",
    sections: { timeline: { source: "/elsewhere/logs" } },
  })
  assert.equal(resolved.content, "/elsewhere/docs")
  assert.equal(resolved.static, "/elsewhere/static")
  assert.equal(resolved.sections.timeline.source, "/elsewhere/logs")
})

test("resolveOverridePaths defaults an omitted timeline source to logs/", () => {
  const resolved = resolveOverridePaths("/brains/acme", { sections: { timeline: {} } })
  assert.equal(resolved.sections.timeline.source, path.join("/brains/acme", "logs"))
})

test("resolveOverridePaths leaves an unset static and timeline unset", () => {
  const resolved = resolveOverridePaths("/brains/acme", { content: "docs" })
  assert.equal(resolved.static, undefined)
  assert.equal(resolved.sections, undefined)
})

test("resolveOverridePaths does not mutate the override it is given", () => {
  const original = { content: "docs", sections: { timeline: { source: "logs" } } }
  resolveOverridePaths("/brains/acme", original)
  assert.equal(original.content, "docs")
  assert.equal(original.sections.timeline.source, "logs")
})
