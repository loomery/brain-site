// Shared HTML helpers for the dashboard's module renderers, so every module
// produces the same card shape and every value carries a provenance pill.
//
// Hand-written HTML rather than JSX for the reason page-shell.ts's banner
// documents: these files are loaded by Node's own resolver, not esbuild.

import { escapeHtml } from "../shared/page-shell.ts"
import { PROVENANCE, type Provenance } from "./types.ts"

export { escapeHtml, PROVENANCE }
export type { Provenance }

// The honesty mechanism. Every card says whether its numbers were stated by a
// human in dashboard.yaml (or derived from git/frontmatter) or assessed by a
// model at the last sync. A dashboard that mixes the two without labelling them
// reads as authoritative while containing guesses.
export function pill(provenance: Provenance): string {
  return `<span class="dash-pill dash-pill--${provenance}">${provenance}</span>`
}

export function card(
  label: string,
  provenance: Provenance | null,
  bodyHtml: string,
  { id = "", className = "" }: { id?: string; className?: string } = {},
): string {
  const idAttr = id ? ` id="${escapeHtml(id)}"` : ""
  const classAttr = `dash-card${className ? ` ${className}` : ""}`
  const head = `<p class="dash-label">${escapeHtml(label)}${provenance ? pill(provenance) : ""}</p>`
  return `<section class="${classAttr}"${idAttr}>${head}${bodyHtml}</section>`
}

export function chip(text: string, tone = ""): string {
  const toneClass = tone ? ` dash-chip--${tone}` : ""
  return `<span class="dash-chip${toneClass}">${escapeHtml(text)}</span>`
}

export function list(itemsHtml: string[]): string {
  if (itemsHtml.length === 0) return ""
  return `<ul class="dash-list">${itemsHtml.map((item) => `<li>${item}</li>`).join("")}</ul>`
}

// Display-only humanisation (`product-context` -> "Product context"), matching
// the convention onboarding-emitter.ts and the old home-emitter.ts both use.
export function humanize(text: string): string {
  const spaced = text.replace(/[-_]/g, " ")
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced
}

// The Loomery logomark, from the design system: a mint bar and a mint dot.
// Inlined rather than shipped as an image file for three reasons — it is 250
// bytes, `fill="currentColor"` lets the stylesheet theme it (the design system's
// own file hardcodes #15FFB9, which is unreadable on a white background), and it
// needs no quartz/static copy step or PACKAGE_OWNED_STATIC entry.
export const LOOMERY_LOGOMARK =
  '<svg class="dash-loomery-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 247 247" ' +
  'role="img" aria-label="Loomery" fill="currentColor">' +
  '<rect x="0" y="0" width="111.054" height="247"></rect>' +
  '<circle cx="190.994" cy="190.994" r="56.006"></circle>' +
  "</svg>"
