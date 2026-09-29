import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

export const metadata: Metadata = { title: 'Accuracy', description: 'What HOKU Insider’s records, matches, scores, and AI summaries do and do not establish.' }

export default function AccuracyPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-12 prose">
        <h1 className="text-3xl sm:text-4xl font-bold">Accuracy statement</h1>
        <p className="text-sm text-muted">Draft pending legal review · September 29, 2026</p>
        <p>HOKU Insider reproduces and connects public records. We link every fact to the document it came from so you can check it yourself.</p>
        <h2>What a record shows</h2>
        <p>A record shows what a filer or agency reported, in the form they reported it. Filings can be late, amended, incomplete, or wrong. When a source is corrected, we update the record the next time we ingest it.</p>
        <h2>What a connection shows</h2>
        <p>A connection between two people or organizations means a public record names both of them in that relationship: a contribution, a board seat, a lobbying registration, testimony, or a contract. A connection is not evidence of coordination, influence, agreement, or wrongdoing. Names are matched to profiles by identifiers when possible and by name otherwise. Name matches can be wrong, and matches still under review are marked.</p>
        <h2>What a score shows</h2>
        <p>Influence scores summarize how much documented public activity an entity has compared with others. They are not a measure of character, merit, or undisclosed power. See the <Link href="/methodology">methodology</Link>.</p>
        <h2>What AI summaries show</h2>
        <p>Briefings, dossiers, client reports, and answers are written by an AI model from the cited records only. Every sentence links to its source. They are summaries, not findings, and they do not predict how a bill will fare. Read the cited documents before relying on a summary.</p>
        <h2>Corrections</h2>
        <p>Use “Report an error” on any page. We acknowledge reports within one business day. See the <Link href="/terms">terms</Link> for details.</p>
      </main>
      <Footer />
    </>
  )
}
