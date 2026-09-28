# Analytics events (PostHog)

Source of truth: `lib/analytics-events.ts` (`EVENTS`, `EventProperties`). `tests/analytics-events.test.ts`
checks that this document lists every event and that no event name is hard-coded elsewhere.

## Transport and privacy

- Browser SDK `posthog-js`, loaded once in `app/providers.tsx`; requests go to `/ingest/*`, which
  `next.config.ts` rewrites to PostHog US cloud (`us.i.posthog.com`, assets from `us-assets.i.posthog.com`).
- `respect_dnt: true` — nothing is captured when the browser sends Do Not Track.
- `autocapture: false`; pageviews are captured manually on App Router navigations with the query
  string removed (`has_query` boolean only), so search terms never leave the browser.
- Session replay: `maskAllInputs: true`, elements marked `data-ph-mask` are masked and blocked,
  recording is stopped on `/admin/*`, `/auth/*`, and `/account`.
- `identify(user_id, { subscription_tier, is_staff, signup_date })` on sign-in; `posthog.reset()` on
  sign-out. `sanitizeIdentifyProperties` drops email/name/phone keys if ever passed.
- Server events (Stripe webhook) use `posthog-node` through `lib/analytics-server.ts` with the same
  distinct id (Neon Auth user id) and flush immediately.
- Speed Insights (`@vercel/speed-insights`) is mounted alongside; it carries no user identity.

## Events

| Event | Fired where | Properties |
|---|---|---|
| `search_performed` | `components/search/TrackSearch.tsx` after results render | `query_length` (number, not the text), `result_count`, `kind?` |
| `entity_viewed` | `components/profile/TrackEntityView.tsx` on person/org/bill pages | `kind`, `entity_id`, `gate_hit` (viewer hit a paywall on the page) |
| `network_graph_opened` | `components/graph/GraphWrapper.tsx` on mount | `entity_id?` |
| `network_graph_node_clicked` | `GraphWrapper` node click | `kind?` |
| `connection_path_requested` | connect UI (`/api/analytics/connect`) | `hops?` |
| `power_map_viewed` | power map page | `dimension?` |
| `money_flow_viewed` | bill money-flow view | `entity_id?` |
| `document_opened` | `components/profile/ArticleList.tsx` outbound document links | `source`, `doc_type?` |
| `summary_viewed` | entity summary block | `tier` (`free` or `paid`) |
| `alert_created` | account watch list | `alert_type?` |
| `alert_opened` | alert feed | `alert_type?` |
| `paywall_shown` | `components/layout/PaywallGate.tsx` when access is denied | `location` (e.g. `person_money`, `org_money`, `bill_testimony`) |
| `pricing_viewed` | `components/pricing/PricingTiers.tsx` on mount | — |
| `checkout_started` | pricing CTA click | `tier`, `interval?` (`monthly` or `yearly`) |
| `checkout_completed` | server, Stripe `checkout.session.completed` | `tier`, `amount`, `currency?` |
| `subscription_cancelled` | server, Stripe `customer.subscription.deleted` | `previous_tier?` |
| `editorial_map_viewed` | editorial map page | — |
| `export_clicked` | CSV/API export buttons | `format?`, `location?` |

## Person properties

Only `subscription_tier`, `is_staff`, `signup_date`. Never email, name, phone, or IP-derived fields
beyond PostHog's defaults (GeoIP is left at PostHog's project setting; disable it in the project if
approximate location is not wanted).

## Dashboards

`scripts/analytics/create-dashboards.ts` creates (idempotently, by name) three dashboards through
the PostHog API using `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID`:

1. **Acquisition & conversion** — pricing views → checkout started → checkout completed funnel,
   paywall_shown by location, sign-ups by day.
2. **Engagement** — searches, entity views by kind, graph opens, document opens, weekly actives by tier.
3. **Performance & health** — pageviews by path, `$pageview` with `has_query`, session replay count,
   Speed Insights link.

Run: `npx tsx --tsconfig tsconfig.scripts.json scripts/analytics/create-dashboards.ts [--dry]`.
Re-running updates the existing insights in place.
