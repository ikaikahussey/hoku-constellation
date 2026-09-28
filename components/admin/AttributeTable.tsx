import { humanize } from './format'

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-gray-400">—</span>
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return <span className="tabular">{v.toLocaleString()}</span>
  if (typeof v === 'string') {
    if (/^https?:\/\//.test(v)) return <a href={v} target="_blank" rel="noopener noreferrer" className="break-all">{v}</a>
    return <span className="break-words whitespace-pre-wrap">{v}</span>
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className="text-gray-400">—</span>
    return (
      <span className="flex flex-wrap gap-1">
        {v.map((x, i) => <span key={i} className="border border-rule px-2 py-0.5 text-xs">{typeof x === 'string' ? humanize(x) : JSON.stringify(x)}</span>)}
      </span>
    )
  }
  return <code className="font-mono text-xs break-all">{JSON.stringify(v)}</code>
}

interface Props {
  title?: string
  data: Record<string, unknown>
  /** Keys to render first, in this order. Remaining keys follow alphabetically. */
  order?: string[]
  emptyMessage?: string
}

/** Definition list for a jsonb blob (entity.attributes, entity.identifiers, document.raw). */
export function AttributeTable({ title, data, order = [], emptyMessage = 'None' }: Props) {
  const keys = [
    ...order.filter(k => k in data),
    ...Object.keys(data).filter(k => !order.includes(k)).sort(),
  ]
  return (
    <section className="card bg-paper border border-rule p-6 mb-6">
      {title && <h2 className="text-lg font-bold mb-4">{title}</h2>}
      {keys.length === 0 ? (
        <p className="text-sm text-muted">{emptyMessage}</p>
      ) : (
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          {keys.map(k => (
            <div key={k} className="border-b border-rule pb-2">
              <dt className="text-xs text-muted uppercase tracking-wide">{humanize(k)}</dt>
              <dd className="mt-0.5">{renderValue(data[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
