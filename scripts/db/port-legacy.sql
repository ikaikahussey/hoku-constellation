-- ================================================================================================
-- Legacy (Supabase public schema restored as `legacy`) → core schema port.
--
-- Idempotent and deterministic:
--   * entity ids for person/org are the legacy ids; bill/docket/parcel ids are md5(kind:key) uuids.
--   * every legacy fact row yields exactly one document whose checksum is
--       sha256('legacy:<table>:' || to_jsonb(row)::text)
--     so a re-run inserts nothing (ON CONFLICT (checksum) DO NOTHING).
--   * edges dedup on (document_id, type, from_name_raw, to_name_raw, role).
--
-- Usage:  psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f scripts/db/port-legacy.sql
--         or  npx tsx scripts/db/port-legacy.ts [--reconcile]
-- ================================================================================================

create schema if not exists port;

create or replace function port.checksum(tbl text, r jsonb) returns text
  language sql immutable
  as $$ select encode(sha256(convert_to('legacy:' || tbl || ':' || (r - 'imported_at' - 'ingested_at')::text, 'utf8')), 'hex') $$;

create or replace function port.det_uuid(key text) returns uuid
  language sql immutable
  as $$ select md5('hoku:' || key)::uuid $$;

-- '2017-2018' → 2017-01-01 ; '2026' → 2026-01-01 ; '2014-2016' → 2014-01-01
create or replace function port.period_start(p text) returns date
  language sql immutable
  as $$ select case when p ~ '^\d{4}' then (substring(p from '^\d{4}') || '-01-01')::date else null end $$;

create or replace function port.period_end(p text) returns date
  language sql immutable
  as $$ select case when p ~ '\d{4}$' then (substring(p from '\d{4}$') || '-12-31')::date else null end $$;

create or replace function port.rel_type(t text) returns text
  language sql immutable
  as $$
    select case lower(coalesce(t, ''))
      when 'employee' then 'employed_by'
      when 'employed' then 'employed_by'
      when 'staff' then 'employed_by'
      when 'officer' then 'officer_of'
      when 'executive' then 'officer_of'
      when 'treasurer' then 'officer_of'
      when 'president' then 'officer_of'
      when 'ceo' then 'officer_of'
      when 'leadership' then 'officer_of'
      when 'executive_oversight' then 'officer_of'
      when 'former_executive' then 'officer_of'
      when 'board_member' then 'director_of'
      when 'director' then 'director_of'
      when 'trustee' then 'director_of'
      when 'member' then 'member_of'
      when 'former_member' then 'member_of'
      when 'affiliated_with' then 'member_of'
      when 'endorsed' then 'member_of'
      when 'appointed_to' then 'appointed_to'
      when 'appointed_by' then 'appointed_to'
      when 'lobbyist_for' then 'lobbied_for'
      when 'lobbies' then 'lobbied_for'
      when 'donor_to' then 'contributed_to'
      else 'member_of'
    end
  $$;

-- matched = both endpoints resolved; review = one resolved; unmatched = neither.
create or replace function port.match_status(f uuid, t uuid) returns text
  language sql immutable
  as $$ select case when f is not null and t is not null then 'matched'
                    when f is not null or t is not null then 'review'
                    else 'unmatched' end $$;

create or replace function port.slug(s text) returns text
  language sql immutable
  as $$ select nullif(regexp_replace(regexp_replace(lower(translate(coalesce(s,''), 'ʻ‘’''`', '')), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), '') $$;

-- ------------------------------------------------------------------------------------------------
-- 1. Entities: person, organization
-- ------------------------------------------------------------------------------------------------
insert into entity (id, kind, name, aliases, identifiers, attributes, created_at, updated_at)
select p.id, 'person', p.full_name, coalesce(p.aliases, '{}'),
       jsonb_build_object('legacy_id', p.id::text),
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_table', 'person',
         'slug', coalesce(p.slug, port.slug(p.full_name) || '-' || left(p.id::text, 8)),
         'first_name', p.first_name, 'last_name', p.last_name,
         'entity_types', to_jsonb(coalesce(p.entity_types, '{}')),
         'office_held', p.office_held, 'party', p.party, 'district', p.district, 'island', p.island,
         'term_start', p.term_start, 'term_end', p.term_end,
         'bio_summary', p.bio_summary, 'photo_url', p.photo_url, 'website_url', p.website_url,
         'status', p.status, 'is_featured', coalesce(p.is_featured, false), 'visibility', p.visibility)),
       coalesce(p.created_at, now()), coalesce(p.updated_at, now())
  from legacy.person p
on conflict (id) do nothing;

insert into entity (id, kind, name, aliases, identifiers, attributes, created_at, updated_at)
select o.id, 'org', o.name, coalesce(o.aliases, '{}'),
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_id', o.id::text,
         'ein', nullif(o.ein, ''), 'dcca', nullif(o.dcca_file_number, ''),
         'sec_cik', nullif(o.sec_cik, ''), 'fec_id', nullif(o.fec_committee_id, ''))),
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_table', 'organization',
         'slug', coalesce(o.slug, port.slug(o.name) || '-' || left(o.id::text, 8)),
         'org_type', o.org_type, 'sector', o.sector, 'island', o.island,
         'description', o.description, 'website_url', o.website_url,
         'status', o.status, 'is_featured', coalesce(o.is_featured, false), 'visibility', o.visibility)),
       coalesce(o.created_at, now()), coalesce(o.updated_at, now())
  from legacy.organization o
on conflict (id) do nothing;

-- ------------------------------------------------------------------------------------------------
-- 2. Relationship → edge (synthetic document per row; relationships were observed facts w/o raw record)
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'legacy_relationship', 'relationship:' || r.id, 'record', r.source_url,
       coalesce(r.title, r.relationship_type), r.start_date, to_jsonb(r),
       port.checksum('relationship', to_jsonb(r)), coalesce(r.created_at, now())
  from legacy.relationship r
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, end_date, document_id, match_status, match_confidence, attributes)
select port.rel_type(r.relationship_type),
       coalesce(r.source_person_id, r.source_org_id), coalesce(r.target_person_id, r.target_org_id),
       fe.name, te.name, r.title,
       r.start_date, r.end_date,
       d.id, 'matched', 1.0,
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_relationship_type', r.relationship_type,
         'is_current', r.is_current,
         'source_description', r.source_description,
         'notes', r.notes,
         'legacy_id', r.id::text))
  from legacy.relationship r
  join document d on d.source = 'legacy_relationship' and d.source_record_id = 'relationship:' || r.id
  left join entity fe on fe.id = coalesce(r.source_person_id, r.source_org_id)
  left join entity te on te.id = coalesce(r.target_person_id, r.target_org_id)
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 3. Contribution → contributed_to
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select c.source, 'contribution:' || c.id, 'contribution', null,
       c.donor_name_raw || ' → ' || c.recipient_name_raw, c.contribution_date,
       coalesce(c.raw_record, to_jsonb(c)), port.checksum('contribution', to_jsonb(c)), coalesce(c.imported_at, now())
  from legacy.contribution c
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, document_id, match_status, match_confidence, attributes)
select 'contributed_to',
       coalesce(c.donor_person_id, c.donor_org_id), coalesce(c.recipient_person_id, c.recipient_org_id),
       c.donor_name_raw, c.recipient_name_raw, c.contribution_type, c.amount, c.contribution_date,
       d.id,
       case when c.match_status = 'rejected' then 'unmatched'
            else port.match_status(coalesce(c.donor_person_id, c.donor_org_id), coalesce(c.recipient_person_id, c.recipient_org_id)) end,
       c.match_confidence,
       jsonb_strip_nulls(jsonb_build_object(
         'election_period', c.election_period,
         'contribution_type', c.contribution_type,
         'source', c.source,
         'source_file', c.source_file,
         'legacy_match_status', c.match_status,
         'legacy_id', c.id::text))
  from legacy.contribution c
  join document d on d.source = c.source and d.source_record_id = 'contribution:' || c.id
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 4. Lobbying → lobbied_for / spent_with
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_ethics', 'lobbyist_registration:' || l.id, 'lobbyist_registration', l.source_url,
       coalesce(l.raw_record ->> 'Full Name', pe.name, 'lobbyist') || ' for ' || coalesce(l.client_name_raw, oe.name, 'client'),
       coalesce(port.period_start(l.registration_period), (l.raw_record ->> 'Registration Date')::date),
       coalesce(l.raw_record, to_jsonb(l)), port.checksum('lobbyist_registration', to_jsonb(l)), coalesce(l.imported_at, now())
  from legacy.lobbyist_registration l
  left join entity pe on pe.id = l.lobbyist_person_id
  left join entity oe on oe.id = l.client_org_id
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, end_date, document_id, match_status, match_confidence, attributes)
select 'lobbied_for', l.lobbyist_person_id, l.client_org_id,
       coalesce(l.raw_record ->> 'Full Name', pe.name), coalesce(l.client_name_raw, oe.name),
       'lobbyist',
       port.period_start(l.registration_period), port.period_end(l.registration_period),
       d.id, port.match_status(l.lobbyist_person_id, l.client_org_id), null,
       jsonb_strip_nulls(jsonb_build_object(
         'lobby_year', l.registration_period,
         'issues', to_jsonb(coalesce(l.issues, '{}')),
         'firm_org_id', l.lobbying_firm_org_id::text,
         'legacy_id', l.id::text))
  from legacy.lobbyist_registration l
  join document d on d.source = 'hawaii_ethics' and d.source_record_id = 'lobbyist_registration:' || l.id
  left join entity pe on pe.id = l.lobbyist_person_id
  left join entity oe on oe.id = l.client_org_id
on conflict do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_ethics', 'lobbyist_expenditure:' || x.id, 'lobbyist_expenditure', null,
       'Lobbyist expenditure ' || coalesce(x.period, ''), port.period_start(x.period),
       coalesce(x.raw_record, to_jsonb(x)), port.checksum('lobbyist_expenditure', to_jsonb(x)), coalesce(x.imported_at, now())
  from legacy.lobbyist_expenditure x
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, end_date, document_id, match_status, attributes)
select 'spent_with', x.lobbyist_person_id, x.client_org_id, pe.name, oe.name, x.expenditure_type, x.amount,
       port.period_start(x.period), port.period_end(x.period), d.id,
       port.match_status(x.lobbyist_person_id, x.client_org_id),
       jsonb_strip_nulls(jsonb_build_object('period', x.period, 'registration_id', x.registration_id::text, 'legacy_id', x.id::text))
  from legacy.lobbyist_expenditure x
  join document d on d.source = 'hawaii_ethics' and d.source_record_id = 'lobbyist_expenditure:' || x.id
  left join entity pe on pe.id = x.lobbyist_person_id
  left join entity oe on oe.id = x.client_org_id
on conflict do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_ethics', 'org_lobbying_expenditure:' || x.id, 'lobbyist_expenditure', null,
       coalesce(x.org_name_raw, 'Organization') || ' lobbying expenditure ' || coalesce(x.period, ''), port.period_start(x.period),
       coalesce(x.raw_record, to_jsonb(x)), port.checksum('org_lobbying_expenditure', to_jsonb(x)), coalesce(x.imported_at, now())
  from legacy.org_lobbying_expenditure x
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, end_date, document_id, match_status, attributes)
select 'spent_with', x.org_id, null, coalesce(x.org_name_raw, oe.name), 'Lobbying (' || coalesce(x.expenditure_type, 'expenditure') || ')',
       x.expenditure_type, x.amount, port.period_start(x.period), port.period_end(x.period), d.id,
       port.match_status(x.org_id, null),
       jsonb_strip_nulls(jsonb_build_object('period', x.period, 'legacy_id', x.id::text))
  from legacy.org_lobbying_expenditure x
  join document d on d.source = 'hawaii_ethics' and d.source_record_id = 'org_lobbying_expenditure:' || x.id
  left join entity oe on oe.id = x.org_id
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 5. Financial disclosure → disclosed_interest
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_ethics', 'financial_disclosure:' || f.id, 'financial_disclosure', f.source_url,
       coalesce(pe.name, 'Filer') || ' financial disclosure ' || f.filing_year, make_date(f.filing_year, 1, 1),
       coalesce(f.raw_record, to_jsonb(f)), port.checksum('financial_disclosure', to_jsonb(f)), coalesce(f.imported_at, now())
  from legacy.financial_disclosure f
  left join entity pe on pe.id = f.person_id
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, attributes)
select 'disclosed_interest', f.person_id, null, pe.name, coalesce(f.position_held, 'Financial disclosure'), 'filing',
       make_date(f.filing_year, 1, 1), d.id, port.match_status(f.person_id, null),
       jsonb_strip_nulls(jsonb_build_object('filing_year', f.filing_year, 'position_held', f.position_held,
                                            'financial_interests', f.financial_interests, 'legacy_id', f.id::text))
  from legacy.financial_disclosure f
  join document d on d.source = 'hawaii_ethics' and d.source_record_id = 'financial_disclosure:' || f.id
  left join entity pe on pe.id = f.person_id
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 6. PUC dockets → docket entities + docket_filing documents; participants → party_to
-- ------------------------------------------------------------------------------------------------
insert into entity (id, kind, name, aliases, identifiers, attributes, created_at, updated_at)
select port.det_uuid('docket:PUC:' || pd.docket_number), 'docket', pd.docket_number || ' — ' || pd.title, '{}',
       jsonb_build_object('puc_docket', pd.docket_number, 'legacy_id', pd.id::text),
       jsonb_strip_nulls(jsonb_build_object(
         'legacy_table', 'puc_docket', 'docket_number', pd.docket_number, 'agency', 'PUC', 'title', pd.title,
         'docket_type', pd.docket_type, 'docket_status', pd.status, 'filed_date', pd.filed_date, 'decision_date', pd.decision_date,
         'utility_type', pd.utility_type, 'summary', pd.summary, 'website_url', pd.source_url,
         'slug', port.slug('puc-' || pd.docket_number))),
       coalesce(pd.created_at, now()), coalesce(pd.updated_at, now())
  from legacy.puc_docket pd
on conflict (id) do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_puc', 'puc_docket:' || pd.id, 'docket_filing', pd.source_url, pd.docket_number || ' — ' || pd.title, pd.filed_date,
       to_jsonb(pd), port.checksum('puc_docket', to_jsonb(pd)), coalesce(pd.created_at, now())
  from legacy.puc_docket pd
on conflict (checksum) do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'hawaii_puc', 'puc_participant:' || pp.id, 'record', pd.source_url,
       coalesce(pe.name, 'Participant') || ' — ' || pp.role || ' — ' || pd.docket_number, pd.filed_date,
       to_jsonb(pp), port.checksum('puc_participant', to_jsonb(pp)), coalesce(pd.created_at, now())
  from legacy.puc_participant pp
  join legacy.puc_docket pd on pd.id = pp.docket_id
  left join entity pe on pe.id = coalesce(pp.person_id, pp.organization_id)
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, match_confidence, attributes)
select 'party_to', coalesce(pp.person_id, pp.organization_id), port.det_uuid('docket:PUC:' || pd.docket_number),
       pe.name, pd.docket_number, pp.role, pd.filed_date, d.id, 'matched', 1.0,
       jsonb_build_object('legacy_id', pp.id::text)
  from legacy.puc_participant pp
  join legacy.puc_docket pd on pd.id = pp.docket_id
  join document d on d.source = 'hawaii_puc' and d.source_record_id = 'puc_participant:' || pp.id
  left join entity pe on pe.id = coalesce(pp.person_id, pp.organization_id)
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 7. Articles → article documents; mentions → mentioned_in (attached to the article document)
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, body_text, checksum, fetched_at)
select coalesce(a.source, 'external'), 'article:' || a.id, 'article', a.url, a.title, a.published_at,
       to_jsonb(a), a.summary, port.checksum('article', to_jsonb(a)), coalesce(a.created_at, now())
  from legacy.article a
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, match_confidence, attributes)
select 'mentioned_in', coalesce(m.person_id, m.organization_id), null, pe.name, a.title, m.mention_type, a.published_at, d.id, 'matched', 1.0,
       jsonb_build_object('mention_type', m.mention_type, 'legacy_id', m.id::text)
  from legacy.article_entity_mention m
  join legacy.article a on a.id = m.article_id
  join document d on d.source = coalesce(a.source, 'external') and d.source_record_id = 'article:' || a.id
  left join entity pe on pe.id = coalesce(m.person_id, m.organization_id)
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 8. Timeline events → event documents + mentioned_in edges (table dropped)
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, body_text, checksum, fetched_at)
select 'legacy_timeline', 'timeline_event:' || t.id, 'event', t.source_url, t.title, t.event_date,
       to_jsonb(t), t.description, port.checksum('timeline_event', to_jsonb(t)), coalesce(t.created_at, now())
  from legacy.timeline_event t
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, match_confidence, attributes)
select 'mentioned_in', coalesce(t.person_id, t.organization_id), null, pe.name, t.title, t.event_type, t.event_date, d.id, 'matched', 1.0,
       jsonb_strip_nulls(jsonb_build_object('event_type', t.event_type, 'source_description', t.source_description, 'legacy_id', t.id::text))
  from legacy.timeline_event t
  join document d on d.source = 'legacy_timeline' and d.source_record_id = 'timeline_event:' || t.id
  left join entity pe on pe.id = coalesce(t.person_id, t.organization_id)
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 9. Legislative testimony → bill entities + testified_on
-- ------------------------------------------------------------------------------------------------
insert into entity (id, kind, name, aliases, identifiers, attributes)
select distinct on (lt.session, upper(replace(lt.bill_number, ' ', '')))
       port.det_uuid('bill:state:' || lt.session || ':' || upper(replace(lt.bill_number, ' ', ''))), 'bill',
       upper(replace(lt.bill_number, ' ', '')) || ' (' || lt.session || ')', '{}',
       jsonb_build_object('capitol_measure', lt.session || ':' || upper(replace(lt.bill_number, ' ', ''))),
       jsonb_build_object('measure_number', upper(replace(lt.bill_number, ' ', '')), 'session', lt.session, 'jurisdiction', 'state',
                          'slug', port.slug(lt.session || '-' || lt.bill_number))
  from legacy.legislative_testimony lt
on conflict (id) do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'capitol_testimony', 'legislative_testimony:' || lt.id, 'testimony', lt.testimony_url,
       coalesce(lt.person_name_raw, lt.org_name_raw, 'Testimony') || ' on ' || lt.bill_number || ' (' || lt.position || ')', lt.hearing_date,
       coalesce(lt.raw_record, to_jsonb(lt)), port.checksum('legislative_testimony', to_jsonb(lt)), coalesce(lt.imported_at, now())
  from legacy.legislative_testimony lt
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, match_confidence, attributes)
select 'testified_on', coalesce(lt.person_id, lt.organization_id),
       port.det_uuid('bill:state:' || lt.session || ':' || upper(replace(lt.bill_number, ' ', ''))),
       coalesce(lt.person_name_raw, lt.org_name_raw), lt.bill_number, lt.position, lt.hearing_date, d.id,
       case when coalesce(lt.person_id, lt.organization_id) is null then 'unmatched'
            when lt.match_status in ('review') then 'review' else 'matched' end,
       lt.match_confidence,
       jsonb_strip_nulls(jsonb_build_object('committee', lt.committee, 'session', lt.session, 'hearing_date', lt.hearing_date,
                                            'testimony_url', lt.testimony_url, 'org_name_raw', lt.org_name_raw, 'legacy_id', lt.id::text))
  from legacy.legislative_testimony lt
  join document d on d.source = 'capitol_testimony' and d.source_record_id = 'legislative_testimony:' || lt.id
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 10. Government contracts → awarded_contract / awarded_grant (agency resolved by exact org name)
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select gc.source, 'government_contract:' || gc.id,
       case when gc.raw_record ->> 'Award Type' ilike '%grant%' or gc.raw_record ->> 'award_type' ilike '%grant%' then 'grant' else 'contract' end,
       null, gc.awarding_agency || ' → ' || coalesce(gc.vendor_name_raw, 'vendor'), gc.award_date,
       coalesce(gc.raw_record, to_jsonb(gc)), port.checksum('government_contract', to_jsonb(gc)), coalesce(gc.imported_at, now())
  from legacy.government_contract gc
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, amount, start_date, document_id, match_status, match_confidence, attributes)
select case when d.doc_type = 'grant' then 'awarded_grant' else 'awarded_contract' end,
       ag.id, gc.vendor_org_id, gc.awarding_agency, gc.vendor_name_raw, gc.source, gc.contract_amount, gc.award_date, d.id,
       case when gc.match_status = 'rejected' then 'unmatched' else port.match_status(ag.id, gc.vendor_org_id) end,
       gc.match_confidence,
       jsonb_strip_nulls(jsonb_build_object('awarding_agency', gc.awarding_agency, 'description', gc.description,
                                            'source_record_id', gc.source_record_id, 'legacy_match_status', gc.match_status, 'legacy_id', gc.id::text))
  from legacy.government_contract gc
  join document d on d.source = gc.source and d.source_record_id = 'government_contract:' || gc.id
  left join lateral (select e.id from entity e where e.kind = 'org' and lower(e.name) = lower(gc.awarding_agency) limit 1) ag on true
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 11. Property → parcel entities + owns
-- ------------------------------------------------------------------------------------------------
insert into entity (id, kind, name, aliases, identifiers, attributes)
select distinct on (po.tmk) port.det_uuid('parcel:' || po.tmk), 'parcel', 'TMK ' || po.tmk, '{}',
       jsonb_build_object('tmk', po.tmk),
       jsonb_strip_nulls(jsonb_build_object('tmk', po.tmk, 'county', po.county, 'address', po.address, 'tax_class', po.tax_class,
                                            'assessed_value', po.assessed_value, 'assessment_year', po.assessment_year, 'slug', port.slug('tmk-' || po.tmk)))
  from legacy.property_ownership po
 order by po.tmk, po.assessment_year desc nulls last
on conflict (id) do nothing;

insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select 'county_property', 'property_ownership:' || po.id, 'property_record', null,
       coalesce(po.owner_name_raw, 'Owner') || ' — TMK ' || po.tmk,
       case when po.assessment_year is not null then make_date(po.assessment_year, 1, 1) end,
       coalesce(po.raw_record, to_jsonb(po)), port.checksum('property_ownership', to_jsonb(po)), coalesce(po.imported_at, now())
  from legacy.property_ownership po
on conflict (checksum) do nothing;

insert into edge (type, from_id, to_id, from_name_raw, to_name_raw, role, start_date, document_id, match_status, match_confidence, attributes)
select 'owns', coalesce(po.owner_person_id, po.owner_org_id), port.det_uuid('parcel:' || po.tmk), po.owner_name_raw, po.tmk, 'fee owner',
       case when po.assessment_year is not null then make_date(po.assessment_year, 1, 1) end, d.id,
       case when po.match_status = 'rejected' then 'unmatched' else port.match_status(coalesce(po.owner_person_id, po.owner_org_id), port.det_uuid('parcel:' || po.tmk)) end,
       po.match_confidence,
       jsonb_strip_nulls(jsonb_build_object('assessed_value', po.assessed_value, 'assessment_year', po.assessment_year, 'tax_class', po.tax_class,
                                            'county', po.county, 'legacy_match_status', po.match_status, 'legacy_id', po.id::text))
  from legacy.property_ownership po
  join document d on d.source = 'county_property' and d.source_record_id = 'property_ownership:' || po.id
on conflict do nothing;

-- ------------------------------------------------------------------------------------------------
-- 12. data_source_record → source_record documents (legacy checksum preserved for importer dedup)
-- ------------------------------------------------------------------------------------------------
insert into document (source, source_record_id, doc_type, url, title, doc_date, raw, checksum, fetched_at)
select dsr.source_name, 'dsr:' || dsr.source_id, 'source_record', null, dsr.source_name || ' ' || dsr.source_id, null,
       dsr.raw_data, dsr.checksum, coalesce(dsr.ingested_at, now())
  from legacy.data_source_record dsr
on conflict (checksum) do nothing;

-- ------------------------------------------------------------------------------------------------
-- 13. user_profile + staff_role → user_account (via migration_user_map: legacy uuid → Neon Auth id)
-- ------------------------------------------------------------------------------------------------
insert into user_account (user_id, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id, trial_ends_at, watch_entity_ids, is_staff, created_at)
select m.neon_user_id,
       case when up.subscription_tier in ('free','individual','professional','institutional') then up.subscription_tier else 'free' end,
       coalesce(up.subscription_status, 'inactive'), up.stripe_customer_id, up.stripe_subscription_id, up.trial_ends_at,
       coalesce(up.alert_person_ids, '{}') || coalesce(up.alert_org_ids, '{}'),
       exists (select 1 from legacy.staff_role s where s.user_id = up.id),
       coalesce(up.created_at, now())
  from legacy.user_profile up
  join migration_user_map m on m.legacy_user_id = up.id
on conflict (user_id) do nothing;

-- ------------------------------------------------------------------------------------------------
-- 14. import_cursor carried over
-- ------------------------------------------------------------------------------------------------
insert into import_cursor (source, cursor_offset, last_run_at, status, metadata)
select source, cursor_offset, last_run_at, status, metadata from legacy.import_cursor
on conflict (source) do nothing;

-- ax_* tables are NOT ported: they are derived and rebuilt by the analytics jobs
-- (POST /api/analytics/admin/rebuild-graph then recompute-scores) after the port.
