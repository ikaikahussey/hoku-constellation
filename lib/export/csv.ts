/**
 * CSV export (E7). RFC 4180 quoting, CRLF line endings, UTF-8 BOM for Excel, and spreadsheet
 * formula-injection protection: cells starting with = + - @ tab or CR are prefixed with an apostrophe.
 */
export interface Column<T> { key: string; header: string; value?: (row: T) => unknown }

export function csvCell(v: unknown): string {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns?: Array<Column<T>>): string {
  const cols: Array<Column<T>> = columns ?? (rows[0] ? Object.keys(rows[0]).map(k => ({ key: k, header: k })) : [])
  const lines = [cols.map(c => csvCell(c.header)).join(',')]
  for (const r of rows) lines.push(cols.map(c => csvCell(c.value ? c.value(r) : r[c.key])).join(','))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

export function csvFilename(kind: string, suffix?: string) {
  return `hoku-insider-${kind}${suffix ? `-${suffix.replace(/[^A-Za-z0-9_-]+/g, '-')}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`
}
