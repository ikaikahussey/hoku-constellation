interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField?: string
  emptyMessage?: string
}

export function Table<T extends Record<string, unknown>>({ columns, data, keyField = 'id', emptyMessage = 'No data' }: TableProps<T>) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-white/40">{emptyMessage}</div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            {columns.map((col) => (
              <th key={col.key} className={`text-left py-3 px-4 text-white/50 font-medium ${col.className || ''}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={String(row[keyField])} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              {columns.map((col) => (
                <td key={col.key} className={`py-3 px-4 ${col.className || ''}`}>
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
