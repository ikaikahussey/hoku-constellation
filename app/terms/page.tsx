import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing use of HOKU Insider.',
}

const UPDATED = 'September 28, 2026'

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted mb-10">Last updated {UPDATED}</p>

        <div className="prose max-w-none text-[17px]">
          <p>By using HOKU Insider (the “Service”), operated by Hoku.fm, you agree to these terms.</p>

          <h2>The Service</h2>
          <p>
            HOKU Insider compiles public records and published reporting about people and organizations in Hawaiʻi public life and presents them with links to original sources. Free accounts can search and view public connections. Paid subscriptions unlock additional detail such as campaign finance records, lobbying, testimony, contracts, and property data.
          </p>

          <h2>Accuracy</h2>
          <p>
            We work to link records to the right people and organizations, and we flag matches that are still under review. Records are presented as they appear in original filings, which may themselves contain errors. The Service is provided “as is” for research and reporting; verify against the cited source before relying on any record.
          </p>

          <h2>Your account</h2>
          <p>
            You are responsible for activity under your account. Accounts are for one person; institutional plans cover multiple named seats. Do not share credentials or circumvent access controls.
          </p>

          <h2>Subscriptions and billing</h2>
          <p>
            Paid plans renew automatically until cancelled. Trials convert to paid at the end of the trial period unless cancelled. You may cancel at any time; access continues until the end of the paid period. Prices are listed on the <Link href="/pricing">pricing page</Link> and may change with notice.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>Do not scrape, bulk-download, or redistribute the database. Professional and institutional plans include API and CSV access subject to the rate limits and attribution described in the API documentation.</li>
            <li>Do not use the Service to harass, stalk, or discriminate against any person.</li>
            <li>Do not attempt to interfere with the Service or access it by unauthorized means.</li>
          </ul>

          <h2>Intellectual property</h2>
          <p>
            Underlying public records are not owned by us. Our compilation, entity resolution, summaries, editorial content, and software are owned by Hoku.fm. You may quote and cite the Service with attribution.
          </p>

          <h2>Corrections</h2>
          <p>
            If you believe a record about you or your organization is wrong, email <a href="mailto:constellation@hoku.fm">constellation@hoku.fm</a> with the specific record and the source that contradicts it. We will review and correct or annotate the record.
          </p>

          <h2>Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, Hoku.fm is not liable for indirect, incidental, or consequential damages arising from use of the Service. Our total liability is limited to the amount you paid us in the twelve months before the claim.
          </p>

          <h2>Termination</h2>
          <p>We may suspend or close accounts that violate these terms. You may close your account at any time.</p>

          <h2>Governing law</h2>
          <p>These terms are governed by the laws of the State of Hawaiʻi.</p>

          <h2>Contact</h2>
          <p><a href="mailto:constellation@hoku.fm">constellation@hoku.fm</a></p>

          <p>See also our <Link href="/privacy">Privacy Policy</Link>.</p>
        </div>
      </main>
      <Footer />
    </>
  )
}
