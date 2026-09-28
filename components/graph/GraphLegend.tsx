import { shapePath } from './shapes'

const ITEMS: Array<{ kind: string; label: string }> = [
  { kind: 'person', label: 'Person' },
  { kind: 'org', label: 'Organization' },
  { kind: 'bill', label: 'Bill' },
  { kind: 'docket', label: 'Docket' },
  { kind: 'parcel', label: 'Parcel' },
  { kind: 'office', label: 'Office' },
]

export function GraphLegend() {
  return (
    <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
      {ITEMS.map(item => (
        <div key={item.kind} className="flex items-center gap-1.5">
          <dt>
            <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
              <path d={shapePath(item.kind, 5)} fill={item.kind === 'person' ? 'var(--color-ink)' : 'var(--color-paper)'} stroke="var(--color-ink)" strokeWidth="1.25" />
            </svg>
          </dt>
          <dd>{item.label}</dd>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <dt><span className="block w-4 border-t-2 border-gray-400" aria-hidden="true" /></dt>
        <dd>Current</dd>
      </div>
      <div className="flex items-center gap-1.5">
        <dt><span className="block w-4 border-t border-dashed border-gray-400" aria-hidden="true" /></dt>
        <dd>Former</dd>
      </div>
    </dl>
  )
}
