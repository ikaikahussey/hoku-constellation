# HOKU Insider pricing and the live-Stripe checklist

Prices live in `config/pricing.json`. Code reads display amounts from that file and Stripe ids from the env vars it names. To change a price, update the config and create a new Stripe price. Do not edit amounts in code.

## Plans

| Plan | Price | Seats | Includes |
|---|---|---|---|
| Reader | $15/month | 1 | Entity and bill pages; money, lobbying, property, and ethics records; alerts on up to 10 watch items. No client reports and no Q&A. |
| Pro | $200/seat/month or $2,000/seat/year (annual is the default on the pricing page) | 1+ | Everything in E1–E5 and E7: unlimited watchlists and alerts, client reports, briefings and dossiers, Ask HOKU Insider (100 questions per seat per day), and CSV/PDF/ICS exports |
| Organization | Custom; list price $2,000/seat/year | 5+ | Pro, plus 300 questions per seat per day, API and bulk export, custom letterhead, invoice billing (net 30 with PO numbers), and priority support |

Coupons:

| Coupon | Terms | Promotion code |
|---|---|---|
| Nonprofit and newsroom | 40% off, forever | `NONPROFIT40` |
| Design partner | 100% off for 6 months, then list price | `DESIGNPARTNER` |

**Owner decisions still open.** The build prompt says "Custom" for Organization and does not set design-partner terms. Two values in `config/pricing.json` are placeholders until the owner confirms them:

1. The Organization list price of $2,000/seat/year.
2. The design-partner coupon of 100% off for 6 months.

Change them in the config before creating live objects.

## Billing mechanics (implemented in `lib/billing`)

- **Seats.** A team's seats equal the Stripe subscription quantity. Active members plus pending invitations may not exceed it. Seat changes use `proration_behavior=create_prorations`.
- **Card billing.** Stripe Checkout in subscription mode. `client_reference_id` is `team:<id>`, and the subscription metadata carries `team_id`, `plan`, and `coupon`.
- **Invoice billing.** Pro and Organization only. The subscription is created with `collection_method=send_invoice` and `days_until_due=30`. The PO number is stored as a customer invoice custom field, so it prints on every invoice.
- **Customer portal.** Cards, invoices, and the billing address are managed in the portal. `/workspace/billing` links to it.
- **Webhook.** `/api/webhook/stripe` syncs team subscription events onto `app.team`. The fields are `plan`, `subscription_status`, `seat_count`, `billing_interval`, and `collection_method`. Entitlements follow automatically through `app.entitlements()`. `invoice.payment_failed` sets the team to `past_due`, which drops access until payment succeeds. Legacy individual subscriptions keep working through `user_account`.
- **Test mode.** `scripts/billing/setup-stripe.ts` creates everything in test mode. It refuses live keys unless the owner passes `--live --owner-confirmed`.

## Live-mode checklist (owner confirmation required)

Do these in the Stripe Dashboard (live mode), or run `scripts/billing/setup-stripe.ts --live --owner-confirmed` with a live key after confirming each item.

- [ ] **Product "HOKU Insider Reader"** (metadata `hoku_plan=reader`)
  - [ ] Price: $15.00 USD, recurring monthly, licensed, lookup key `reader_monthly` → `STRIPE_PRICE_READER_MONTHLY`
- [ ] **Product "HOKU Insider Pro"** (metadata `hoku_plan=pro`)
  - [ ] Price: $200.00 USD per unit, recurring monthly, licensed, lookup key `pro_monthly_seat` → `STRIPE_PRICE_PRO_MONTHLY`
  - [ ] Price: $2,000.00 USD per unit, recurring yearly, licensed, lookup key `pro_yearly_seat` → `STRIPE_PRICE_PRO_YEARLY`
- [ ] **Product "HOKU Insider Organization"** (metadata `hoku_plan=organization`)
  - [ ] Price: $2,000.00 USD per unit, recurring yearly, licensed, lookup key `organization_yearly_seat` → `STRIPE_PRICE_ORGANIZATION_YEARLY` (confirm the list price first)
- [ ] **Coupon `hoku_nonprofit`:** 40% off, duration forever, name "Nonprofit and newsroom" → `STRIPE_COUPON_NONPROFIT`
  - [ ] Promotion code `NONPROFIT40`. Restrict to first-time customers if eligibility is verified manually.
- [ ] **Coupon `hoku_design_partner`:** 100% off, repeating 6 months, name "Design partner" → `STRIPE_COUPON_DESIGN_PARTNER` (confirm the terms first)
  - [ ] Promotion code `DESIGNPARTNER`, max redemptions matching the number of partner teams
- [ ] **Customer portal (Settings → Billing → Customer portal):**
  - [ ] Enable invoice history
  - [ ] Enable payment method updates
  - [ ] Enable quantity updates for Pro and Organization prices
  - [ ] Enable cancellation at period end
  - [ ] Disable plan switching (plan changes go through `/workspace/billing`)
- [ ] **Invoicing (Settings → Billing → Invoices):**
  - [ ] Set the default net terms to 30 days
  - [ ] Set the invoice footer to "HOKU Insider · Hoku.fm"
  - [ ] Enable the "PO number" custom field display
- [ ] **Webhook endpoint** `https://constellation.hoku.fm/api/webhook/stripe` with these events:
  - [ ] `checkout.session.completed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
  - [ ] `invoice.payment_failed`
  - [ ] Copy the signing secret → `STRIPE_WEBHOOK_SECRET`
- [ ] **Tax:** decide on Stripe Tax for Hawaiʻi GET before launch. The owner and an accountant make this call.
- [ ] **Env:** set every env var above in Vercel production and redeploy.
- [ ] **Smoke test:** buy one annual Pro seat with a live card and the design-partner code. Confirm the team shows Pro in `/workspace/billing`, then refund.
