/** Shared formatting helpers for admin pages (safe in server and client components). */

export function formatAmount(n: string | number | null | undefined): string {
  if (n === null || n === undefined || n === '') return '—'
  const v = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(v)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const v = typeof n === 'string' ? Number(n) : n
  return Number.isFinite(v) ? v.toLocaleString('en-US') : String(n)
}

export function humanize(s: string | null | undefined): string {
  return (s ?? '').replace(/_/g, ' ')
}

export function timeAgo(dateString: string | null | undefined): string {
  if (!dateString) return 'never'
  const then = new Date(dateString)
  if (Number.isNaN(then.getTime())) return dateString
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  const hh = String(then.getHours()).padStart(2, '0')
  const mm = String(then.getMinutes()).padStart(2, '0')
  if (diffHr < 48) return `Yesterday at ${hh}:${mm}`
  const dateStr = then.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
  return `${dateStr} at ${hh}:${mm}`
}

export function hoursSince(dateString: string | null | undefined): number | null {
  if (!dateString) return null
  const t = new Date(dateString).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / (1000 * 60 * 60)
}
