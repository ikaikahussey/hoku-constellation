import { getServiceDb } from '@/lib/db/service'
import type { DocumentRow } from '@/lib/db/types'
import { ArticleForm } from '@/components/admin/ArticleForm'
import Pagination from '@/components/admin/Pagination'
import { formatDate, humanize } from '@/components/admin/format'

export const dynamic = 'force-dynamic'

type ArticleRow = Pick<DocumentRow, 'id' | 'source' | 'url' | 'title' | 'doc_date' | 'raw' | 'fetched_at'> & { mentions: string }

export default async function AdminArticles({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)
  const perPage = 50
  const offset = (page - 1) * perPage

  const db = await getServiceDb()
  const [total, rows] = await Promise.all([
    db.one<{ n: string }>(`select count(*)::text n from document where doc_type = 'article'`),
    db.many<ArticleRow>(
      `select d.id, d.source, d.url, d.title, d.doc_date, d.raw, d.fetched_at,
              (select count(*) from edge e where e.document_id = d.id and e.type = 'mentioned_in')::text mentions
         from document d where d.doc_type = 'article'
        order by d.doc_date desc nulls last, d.fetched_at desc
        limit $1 offset $2`, [perPage, offset]),
  ])
  const totalCount = Number(total?.n ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))

  return (
    <div>
      <ArticleForm />

      <div className="overflow-x-auto border border-rule">
        <table className="w-full text-sm tabular">
          <thead>
            <tr className="border-b border-ink">
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Title</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Source</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Author</th>
              <th scope="col" className="py-2 px-3 text-left text-xs font-bold uppercase tracking-wide">Published</th>
              <th scope="col" className="py-2 px-3 text-right text-xs font-bold uppercase tracking-wide">Mentions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center text-muted">No articles yet.</td></tr>
            ) : rows.map(r => {
              const author = typeof r.raw?.author === 'string' ? r.raw.author : null
              return (
                <tr key={r.id} className="border-b border-rule">
                  <td className="py-2 px-3">
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}</a> : (r.title || <span className="text-muted">untitled</span>)}
                  </td>
                  <td className="py-2 px-3 text-muted">{humanize(r.source)}</td>
                  <td className="py-2 px-3 text-muted">{author || '—'}</td>
                  <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">{formatDate(r.doc_date)}</td>
                  <td className="py-2 px-3 text-right">{Number(r.mentions).toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={page} totalPages={totalPages} totalCount={totalCount} perPage={perPage} basePath="/admin/articles" />
    </div>
  )
}
