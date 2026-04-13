/**
 * Article Import Script
 * Input: CSV of article URLs or RSS feed URL
 * Usage: npx tsx scripts/import/articles.ts <csv-file-path>
 */
import { createClient } from '@supabase/supabase-js'
import { parseCSV } from './utils/csv-parser'
import { ImportLogger } from './utils/logger'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function importArticles(filePath: string) {
  const logger = new ImportLogger('Articles')

  const records = parseCSV(filePath)
  console.log(`Parsed ${records.length} records from ${filePath}`)

  for (const row of records) {
    const title = row['Title'] || row['title'] || ''
    const url = row['URL'] || row['url'] || row['link'] || ''
    const publishedAt = row['Published'] || row['published_at'] || row['date'] || ''
    const source = row['Source'] || row['source'] || 'external'
    const author = row['Author'] || row['author'] || ''
    const summary = row['Summary'] || row['summary'] || row['description'] || ''
    const tags = (row['Tags'] || row['tags'] || '').split(/[,;]/).map((t: string) => t.trim()).filter(Boolean)

    if (!title || !url) {
      logger.recordError('Missing title or URL')
      continue
    }

    // Check for duplicate URL
    const { data: existing } = await supabase
      .from('article')
      .select('id')
      .eq('url', url)
      .limit(1)

    if (existing && existing.length > 0) {
      logger.recordSkip()
      continue
    }

    const record = {
      title,
      url,
      published_at: publishedAt || null,
      source: ['hoku_fm', 'hawaii_independent', 'external'].includes(source) ? source : 'external',
      author: author || null,
      summary: summary || null,
      tags,
    }

    const { error } = await supabase.from('article').insert(record)
    if (error) {
      logger.recordError(error.message)
    } else {
      logger.recordInsert()
    }
  }

  console.log('\nNote: Entity linking must be done manually through the admin interface.')
  return logger.summary()
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx tsx scripts/import/articles.ts <csv-file-path>')
  process.exit(1)
}
importArticles(filePath).catch(console.error)
