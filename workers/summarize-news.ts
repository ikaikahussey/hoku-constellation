/**
 * Writes summaries for aggregated news articles (lib/news/summarize.ts). Run after each news import
 * by workers/import-news.ts, or alone:
 *
 *   npx tsx --tsconfig workers/tsconfig.json workers/summarize-news.ts [--limit=N] [--retry-fallbacks]
 */
import { getWorkerDb, closeWorkerDb } from './lib/db'
import { log, logError } from './lib/logger'
import { summarizePendingArticles } from '@/lib/news/summarize'

export async function runSummarizeNews(argv = process.argv.slice(2)): Promise<void> {
  const lim = argv.find(a => a.startsWith('--limit='))
  const db = getWorkerDb()
  try {
    const r = await summarizePendingArticles(db, {
      limit: lim ? Number(lim.slice(8)) : 200,
      retryFallbacks: argv.includes('--retry-fallbacks'),
      log: m => log(`[news-summaries] ${m}`),
    })
    log(`news summaries: considered=${r.considered} model=${r.model} fallback=${r.fallback} errors=${r.errors}`)
  } catch (e) {
    logError('news summaries failed', e)
    throw e
  } finally {
    await closeWorkerDb()
  }
}

if (process.argv[1]?.endsWith('workers/summarize-news.ts')) {
  runSummarizeNews().then(() => process.exit(0)).catch(() => process.exit(1))
}
