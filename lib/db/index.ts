/**
 * lib/db — query layer.
 *
 *   getServiceDb()  privileged pooled Postgres (ingestion, workers, cron, admin, Stripe webhook, analytics batch)
 *   getUserClient() Neon Data API client bound to the session JWT (RLS-enforced user reads)
 *   queries/*       typed helpers over the core schema
 */
export { getServiceDb, setServiceDbForTests, closeServiceDb } from './service'
export { getUserClient, getUserClientForToken, getAnonymousToken } from './user'
export * from './types'
export * from './gating'
export * from './queries'
