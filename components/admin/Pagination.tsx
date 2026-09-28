import Link from 'next/link'

type PageToken = number | 'ellipsis'

function buildPageWindow(current: number, total: number): PageToken[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const tokens: PageToken[] = [1]
  if (current > 4) tokens.push('ellipsis')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let p = start; p <= end; p++) tokens.push(p)
  if (current < total - 3) tokens.push('ellipsis')
  tokens.push(total)
  return tokens
}

function buildHref(basePath: string, searchParams: Record<string, string | undefined> | undefined, page: number): string {
  const params = new URLSearchParams()
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) if (v !== undefined && v !== '') params.set(k, v)
  }
  if (page > 1) params.set('page', String(page))
  else params.delete('page')
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export default function Pagination({
  currentPage, totalPages, totalCount, perPage, basePath, searchParams,
}: {
  currentPage: number
  totalPages: number
  totalCount: number
  perPage: number
  basePath: string
  searchParams?: Record<string, string | undefined>
}) {
  const from = totalCount === 0 ? 0 : (currentPage - 1) * perPage + 1
  const to = Math.min(currentPage * perPage, totalCount)
  const isFirst = currentPage <= 1
  const isLast = currentPage >= totalPages

  const btn = 'link-quiet px-2.5 py-1.5 text-sm text-ink border border-transparent hover:border-ink'
  const btnDisabled = 'px-2.5 py-1.5 text-sm text-gray-400 cursor-not-allowed'
  const pageActive = 'px-3 py-1.5 text-sm bg-ink text-paper font-bold'

  const window = buildPageWindow(currentPage, totalPages)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6">
      <div className="text-sm text-muted tabular">
        {totalCount === 0 ? 'No results' : (
          <>Showing <span className="text-ink">{from.toLocaleString()}</span>–<span className="text-ink">{to.toLocaleString()}</span> of <span className="text-ink">{totalCount.toLocaleString()}</span></>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center gap-1 tabular" aria-label="Pagination">
          {isFirst ? <span className={btnDisabled} aria-disabled="true">« First</span>
            : <Link href={buildHref(basePath, searchParams, 1)} className={btn}>« First</Link>}
          {isFirst ? <span className={btnDisabled} aria-disabled="true">‹ Prev</span>
            : <Link href={buildHref(basePath, searchParams, currentPage - 1)} className={btn}>‹ Prev</Link>}

          {window.map((token, i) =>
            token === 'ellipsis' ? (
              <span key={`e-${i}`} className="px-2 py-1.5 text-sm text-gray-400">…</span>
            ) : token === currentPage ? (
              <span key={token} className={pageActive} aria-current="page">{token}</span>
            ) : (
              <Link key={token} href={buildHref(basePath, searchParams, token)} className={btn}>{token}</Link>
            )
          )}

          {isLast ? <span className={btnDisabled} aria-disabled="true">Next ›</span>
            : <Link href={buildHref(basePath, searchParams, currentPage + 1)} className={btn}>Next ›</Link>}
          {isLast ? <span className={btnDisabled} aria-disabled="true">Last »</span>
            : <Link href={buildHref(basePath, searchParams, totalPages)} className={btn}>Last »</Link>}
        </nav>
      )}
    </div>
  )
}
