import type { Metadata } from 'next'
import { SCORE_WEIGHTS } from '@/lib/analytics/scoring/score-config'
import { AUTO_MATCH_THRESHOLD, REVIEW_THRESHOLD } from '@/lib/entity-match'
import { getSessionUser } from '@/lib/auth'
import { Header } from '@/components/layout/Header'
import { Footer } from '@/components/layout/Footer'

export const metadata: Metadata = { title: 'Methodology', description: 'How HOKU Insider builds influence scores, matches records to people and organizations, and writes AI summaries, and the limits of each.' }

const DIM_LABEL: Record<string, string> = {
  political_money: 'Political money (contributions given and received)', institutional_position: 'Institutional position (offices, boards, executive roles)',
  lobbying: 'Lobbying (registrations, clients, expenditures, bills lobbied)', economic_footprint: 'Economic footprint (contracts, grants, property)',
  network_centrality: 'Network centrality (position in the graph of recorded relationships)', public_visibility: 'Public visibility (appearances in reporting and public records)',
}

export default async function MethodologyPage() {
  const user = await getSessionUser()
  return (
    <>
      <Header signedIn={!!user} />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-12 prose">
        <h1 className="text-3xl sm:text-4xl font-bold">Methodology</h1>
        <p>HOKU Insider compiles public records: campaign finance, lobbying, ethics filings, legislative actions, contracts, property, and regulatory dockets. Every fact is tied to the source document it came from. This page explains how the records are connected, scored, and summarized, and where each method falls short.</p>

        <h2>Records and relationships</h2>
        <p>Each source record is stored as a document with a checksum of the original. Each fact in a record, such as a contribution, a vote, a board appointment, or a filing, becomes one relationship that points back to that document. Coverage and update times for every source are on the <a href="/coverage">coverage page</a>.</p>
        <p><strong>Limits.</strong> Records are only as complete and correct as the agency that publishes them. Some filings are late, amended, or scanned. A missing relationship does not mean the relationship does not exist.</p>

        <h2>Matching records to people and organizations</h2>
        <p>A name in a record is matched to a person or organization in this order:</p>
        <ol>
          <li>By an official identifier when one exists, such as a campaign registration number, EIN, SEC number, or tax map key.</li>
          <li>Otherwise by name. Names are normalized (case, punctuation, ʻokina and kahakō, suffixes), then compared for similarity.</li>
        </ol>
        <p>Matches scoring at least {Math.round(AUTO_MATCH_THRESHOLD * 100)}% are linked automatically. Matches from {Math.round(REVIEW_THRESHOLD * 100)}% to {Math.round(AUTO_MATCH_THRESHOLD * 100)}% go to staff review. Anything lower keeps the name exactly as filed and is not linked. Bills, dockets, and parcels are matched only by their official numbers. Separate records known to be the same entity are merged, and the merge is kept.</p>
        <p><strong>Limits.</strong> Two people with the same name can be confused when no identifier is available, and one person can appear under several spellings. Unlinked names stay visible in their source documents. <a href="/corrections/new?page=/methodology">Report a wrong match</a>.</p>

        <h2>Influence scores</h2>
        <p>The influence score (0–100) is a weighted combination of six measures, each computed from recorded relationships and ranked against all scored entities:</p>
        <ul>{Object.entries(SCORE_WEIGHTS).map(([k, w]) => <li key={k}>{DIM_LABEL[k] ?? k}: {Math.round(w * 100)}%</li>)}</ul>
        <p>Scores are recomputed daily. They measure how much documented activity an entity has in the public record relative to others.</p>
        <p><strong>Limits.</strong> A score is not a measure of wrongdoing, merit, or real-world power. Activity that does not appear in public records, such as informal relationships, unreported spending, or federal-only activity outside our sources, is not counted. Entities with incomplete matching score lower than they should.</p>

        <h2>AI summaries, briefings, reports, and answers</h2>
        <p>Summaries in bill briefings, dossiers, client reports, and Ask HOKU Insider are written by a large language model (Anthropic’s Claude). The model gets only facts assembled from HOKU Insider’s records, each labeled with its source document. It must cite at least one source document for every sentence. A validator rejects any output with a sentence that has no citation or cites a document it was not given. After two rejected attempts, we publish the facts directly, with no AI text. Ask HOKU Insider says so when the records do not support an answer.</p>
        <p>The “Indicators” section of a bill briefing lists factual signals: votes so far, the balance of testimony, and sponsors. It does not predict outcomes.</p>
        <p><strong>Limits.</strong> A citation shows where a statement came from, not that the model summarized it perfectly. The model can still compress or emphasize facts in ways a careful reader would not. Always check the cited documents before relying on a summary. Client reports are drafts until someone on the subscriber’s team approves them.</p>

        <h2>Corrections</h2>
        <p>Every entity, bill, and document page has a “Report an error” link. Staff acknowledge reports within one business day, correct the record when it is wrong, and note what changed.</p>
      </main>
      <Footer />
    </>
  )
}
