'use client'

interface Row {
  person_id: string
  composite_score: number
  rank: number | null
  person?: {
    id?: string
    full_name?: string
    office_held?: string
    island?: string
    photo_url?: string
  } | null
}

export function PowerMapTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">#</th>
            <th className="py-2 pr-4">Person</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Island</th>
            <th className="py-2 pr-4 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.person_id} className="border-b last:border-0">
              <td className="py-2 pr-4">{r.rank ?? i + 1}</td>
              <td className="py-2 pr-4 font-medium">{r.person?.full_name ?? r.person_id}</td>
              <td className="py-2 pr-4 text-gray-600">{r.person?.office_held ?? '—'}</td>
              <td className="py-2 pr-4 text-gray-600">{r.person?.island ?? '—'}</td>
              <td className="py-2 pr-4 text-right">
                <span className="inline-block w-12 text-right">{Number(r.composite_score).toFixed(1)}</span>
                <span
                  className="ml-2 inline-block h-2 bg-blue-500 align-middle"
                  style={{ width: `${Math.min(100, Number(r.composite_score))}px` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default PowerMapTable
