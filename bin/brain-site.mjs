#!/usr/bin/env node
import path from "node:path"
import { runSetup } from "../src/commands/setup.mjs"
import { runValidate } from "../src/commands/validate.mjs"

function flag(argv, name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

const [command, ...argv] = process.argv.slice(2)
const siteDir = process.cwd()

switch (command) {
  case "setup":
    process.exit(await runSetup({ siteDir }))
  case "validate":
    process.exit(runValidate({ docsRoot: path.resolve(siteDir, flag(argv, "docs", "../docs")) }))
  case "build":
  case "serve":
    process.exit(await runSetup({ siteDir, then: command }))
  default:
    process.stderr.write(`brain-site: unknown command "${command ?? ""}"\n`)
    process.stderr.write(`usage: brain-site <setup|build|serve|validate>\n`)
    process.exit(1)
}
