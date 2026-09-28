/**
 * Colors live in app/globals.css only. This test fails on any hex/rgb/hsl literal or legacy Tailwind
 * palette class in app/, components/ and lib/ outside the allowlisted files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const DIRS = ['app', 'components', 'lib']
/** Files that must carry literal colors and are reviewed by hand. */
const ALLOW_FILES = new Set([
  'app/globals.css',                       // the token source
  'components/brand/Wordmark.tsx',         // Mark: black square, white H (SVG fill attributes)
  'app/api/og/route.tsx',                  // @vercel/og renders outside CSS; mirrors the tokens
  'app/manifest.ts',                       // PWA manifest colors
])
const COLOR_LITERAL = /#(?:[0-9a-fA-F]{3}){1,2}\b|\brgba?\(|\bhsla?\(/
/** Legacy palette utilities (navy/gold theme and default Tailwind hues). */
const PALETTE_CLASS = /\b(?:text|bg|border|from|to|via|ring|fill|stroke|outline|decoration)-(?:navy|gold|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|gray-(?:50|200|500|600|700|800|900|950))(?:-\d{2,3})?\b/
const WEIGHT_CLASS = /\bfont-(?:thin|extralight|light|medium|semibold|extrabold|black)\b/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

describe('design tokens', () => {
  const files = DIRS.flatMap(d => walk(join(ROOT, d))).filter(f => !ALLOW_FILES.has(relative(ROOT, f)))
  it('no color literals outside globals.css and the allowlisted renderers', () => {
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (COLOR_LITERAL.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
  it('no legacy palette or non-400/700 weight utilities', () => {
    const hits: string[] = []
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (PALETTE_CLASS.test(line) || WEIGHT_CLASS.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
  it('globals.css defines exactly the HOKU Insider palette', () => {
    const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8')
    for (const t of ['--color-ink: #000000', '--color-paper: #FFFFFF', '--color-link: #CC0000', '--font-weight-normal: 400', '--font-weight-bold: 700']) expect(css).toContain(t)
    expect(css).toMatch(/--color-\*: initial/)
    const colors = [...css.matchAll(/--color-[a-z0-9-]+: (#[0-9A-Fa-f]{6})/g)].map(m => m[1].toUpperCase())
    // every non-red color is a gray (r=g=b)
    for (const c of colors) if (!['#CC0000', '#990000'].includes(c)) expect(c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7), c).toBe(true)
  })
})
