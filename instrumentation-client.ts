/** Browser error monitoring (E8). Active only when NEXT_PUBLIC_SENTRY_DSN is set; no replay, no PII. */
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0,
    denyUrls: [/extensions\//i, /^chrome:\/\//i],
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
