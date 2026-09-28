/**
 * The product is HOKU Insider. "Constellation" may survive only as an internal identifier:
 * the domain constellation.hoku.fm, the repo/package name hoku-constellation, launchd labels
 * fm.hoku.constellation.*, env/DB names, git history, and the migration docs that describe the rename.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SCAN_DIRS = ['app', 'components', 'lib', 'public', 'workers', 'scripts', 'db/migrations']
const SCAN_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'vercel.json', '.env.example', 'workers/.env.example']
const EXT = /\.(tsx?|mjs|js|json|css|svg|md|sh|plist|sql|example)$/

/** Identifiers that legitimately contain the old name. */
const ALLOWED = [
  /constellation\.hoku\.fm/i,        // production domain (kept)
  /hoku-constellation/i,             // repo, package, Vercel project
  /(?:fm\\?\.)?hoku\\?\.constellation/i, // launchd labels (also the escaped grep form in workers/status.sh)
  /constellation@hoku\.fm/i,         // contact mailbox
  /supabase\.co|fdphdzbjdtbxxexgyfba/i,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

describe('brand name', () => {
  it('no user-facing "Constellation" outside allowlisted identifiers', () => {
    const files = [...SCAN_DIRS.flatMap(d => walk(join(ROOT, d))), ...SCAN_FILES.map(f => join(ROOT, f))]
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, i) => {
        if (!/constellation/i.test(line)) return
        const stripped = ALLOWED.reduce((l, re) => l.replace(new RegExp(re.source, 'gi'), ''), line)
        if (/constellation/i.test(stripped)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
  it('the wordmark says HOKU Insider with HOKU uppercase', () => {
    const wm = readFileSync(join(ROOT, 'components/brand/Wordmark.tsx'), 'utf8')
    expect(wm).toMatch(/HOKU Insider/)
    expect(wm).not.toMatch(/Hoku Insider/)
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8')
    expect(layout).toMatch(/HOKU Insider/)
  })
})
