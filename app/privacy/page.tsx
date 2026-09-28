import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How HOKU Insider collects, uses, and protects your information.',
}

const UPDATED = 'September 28, 2026'

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted mb-10">Last updated {UPDATED}</p>

        <div className="prose max-w-none text-[17px]">
          <p>
            HOKU Insider is a public-records research service operated by Hoku.fm. This policy explains what information we collect when you use the service, how we use it, and the choices you have.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li><strong>Account information.</strong> When you create an account we store your email address, your name if you provide one, and a hashed password (or the identifier returned by Google if you sign in with Google).</li>
            <li><strong>Subscription information.</strong> Payments are processed by Stripe. We store your Stripe customer and subscription identifiers, your plan, and your subscription status. We never see or store full card numbers.</li>
            <li><strong>Usage information.</strong> Pages you visit, features you use, and technical details such as browser type and approximate location derived from your IP address. See “Analytics” below.</li>
            <li><strong>Watch lists.</strong> If you choose to follow people or organizations for alerts, we store those selections with your account.</li>
          </ul>

          <h2>What we do not collect</h2>
          <p>
            We do not sell personal information. We do not run third-party advertising. We do not record the text of your searches in our analytics.
          </p>

          <h2>Analytics</h2>
          <p>
            We use <strong>PostHog</strong> to understand how the product is used and to fix problems. PostHog data is stored in PostHog&apos;s United States cloud. Specifically:
          </p>
          <ul>
            <li>We record product events such as “search performed”, “profile viewed”, or “paywall shown”. For searches we record only the length of the query and the number of results, <strong>never the search text itself</strong>. Query strings are stripped from page URLs before they are sent.</li>
            <li>If you are signed in, events are associated with an internal account identifier together with your subscription tier, whether you are staff, and your sign-up date. Your email and name are never sent to PostHog.</li>
            <li>We use <strong>session replay</strong> to see how pages are used. All form inputs are masked, and any element marked as sensitive (such as your email on the account page) is masked or blocked. Replay is disabled on account, admin, and sign-in pages.</li>
            <li>We honor the browser <strong>Do Not Track</strong> setting. If DNT is enabled, no analytics events or session recordings are captured.</li>
          </ul>
          <p>
            We also use Vercel Speed Insights, which collects anonymous performance measurements and no personal information.
          </p>

          <h2>Cookies and local storage</h2>
          <p>
            We use a session cookie to keep you signed in and local storage for analytics identifiers and small conveniences such as remembered filters. Clearing your browser storage removes them.
          </p>

          <h2>Public-records data</h2>
          <p>
            The people and organizations profiled on HOKU Insider are drawn from government records: campaign finance filings, lobbyist registrations, ethics disclosures, legislative records, regulatory dockets, procurement awards, and property records, together with published journalism. This information concerns public life and is presented for research and reporting. If you believe a record about you is inaccurate, contact us and we will review it.
          </p>

          <h2>Sharing</h2>
          <p>
            We share information only with the service providers needed to run HOKU Insider (Neon for the database and authentication, Stripe for payments, PostHog for analytics, Vercel for hosting), each bound by their own privacy commitments, or when required by law.
          </p>

          <h2>Retention and deletion</h2>
          <p>
            Account information is kept while your account is active. You can ask us to delete your account and associated data at any time. Analytics data is retained according to PostHog&apos;s default retention period.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>Enable Do Not Track in your browser to opt out of analytics entirely.</li>
            <li>Email us to access, correct, or delete your account information.</li>
            <li>Cancel your subscription at any time from your <Link href="/account">account page</Link> or by contacting us.</li>
          </ul>

          <h2>Changes</h2>
          <p>We will post any changes to this policy on this page and update the date above.</p>

          <h2>Contact</h2>
          <p>
            Questions about privacy: <a href="mailto:constellation@hoku.fm">constellation@hoku.fm</a>.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}
