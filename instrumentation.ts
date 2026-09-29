/**
 * Server and edge error monitoring (E8). Sentry initializes only when SENTRY_DSN is set; request
 * bodies and cookies are never sent.
 */
import * as Sentry from '@sentry/nextjs'

export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05),
    beforeSend(event) {
      if (event.request) { delete event.request.data; delete event.request.cookies }
      return event
    },
  })
}

export const onRequestError = Sentry.captureRequestError
