import Link from 'next/link'
import { formatNumber } from './format'

interface Props {
  label: string
  value: number | string
  detail?: string
  href?: string
}

/** Number tile: big figure, small label. Black on white, 1px rule border. */
export function StatCard({ label, value, detail, href }: Props) {
  const body = (
    <>
      <p className="text-2xl font-bold tabular">{typeof value === 'number' ? formatNumber(value) : value}</p>
      <p className="text-sm text-muted">{label}</p>
      {detail && <p className="text-xs text-muted mt-1">{detail}</p>}
    </>
  )
  const cls = 'card block bg-paper border border-rule p-4 text-ink'
  if (href) return <Link href={href} className={`${cls} hover:border-ink transition-colors`}>{body}</Link>
  return <div className={cls}>{body}</div>
}
