import Link from 'next/link'

type PageToken = number | 'ellipsis'

function buildPageWindow(current: number, total: number): PageToken[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const tokens: PageToken[] = []
  const add = (t: PageToken) => tokens.push(t)

  add(1)
  if (current > 4) add('ellipsis')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let p = start; p <= end; p++) add(p)

  if (current < total - 3) add('ellipsis')
  add(total)

  return tokens
}

function buildHref(
  basePath: string,
  searchParams: Record<string, string | undefined> | undefined,
  page: number
): string {
  const params = new URLSearchParams()
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== '') params.set(k, v)
    }
  }
  if (page > 1) params.set('page', String(page))
  else params.delete('page')
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export default function Pagination({
  currentPage,
  totalPages,
  totalCount,
  perPage,
  basePath,
  searchParams,
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

  const navBtn =
    'px-2.5 py-1.5 rounded text-sm text-white/60 hover:text-white hover:bg-white/5'
  const navBtnDisabled =
    'px-2.5 py-1.5 rounded text-sm text-white/30 cursor-not-allowed'
  const pageBtn =
    'px-3 py-1.5 rounded text-sm text-white/60 hover:text-white hover:bg-white/5'
  const pageBtnActive =
    'px-3 py-1.5 rounded text-sm bg-gold text-navy font-semibold'

  const window = buildPageWindow(currentPage, totalPages)

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-6">
      <div className="text-sm text-white/50">
        {totalCount === 0 ? (
          'No results'
        ) : (
          <>
            Showing <span className="text-white/80">{from.toLocaleString()}</span>–
            <span className="text-white/80">{to.toLocaleString()}</span> of{' '}
            <span className="text-white/80">{totalCount.toLocaleString()}</span>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          {isFirst ? (
            <span className={navBtnDisabled} aria-disabled="true">« First</span>
          ) : (
            <Link href={buildHref(basePath, searchParams, 1)} className={navBtn}>
              « First
            </Link>
          )}
          {isFirst ? (
            <span className={navBtnDisabled} aria-disabled="true">‹ Prev</span>
          ) : (
            <Link
              href={buildHref(basePath, searchParams, currentPage - 1)}
              className={navBtn}
            >
              ‹ Prev
            </Link>
          )}

          {window.map((token, i) =>
            token === 'ellipsis' ? (
              <span key={`e-${i}`} className="px-2 py-1.5 text-sm text-white/30">
                …
              </span>
            ) : token === currentPage ? (
              <span key={token} className={pageBtnActive} aria-current="page">
                {token}
              </span>
            ) : (
              <Link
                key={token}
                href={buildHref(basePath, searchParams, token)}
                className={pageBtn}
              >
                {token}
              </Link>
            )
          )}

          {isLast ? (
            <span className={navBtnDisabled} aria-disabled="true">Next ›</span>
          ) : (
            <Link
              href={buildHref(basePath, searchParams, currentPage + 1)}
              className={navBtn}
            >
              Next ›
            </Link>
          )}
          {isLast ? (
            <span className={navBtnDisabled} aria-disabled="true">Last »</span>
          ) : (
            <Link
              href={buildHref(basePath, searchParams, totalPages)}
              className={navBtn}
            >
              Last »
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
