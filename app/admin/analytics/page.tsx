import { buttonClass } from '@/components/ui/Button'

export const dynamic = 'force-dynamic'

/**
 * Product analytics (PostHog). Staff-only via the admin layout gate.
 *   NEXT_PUBLIC_POSTHOG_PROJECT_URL   — link to the PostHog project
 *   NEXT_PUBLIC_POSTHOG_DASHBOARD_URLS — comma-separated shared dashboard embed URLs
 */
export default function AdminAnalytics() {
  const projectUrl = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_URL?.trim() || null
  const dashboards = (process.env.NEXT_PUBLIC_POSTHOG_DASHBOARD_URLS ?? '')
    .split(',').map(s => s.trim()).filter(s => /^https:\/\//.test(s))

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted mt-1">Product usage for HOKU Insider: page views, searches, paywall hits and subscriptions, tracked in PostHog.</p>
        </div>
        {projectUrl && <a href={projectUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'md')}>Open PostHog project ↗</a>}
      </div>

      {dashboards.length === 0 ? (
        <div className="border border-rule p-6 text-sm max-w-2xl">
          <p className="font-bold mb-2">No dashboards embedded yet.</p>
          <p className="text-muted">
            Share a PostHog dashboard (Dashboard → Share → enable sharing) and put its embed URL in <span className="font-mono text-ink">NEXT_PUBLIC_POSTHOG_DASHBOARD_URLS</span> (comma-separated for several).
            Set <span className="font-mono text-ink">NEXT_PUBLIC_POSTHOG_PROJECT_URL</span> to link the project here.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {dashboards.map((url, i) => (
            <section key={url}>
              <div className="flex items-baseline justify-between gap-4 mb-2">
                <h2 className="text-lg font-bold">Dashboard {i + 1}</h2>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm">Open in PostHog ↗</a>
              </div>
              <iframe
                src={url}
                title={`PostHog dashboard ${i + 1}`}
                className="w-full border border-rule bg-paper"
                style={{ minHeight: '720px' }}
                loading="lazy"
                allowFullScreen
              />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
