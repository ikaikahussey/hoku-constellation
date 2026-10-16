/**
 * Re-tags stored articles when the tagger changed (lib/news/retag.ts), writes article summaries
 * (lib/news/summarize.ts), regroups articles into stories and summarizes them (lib/news/stories.ts).
 * Run after each news import
 * by workers/import-news.ts, or alone:
 *
 *   npx tsx --tsconfig workers/tsconfig.json workers/summarize-news.ts [--limit=N] [--retry-fallbacks]
 */
import { getWorkerDb, closeWorkerDb } from './lib/db'
import { log, logError } from './lib/logger'
import { summarizePendingArticles } from '@/lib/news/summarize'
import { retagArticles, retagPending } from '@/lib/news/retag'
import { rebuildStories, summarizeStories } from '@/lib/news/stories'

export async function runSummarizeNews(argv = process.argv.slice(2)): Promise<void> {
  const lim = argv.find(a => a.startsWith('--limit='))
  const db = getWorkerDb()
  try {
    while (await retagPending(db)) {
      const t = await retagArticles(db, { limit: 500, log: m => log(`[news-retag] ${m}`) })
      log(`news retag: articles=${t.articles} inserted=${t.inserted} updated=${t.updated} errors=${t.errors}`)
      if (!t.articles) break
    }
    const r = await summarizePendingArticles(db, {
      limit: lim ? Number(lim.slice(8)) : 200,
      retryFallbacks: argv.includes('--retry-fallbacks'),
      log: m => log(`[news-summaries] ${m}`),
    })
    log(`news summaries: considered=${r.considered} model=${r.model} fallback=${r.fallback} errors=${r.errors}`)
    const st = await rebuildStories(db)
    const ss = await summarizeStories(db, { log: m => log(`[news-stories] ${m}`) })
    log(`news stories: articles=${st.articles} stories=${st.stories} multi=${st.multi}; summaries model=${ss.model} fallback=${ss.fallback} errors=${ss.errors}`)
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
