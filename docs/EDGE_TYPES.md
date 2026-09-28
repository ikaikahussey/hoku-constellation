# Edge type vocabulary

`edge.type` is enforced by the `edge_type_vocabulary` check constraint in `db/migrations/001_core_schema.sql`. Adding a type requires a migration that alters the constraint, an entry in this file, and a zod schema in `lib/schema/attributes.ts`.

Direction is always `from_id → to_id`. Every edge cites exactly one `document`. Unmatched endpoints keep the raw name in `from_name_raw` / `to_name_raw` with `from_id` / `to_id` null.

Gating: types listed under **paid** are readable only by paid subscribers and staff (mirrors the legacy `contribution` / lobbying / ethics / testimony / contract / property RLS). All other types are public. The list lives in `app.paid_edge_types()` and `lib/db/gating.ts`.

## Money

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `contributed_to` | Campaign contribution | donor (person/org) → recipient (person candidate or org committee) | `amount`, `start_date` = contribution date, `attributes.election_period`, `attributes.contribution_type`, `attributes.non_monetary` | paid |
| `spent_with` | Campaign or lobbying expenditure paid to a vendor | spender (committee/org/lobbyist) → payee (org/person) | `amount`, `start_date`, `role` = expenditure category, `attributes.period` | paid |
| `loaned_to` | Loan to a campaign | lender → committee/candidate | `amount`, `start_date`, `attributes.interest_rate` | paid |

## Lobbying

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `lobbied_for` | Registered lobbyist relationship | lobbyist (person) or firm (org) → client (org) | `start_date` / `end_date` = registration period, `role` = "lobbyist" or "firm", `attributes.lobby_year` | paid |
| `lobbied_on` | Lobbying activity on a measure or issue | lobbyist/org → bill entity | `role` = position if stated, `attributes.issue` | paid |

## Positions and membership

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `employed_by` | Employment | person → org | `role` = title, `start_date`, `end_date`, `attributes.is_current` | public |
| `officer_of` | Officer role (CEO, president, treasurer, registered agent) | person → org | `role` = title, dates | public |
| `director_of` | Board of directors / trustee | person → org | `role` = title, dates | public |
| `member_of` | Membership in a body (committee, caucus, association) | person → org or office | `role` = title (chair, vice chair, member), dates | public |
| `appointed_to` | Board or commission appointment | person → office/org | `role` = board name, `start_date` = appointment, `end_date` = term end, `attributes.appointed_by` | public |
| `confirmed_by` | Senate confirmation of an appointee | person → office ("Hawaiʻi State Senate") | `start_date` = vote date, `attributes.gm_number`, `attributes.vote` | public |

## Legislative

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `sponsored` | Introduced or co-sponsored a measure | person (legislator) → bill | `role` = "introducer" or "cosponsor", `start_date` | public |
| `voted_on` | Recorded committee or floor vote | person → bill | `role` = aye / no / aye with reservations / excused, `attributes.committee`, `attributes.vote_type`, `start_date` | public |
| `testified_on` | Written or oral testimony | person or org → bill | `role` = support / oppose / comment, `attributes.committee`, `attributes.hearing_date`, `start_date` | paid |

## Contracts, grants, property

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `awarded_contract` | Procurement award | agency (org) → vendor (org/person) | `amount`, `start_date` = award date, `end_date`, `attributes.solicitation_id`, `attributes.method` | paid |
| `awarded_grant` | Grant-in-aid or federal grant | grantor (org) → grantee (org) | `amount`, `start_date`, `attributes.program` | paid |
| `owns` | Real property ownership | owner (person/org) → parcel | `role` = fee owner / lessee owner, `attributes.assessed_value`, `attributes.assessment_year`, `start_date` | paid |
| `leases` | State land lease or revocable permit | lessee (person/org) → parcel or org (DLNR/DOT) | `amount` = annual rent, dates, `role` = lease type | paid |
| `party_to` | Party to a regulatory docket or case | person/org → docket | `role` = applicant / intervenor / regulator / counsel / respondent | public |

## Ethics and licensing

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `disclosed_interest` | Financial-disclosure line item | filer (person) → org or parcel | `role` = interest category (income, asset, liability, business, real property), `attributes.filing_year`, `attributes.value_range` | paid |
| `licensed_by` | Professional or business license | licensee → licensing agency (org) | `role` = license type, `attributes.license_number`, dates, `attributes.status` | public |
| `sanctioned_by` | Enforcement action, charge, exclusion, debarment | subject → agency | `role` = action type, `amount` = penalty, `start_date`, `attributes.case_number` | public |

## Editorial

| Type | Meaning | from → to | Fields | Gating |
|---|---|---|---|---|
| `mentioned_in` | Entity mentioned in a document (article, agenda, event) | entity → (document via `document_id`); `to_id` null | `role` = mention type (subject, quoted, investigated, mentioned, participant), `start_date` = publication date | public |

`mentioned_in` is the one type where `to_id` is null by design: the document itself is the target.

## Legacy mapping

| Legacy | Core |
|---|---|
| `relationship.relationship_type` in (employee, employed, staff) | `employed_by` |
| officer, executive, treasurer, president, ceo, leadership, executive_oversight, former_executive | `officer_of` (`end_date`/`attributes.is_current=false` for "former_*") |
| board_member, director, trustee | `director_of` |
| member, former_member, affiliated_with, endorsed | `member_of` |
| appointed_to, appointed_by | `appointed_to` |
| lobbyist_for, lobbies | `lobbied_for` |
| donor_to | `contributed_to` (no amount) |
| counsel, predecessor, other unknown values | `member_of` with `role` = original `relationship_type` (documented, reviewable) |
| `contribution` | `contributed_to` |
| `lobbyist_registration` | `lobbied_for` |
| `lobbyist_expenditure`, `org_lobbying_expenditure` | `spent_with` |
| `financial_disclosure` | `disclosed_interest` |
| `puc_participant` | `party_to` |
| `legislative_testimony` | `testified_on` |
| `government_contract` | `awarded_contract` (grant when `raw_record` award type is a grant) |
| `property_ownership` | `owns` |
| `article_entity_mention` | `mentioned_in` |
| `timeline_event` | `mentioned_in` with `role` = event_type against a `doc_type='event'` document |
