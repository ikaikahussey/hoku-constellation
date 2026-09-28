interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
  numeric?: boolean
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField?: string
  emptyMessage?: string
  caption?: string
}

export function Table<T extends Record<string, unknown>>({ columns, data, keyField = 'id', emptyMessage = 'No data', caption }: TableProps<T>) {
  if (data.length === 0) return <div className="py-12 text-center text-muted">{emptyMessage}</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-ink">
            {columns.map(col => (
              <th key={col.key} scope="col" className={`py-2 px-3 text-xs font-bold uppercase tracking-wide ${col.numeric ? 'text-right' : 'text-left'} ${col.className || ''}`}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={String(row[keyField])} className="border-b border-rule">
              {columns.map(col => (
                <td key={col.key} className={`py-2 px-3 ${col.numeric ? 'text-right' : ''} ${col.className || ''}`}>
                  {col.render ? col.render(row) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
