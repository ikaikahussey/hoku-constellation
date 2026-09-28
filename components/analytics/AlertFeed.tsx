import { Badge } from '@/components/ui/Badge'

interface Alert {
  id: string
  alert_type: string
  severity: 'high' | 'medium' | 'low'
  headline: string
  created_at: string
  detail?: Record<string, unknown>
}

/** Severity is expressed by border weight and a label, never by color. */
const severityStyle: Record<Alert['severity'], string> = {
  high: 'border-l-4 border-ink',
  medium: 'border-l-2 border-ink',
  low: 'border-l border-gray-400',
}

const severityBadge: Record<Alert['severity'], 'solid' | 'outline' | 'muted'> = {
  high: 'solid',
  medium: 'outline',
  low: 'muted',
}

export function AlertFeed({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return <p className="text-sm text-muted">No recent alerts.</p>
  return (
    <ul className="space-y-2">
      {alerts.map(a => (
        <li key={a.id} className={`pl-3 py-2 ${severityStyle[a.severity]}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant={severityBadge[a.severity]}>{a.severity}</Badge>
              <span className="text-xs uppercase tracking-wide text-muted">{a.alert_type.replace(/_/g, ' ')}</span>
            </div>
            <time className="text-xs text-muted tabular" dateTime={a.created_at}>{new Date(a.created_at).toLocaleString()}</time>
          </div>
          <p className="mt-1 text-sm font-bold">{a.headline}</p>
        </li>
      ))}
    </ul>
  )
}

export default AlertFeed
