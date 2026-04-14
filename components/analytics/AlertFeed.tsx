interface Alert {
  id: string
  alert_type: string
  severity: 'high' | 'medium' | 'low'
  headline: string
  created_at: string
  detail?: Record<string, unknown>
}

const severityColor = {
  high: 'border-red-500 bg-red-50',
  medium: 'border-amber-500 bg-amber-50',
  low: 'border-gray-300 bg-gray-50',
}

export function AlertFeed({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-gray-500">No recent alerts.</p>
  return (
    <ul className="space-y-2">
      {alerts.map(a => (
        <li key={a.id} className={`border-l-4 p-3 ${severityColor[a.severity]}`}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-gray-600">{a.alert_type}</span>
            <time className="text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</time>
          </div>
          <p className="mt-1 text-sm font-medium">{a.headline}</p>
        </li>
      ))}
    </ul>
  )
}

export default AlertFeed
