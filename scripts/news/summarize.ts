#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * CLI: npx tsx --tsconfig tsconfig.scripts.json scripts/news/summarize.ts [--limit=N] [--retry-fallbacks]
 * Summarizes aggregated news articles that have no current summary (lib/news/summarize.ts).
 * Uses ANTHROPIC_API_KEY when set; otherwise stores the publisher's excerpt.
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import { summarizePendingArticles } from '@/lib/news/summarize'

const argv = process.argv.slice(2)
const lim = argv.find(a => a.startsWith('--limit='))

;(async () => {
  const db = await getServiceDb()
  try {
    const r = await summarizePendingArticles(db, { limit: lim ? Number(lim.slice(8)) : 50, retryFallbacks: argv.includes('--retry-fallbacks'), log: m => console.log(m) })
    console.log(JSON.stringify(r, null, 2))
  } finally {
    await closeServiceDb()
  }
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
