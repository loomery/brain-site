#!/usr/bin/env node
import path from "node:path"
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

const [command, ...argv] = process.argv.slice(2)
const rootDir = process.cwd()

switch (command) {
  case "setup":
    process.exit(await runSetup({ rootDir }))
  case "validate":
    process.exit(runValidate({ docsRoot: path.resolve(rootDir, flag(argv, "docs", "docs")) }))
  case "build":
  case "serve":
    process.exit(await runSetup({ rootDir, then: command }))
  default:
    process.stderr.write(`brain-site: unknown command "${command ?? ""}"\n`)
    process.stderr.write(`usage: brain-site <setup|build|serve|validate>\n`)
    process.exit(1)
}
