/**
 * In-memory Stripe API for billing tests: the real `stripe` SDK with an injected fetch that serves
 * customers, checkout sessions, subscriptions, and portal sessions. Requests are recorded (form
 * params decoded) so tests can assert exactly what would be sent in test mode.
 */
import Stripe from 'stripe'

let seq = 0

export interface Recorded { method: string; path: string; params: Record<string, string> }

export function fakeStripe() {
  const requests: Recorded[] = []
  const customers = new Map<string, Record<string, unknown>>()
  const subs = new Map<string, Stripe.Subscription>()
  const id = (p: string) => `${p}_${++seq}`
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': id('req') } })

  function makeSub(params: Record<string, string>, customer: string): Stripe.Subscription {
    const metadata: Record<string, string> = {}
    for (const [k, v] of Object.entries(params)) { const m = k.match(/^metadata\[(.+)\]$/); if (m) metadata[m[1]] = v }
    return {
      id: id('sub'), object: 'subscription', customer, status: params.collection_method === 'send_invoice' ? 'active' : 'active',
      collection_method: (params.collection_method ?? 'charge_automatically') as Stripe.Subscription.CollectionMethod,
      days_until_due: params.days_until_due ? Number(params.days_until_due) : null, metadata, cancel_at_period_end: false,
      items: { object: 'list', data: [{ id: id('si'), object: 'subscription_item', quantity: Number(params['items[0][quantity]'] ?? 1), price: { id: params['items[0][price]'] } }] },
    } as unknown as Stripe.Subscription
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const params = Object.fromEntries(new URLSearchParams(typeof init?.body === 'string' ? init.body : url.search.slice(1)))
    const path = url.pathname.replace(/^\/v1/, '')
    requests.push({ method, path, params })
    let m: RegExpMatchArray | null
    if (method === 'POST' && path === '/customers') {
      const c = { id: id('cus'), object: 'customer', ...params }
      customers.set(c.id, c)
      return json(c)
    }
    if ((m = path.match(/^\/customers\/(cus_\d+)$/))) return json({ ...customers.get(m[1]), ...params, id: m[1], object: 'customer' })
    if (method === 'POST' && path === '/checkout/sessions') return json({ id: id('cs'), object: 'checkout.session', url: 'https://checkout.stripe.test/session', ...params })
    if (method === 'POST' && path === '/billing_portal/sessions') return json({ id: id('bps'), object: 'billing_portal.session', url: 'https://billing.stripe.test/portal' })
    if (method === 'POST' && path === '/subscriptions') {
      const s = makeSub(params, params.customer)
      subs.set(s.id, s)
      return json(s)
    }
    if ((m = path.match(/^\/subscriptions\/(sub_\d+)$/))) {
      const s = subs.get(m[1])
      if (!s) return json({ error: { type: 'invalid_request_error', message: 'No such subscription' } }, 404)
      if (method === 'POST') {
        const item = s.items.data[0] as unknown as { quantity: number; price: { id: string } }
        if (params['items[0][quantity]']) item.quantity = Number(params['items[0][quantity]'])
        if (params['items[0][price]']) item.price = { id: params['items[0][price]'] }
        if (params.cancel_at_period_end) s.cancel_at_period_end = params.cancel_at_period_end === 'true'
        for (const [k, v] of Object.entries(params)) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) s.metadata[mm[1]] = v }
      }
      return json(s)
    }
    return json({ error: { type: 'invalid_request_error', message: `fake stripe: unhandled ${method} ${path}` } }, 400)
  }
  const stripe = new Stripe('sk_test_fake', { httpClient: Stripe.createFetchHttpClient(fetchImpl as typeof fetch), maxNetworkRetries: 0 })
  return { stripe, requests, subs, customers }
}
