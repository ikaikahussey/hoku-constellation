import { requireWorkspace } from '@/lib/workspace'
import { PRICING, formatUsd, priceId, type PaidPlan } from '@/lib/billing/plans'
import { seatsUsed } from '@/lib/teams'
import { ActionForm } from '@/components/workspace/ActionForm'
import { Badge } from '@/components/ui/Badge'
import { inputClass } from '@/components/ui/Input'
import { buttonClass } from '@/components/ui/Button'
import { cancelAction, checkoutAction, invoiceAction, planAction, portalAction, seatsAction } from '../actions'

export const metadata = { title: 'Billing' }

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const ws = await requireWorkspace('/workspace/billing')
  const { checkout } = await searchParams
  const t = ws.team
  const used = await seatsUsed(ws.db, t.id)
  const subscribed = !!t.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(t.subscription_status)
  const plans = (Object.keys(PRICING.plans) as PaidPlan[])
  const coupons = Object.entries(PRICING.coupons)
  return (
    <div className="space-y-8">
      <header><h1 className="text-3xl font-bold">Billing</h1>
        <p className="mt-2 flex gap-2 items-center"><Badge variant="solid">{PRICING.plans[t.plan as PaidPlan]?.name ?? 'Free'}</Badge>
          <span className="text-sm">{t.subscription_status}{t.billing_interval ? ` · billed ${t.billing_interval === 'year' ? 'annually' : 'monthly'}` : ''} · {t.seat_count} seat{t.seat_count === 1 ? '' : 's'} ({used} in use){t.collection_method === 'send_invoice' ? ` · invoiced net ${PRICING.invoice.daysUntilDue}${t.po_number ? `, PO ${t.po_number}` : ''}` : ''}{t.is_design_partner ? ' · design partner' : ''}</span></p>
        {checkout === 'success' && <p role="status" className="mt-2">Thanks. Your plan activates as soon as Stripe confirms the payment.</p>}
        {t.subscription_status === 'past_due' && <p role="alert" className="mt-2">⚠ The last payment failed. Update the card or pay the open invoice in the billing portal to restore access.</p>}
      </header>
      {!ws.isAdmin ? <p>Only the team owner or an admin can change billing.</p> : subscribed ? (
        <>
          <section className="border border-rule p-5 space-y-4">
            <h2 className="text-lg font-bold">Seats</h2>
            <ActionForm action={seatsAction} submit="Update seats" variant="secondary">
              <label htmlFor="seats" className="block text-sm font-bold mb-1">Seats</label>
              <input id="seats" name="seats" type="number" min={Math.max(1, used)} defaultValue={t.seat_count} className={`${inputClass} max-w-32`} />
              <p className="text-xs text-muted mt-1">Changes are prorated on the next invoice.</p>
            </ActionForm>
          </section>
          <section className="border border-rule p-5">
            <h2 className="text-lg font-bold mb-3">Change plan</h2>
            <ActionForm action={planAction} submit="Change plan" variant="secondary">
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label htmlFor="cp" className="block text-sm font-bold mb-1">Plan</label><select id="cp" name="plan" defaultValue={t.plan} className={inputClass}>{plans.map(p => <option key={p} value={p}>{PRICING.plans[p].name}</option>)}</select></div>
                <div><label htmlFor="ci" className="block text-sm font-bold mb-1">Billing</label><select id="ci" name="interval" defaultValue={t.billing_interval ?? 'year'} className={inputClass}><option value="year">Annual</option><option value="month">Monthly</option></select></div>
              </div>
            </ActionForm>
          </section>
          <section className="flex flex-wrap gap-3">
            {t.stripe_customer_id && <form action={portalAction}><button className={buttonClass('secondary', 'sm')}>Cards and invoices</button></form>}
            <ActionForm action={cancelAction} submit="Cancel at end of period" variant="ghost" />
          </section>
        </>
      ) : (
        <>
          <section className="border border-ink p-5">
            <h2 className="text-lg font-bold mb-3">Subscribe with a card</h2>
            <ActionForm action={checkoutAction} submit="Continue to checkout">
              <div className="grid sm:grid-cols-4 gap-3">
                <div><label htmlFor="pl" className="block text-sm font-bold mb-1">Plan</label><select id="pl" name="plan" defaultValue="pro" className={inputClass}>{plans.filter(p => !PRICING.plans[p].custom).map(p => <option key={p} value={p}>{PRICING.plans[p].name}</option>)}</select></div>
                <div><label htmlFor="iv" className="block text-sm font-bold mb-1">Billing</label><select id="iv" name="interval" defaultValue={PRICING.defaultInterval} className={inputClass}>
                  <option value="year">Annual — {formatUsd(PRICING.plans.pro.prices.year!.amount)}/seat</option><option value="month">Monthly — {formatUsd(PRICING.plans.pro.prices.month!.amount)}/seat</option></select></div>
                <div><label htmlFor="st" className="block text-sm font-bold mb-1">Seats</label><input id="st" name="seats" type="number" min={Math.max(1, used)} defaultValue={Math.max(1, used)} className={inputClass} /></div>
                <div><label htmlFor="cc" className="block text-sm font-bold mb-1">Discount</label><select id="cc" name="coupon" className={inputClass}><option value="">None</option>{coupons.map(([k, c]) => <option key={k} value={k}>{c.name} ({c.percentOff}% off)</option>)}</select></div>
              </div>
              <p className="text-xs text-muted mt-2">Reader is billed monthly for one seat. Nonprofit and newsroom pricing is verified after checkout.</p>
            </ActionForm>
          </section>
          <section className="border border-rule p-5">
            <h2 className="text-lg font-bold mb-2">Pay by invoice</h2>
            <p className="text-sm mb-3">Pro or Organization, invoiced net {PRICING.invoice.daysUntilDue}. Add your PO number and it prints on every invoice. Organization starts at {PRICING.plans.organization.minSeats} seats.</p>
            <ActionForm action={invoiceAction} submit="Request invoice billing" variant="secondary">
              <div className="grid sm:grid-cols-3 gap-3">
                <div><label htmlFor="ip" className="block text-sm font-bold mb-1">Plan</label><select id="ip" name="plan" defaultValue="organization" className={inputClass}><option value="pro">Pro</option><option value="organization">Organization</option></select></div>
                <div><label htmlFor="is" className="block text-sm font-bold mb-1">Seats</label><input id="is" name="seats" type="number" min={1} defaultValue={5} className={inputClass} /></div>
                <div><label htmlFor="ii" className="block text-sm font-bold mb-1">Billing</label><select id="ii" name="interval" defaultValue="year" className={inputClass}><option value="year">Annual</option><option value="month">Monthly (Pro only)</option></select></div>
                <div><label htmlFor="ie" className="block text-sm font-bold mb-1">Billing email</label><input id="ie" name="billing_email" type="email" defaultValue={ws.user.email} className={inputClass} /></div>
                <div><label htmlFor="po" className="block text-sm font-bold mb-1">PO number (optional)</label><input id="po" name="po_number" maxLength={30} className={inputClass} /></div>
                <div><label htmlFor="ic" className="block text-sm font-bold mb-1">Discount</label><select id="ic" name="coupon" className={inputClass}><option value="">None</option>{coupons.map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}</select></div>
              </div>
            </ActionForm>
          </section>
          {!priceId('pro', 'year') && <p className="text-xs text-muted">Stripe prices are not configured in this environment.</p>}
        </>
      )}
    </div>
  )
}
