# HOKU Insider — legal review packet (media-law counsel)

**LAUNCH IS BLOCKED ON COUNSEL SIGN-OFF.** Part E features must not be marketed to design partners or the public until counsel signs off in the last section of this document. This covers bill briefings, dossiers, client reports, Ask HOKU Insider, and alerts.

This packet collects every public-facing inference template in HOKU Insider:

- how relationships are phrased
- score labels
- briefing and dossier sections
- alert and report wording
- the exact instructions given to the AI model
- sample AI outputs

Each item names the source file so counsel's edits can be applied directly.

## 1. What HOKU Insider publishes

- **Records.** Each public record is stored as a document and linked from every statement that relies on it (`/documents/<id>`).
- **Relationships.** Each fact in a record becomes one relationship between two parties, for example "A contributed to B" or "A testified (oppose) on HB 123". The relationship vocabulary is `docs/EDGE_TYPES.md`.
- **Matching.** Records are matched to profiles by identifier; otherwise by name with thresholds of 95% (automatic) and 70% (staff review). Below 70% the name stays as filed and is not linked (`lib/entity-match.ts`).
- **Draft public pages for counsel review:**
  - `/accuracy` (`app/accuracy/page.tsx`)
  - `/methodology` (`app/methodology/page.tsx`)
  - `/terms` (`app/terms/page.tsx`)
  - `/privacy` (`app/privacy/page.tsx`)

## 2. Influence score labels

Source: `lib/analytics/scoring/score-config.ts` and `app/methodology/page.tsx`.

| Label shown | Weight | Computed from |
|---|---|---|
| Political money | 25% | Contributions given and received |
| Institutional position | 20% | Offices, board seats, executive titles (title tiers such as governor = 100, board member = 15) |
| Lobbying | 20% | Registrations, clients, expenditures, bills lobbied |
| Economic footprint | 15% | Contracts, grants, property |
| Network centrality | 10% | Position in the graph of recorded relationships |
| Public visibility | 10% | Appearances in reporting and public records |

Disclaimer text (methodology): "A score is not a measure of wrongdoing, merit, or real-world power."

**Question for counsel:** Is "influence score" acceptable as a label, or should it be renamed, for example to "public-record activity score"?

## 3. Bill briefing sections

Source: `lib/briefings/index.ts` (`buildBillBriefing`). Every line cites at least one document.

| Section | Template | Notes shown to readers |
|---|---|---|
| Summary | AI-written, 2–4 sentences, plain-language summary of the current draft and the latest amendment (see §7) | "Written by AI from the cited records only; each sentence links to its source." |
| Status and next deadline | "Current status: {status}", "Current referral: {codes}", "Next deadline: testimony for the {committee} hearing at {time} HST is due by {time} HST" | Session-calendar deadlines appear once the Legislature's session calendar is ingested |
| Changes between drafts | "{date} {status line naming HD/SD/CD}" | |
| Committees of referral | "{CODE} members: {names (role)}", "{CODE} vote: {vote} — {names}; …", "Floor votes recorded: {n vote}, …" | |
| Sponsors | "{name} ({introducer/co-introducer})" | |
| Testimony by position | "In support: {n} testifiers, including {organizations}" (same for "In opposition" and "Comments") | |
| Contributions in the last two election cycles | "{donor} → {recipient}: ${amount} in {n} contribution(s)" | "From testifying organizations, their officers and directors, and organizations lobbying on this bill, to the sponsors and to members of the referral committees." |
| Lobbying filings naming this bill | "{organization} ({position}) reported lobbying on this bill" | |
| Indicators | "Testimony balance: {s} support, {o} oppose, {c} comments", "Sponsors: {n} legislator(s) ({i} introducer, {c} co-introducers)", "Committee and floor votes so far: {counts}" | "Factual signals recorded so far. This section does not predict an outcome." |

**Questions for counsel:**

1. The contributions section places donors' money next to their testimony and lobbying on a specific bill. Is the explanatory note sufficient to avoid an implication of quid pro quo, or does the section need a stronger disclaimer or a different title?
2. Is "Indicators" acceptable as a title, given that it never predicts an outcome?

## 4. Dossier sections (people and organizations)

Source: `lib/briefings/index.ts` (`buildDossier`).

| Section | Template |
|---|---|
| Summary | AI-written, 2–4 sentences: "a neutral overview of {name}'s documented roles, money, and lobbying relationships". The model is told not to infer motives, relationships, or wrongdoing beyond the facts. |
| Roles and appointments | "{relation} {organization} — {role} ({start} to {end})" |
| Money in and money out | "From {counterparty}: ${total} in {n} records", "To {counterparty}: …" |
| Lobbying relationships | "Registered to lobby for {client}", "Lobbied on {bill} ({position})", "{lobbyist} registered to lobby for {name}" |
| Contracts and grants | "{awardee} awarded contract {agency}: ${amount}" |
| Property | "Owns {parcel}", "Leases {parcel}" |
| Testimony | "Testified ({position}) on {bill}" |
| Recent documents | "{date} — {title}" |
| Connections to watched entities | "{A} —{relation}— {B} —{relation}— {C}". The note reads: "Shortest chains of recorded relationships (up to three steps). A connection is not evidence of coordination." |

**Question for counsel:** Are three-step connection chains to a subscriber's watched entities acceptable when shown only to that subscriber's team, not publicly?

## 5. Alert wording

Source: `lib/alerts/events.ts` and `lib/alerts/matcher.ts`. Alerts go only to the team that set them up.

| Event label | Headline template |
|---|---|
| Status change, new draft, hearing scheduled/changed/canceled, committee report, vote recorded | "{bill}: {status text as published by the Legislature}" |
| Testimony deadline within 48 hours | "{bill}: testimony due {time}" |
| New testimony filed | "{bill}: new testimony filed" |
| New record (watched person or organization) | "{A} {relation} {B}", for example "Watched Donor contributed to Candidate" |
| Mentioned in a document | "{name} mentioned in {document title}" |
| Keyword match | "“{keyword}” in {document title}" |
| Committee referral or hearing notice | "{CODE}: {bill} — {status}" |

## 6. Client reports

Source: `lib/reports/index.ts`. A subscriber team generates and edits the report, and a team member must approve it before it goes to the team's client. Reports carry the team's name and logo. The footer disclaimer reads: "Compiled by HOKU Insider from public records. Every statement cites its source document; verify against the source before relying on it. Not legal advice." (`lib/render/model.ts`)

The sections are:

- Summary: AI-written, 3–6 sentences. The team may edit it, and uncited sentences are flagged before approval.
- Bill status changes
- Hearings
- Votes
- Drafts and committee reports
- Outcomes
- Testimony
- Related activity
- Upcoming hearings and deadlines
- Sources

**Question for counsel:** Once a team edits and approves a report, who is its publisher? The terms currently say the team is responsible for reports it approves and sends (`app/terms/page.tsx`, "Teams and client reports").

## 7. Instructions given to the AI model (verbatim)

Source: `lib/ai/claude.ts`.

```
You write for HOKU Insider, a research service on Hawaiʻi government and influence.
Use only the facts provided. Each fact has a handle like D1.
Write plain, neutral, declarative sentences. No speculation, predictions, adjectives of judgment, or advice.
Every sentence must state something found in the cited facts and list those facts' handles in "cites".
Put exactly one sentence in each "text"; never put citation markers in the text.
If the facts do not support what is asked, set "insufficient" to true and return a single sentence saying so, citing the closest fact if any exists; otherwise return an empty list.
```

Additional rules by use:

- Reports: "Do not characterize outcomes as good or bad for the client." "Refer to bills by their number as given in the facts."
- Bill briefings: "Explain in plain language; do not quote legal boilerplate." "Never predict whether the bill will pass."
- Dossiers: "Do not infer motives, relationships, or wrongdoing beyond the facts."
- Q&A: "If the facts do not answer the question, set insufficient to true and say what the records do and do not show." "Do not use outside knowledge."

**Enforcement.** A validator (`lib/ai/citations.ts`) rejects any output in which:

- a sentence has no citation,
- a sentence cites a document the model was not given, or
- one slot holds more than one sentence.

After one rejected attempt the model gets one retry. After a second rejection, the published text is the list of cited facts with no AI prose. Tests: `tests/reports-briefings.test.ts`, including the fixture `tests/fixtures/citations/uncited.json`, which contains "The bill has strong momentum and is likely to pass." and must be rejected.

## 8. Sample outputs

The golden files below come from a deterministic test model, not from Claude. They show the structure and citation behavior exactly, but not the model's prose:

- `tests/golden/report-content.json`: a client report
- `tests/golden/report-content-facts-only.json`: a report after the model failed validation twice
- `tests/golden/bill-briefing.json`: a bill briefing

**Before sign-off**, staff must generate real samples from the live model on the production dataset and attach them to this packet. Use a staging team with `ANTHROPIC_API_KEY` set, and produce:

- [ ] 3 bill briefings: a contested bill, a bill with heavy lobbying, and a bill with committee votes
- [ ] 3 dossiers: a legislator, a lobbying firm, and a major contributor
- [ ] 2 weekly client reports
- [ ] 10 Ask HOKU Insider answers, including at least 3 where the records do not support an answer

**Checks on each sample:**

- Every sentence has a citation.
- No sentence goes beyond its cited facts.
- No predictive or evaluative language.
- Names are matched correctly. Spot-check the cited documents.

## 9. Other items for review

- **Alert emails.** They contain one-click unsubscribe (RFC 8058) and an open-tracking pixel. The pixel is disclosed in the privacy policy.
- **Corrections.** "Report an error" is on every entity, bill, and document page. Staff acknowledge within one business day (`/admin/corrections`).
- **Data about private individuals.** Testifiers and small donors appear by name because the source records are public. Counsel should confirm the approach for private individuals who testify, including whether their names should appear in dossiers and briefings or only on source documents.
- **Stripe checkout and invoices.** Tax treatment (Hawaiʻi GET) is pending an owner decision.

## Sign-off

| Reviewer | Scope | Decision | Date |
|---|---|---|---|
| Media-law counsel | §§ 2–9 and the public pages in §1 | _pending_ | |
| Owner | Final launch approval | _blocked until counsel signs_ | |
