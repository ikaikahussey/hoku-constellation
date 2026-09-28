-- Reconciliation of legacy.* vs core tables after scripts/db/port-legacy.sql.
-- Each row: legacy table, legacy rows, resulting documents, edges, entities, sum(amount) legacy vs core,
-- match_status counts, distinct entities referenced (legacy vs core). Consumed by scripts/db/port-legacy.ts.

with
prefix as (
  select * from (values
    ('person',                    null::text, 'entity'),
    ('organization',              null,       'entity'),
    ('relationship',              'relationship:', 'edge'),
    ('contribution',              'contribution:', 'edge'),
    ('lobbyist_registration',     'lobbyist_registration:', 'edge'),
    ('lobbyist_expenditure',      'lobbyist_expenditure:', 'edge'),
    ('org_lobbying_expenditure',  'org_lobbying_expenditure:', 'edge'),
    ('financial_disclosure',      'financial_disclosure:', 'edge'),
    ('puc_docket',                'puc_docket:', 'entity'),
    ('puc_participant',           'puc_participant:', 'edge'),
    ('article',                   'article:', 'document'),
    ('article_entity_mention',    null, 'edge'),
    ('timeline_event',            'timeline_event:', 'edge'),
    ('legislative_testimony',     'legislative_testimony:', 'edge'),
    ('government_contract',       'government_contract:', 'edge'),
    ('property_ownership',        'property_ownership:', 'edge'),
    ('data_source_record',        'dsr:', 'document'),
    ('user_profile',              null, 'user_account'),
    ('import_cursor',             null, 'import_cursor')
  ) as t(legacy_table, doc_prefix, core_target)
),
legacy_counts as (
  select 'person' t, (select count(*) from legacy.person) n, null::numeric s, (select count(*) from legacy.person) ents
  union all select 'organization', (select count(*) from legacy.organization), null, (select count(*) from legacy.organization)
  union all select 'relationship', (select count(*) from legacy.relationship), null,
         (select count(distinct x) from legacy.relationship, lateral unnest(array[source_person_id, source_org_id, target_person_id, target_org_id]) x where x is not null)
  union all select 'contribution', (select count(*) from legacy.contribution), (select sum(amount) from legacy.contribution),
         (select count(distinct x) from legacy.contribution, lateral unnest(array[donor_person_id, donor_org_id, recipient_person_id, recipient_org_id]) x where x is not null)
  union all select 'lobbyist_registration', (select count(*) from legacy.lobbyist_registration), null,
         (select count(distinct x) from legacy.lobbyist_registration, lateral unnest(array[lobbyist_person_id, client_org_id]) x where x is not null)
  union all select 'lobbyist_expenditure', (select count(*) from legacy.lobbyist_expenditure), (select sum(amount) from legacy.lobbyist_expenditure),
         (select count(distinct x) from legacy.lobbyist_expenditure, lateral unnest(array[lobbyist_person_id, client_org_id]) x where x is not null)
  union all select 'org_lobbying_expenditure', (select count(*) from legacy.org_lobbying_expenditure), (select sum(amount) from legacy.org_lobbying_expenditure),
         (select count(distinct org_id) from legacy.org_lobbying_expenditure where org_id is not null)
  union all select 'financial_disclosure', (select count(*) from legacy.financial_disclosure), null,
         (select count(distinct person_id) from legacy.financial_disclosure where person_id is not null)
  union all select 'puc_docket', (select count(*) from legacy.puc_docket), null, (select count(*) from legacy.puc_docket)
  union all select 'puc_participant', (select count(*) from legacy.puc_participant), null,
         (select count(distinct x) from legacy.puc_participant, lateral unnest(array[person_id, organization_id]) x where x is not null)
  union all select 'article', (select count(*) from legacy.article), null, 0
  union all select 'article_entity_mention', (select count(*) from legacy.article_entity_mention), null,
         (select count(distinct x) from legacy.article_entity_mention, lateral unnest(array[person_id, organization_id]) x where x is not null)
  union all select 'timeline_event', (select count(*) from legacy.timeline_event), null,
         (select count(distinct x) from legacy.timeline_event, lateral unnest(array[person_id, organization_id]) x where x is not null)
  union all select 'legislative_testimony', (select count(*) from legacy.legislative_testimony), null,
         (select count(distinct x) from legacy.legislative_testimony, lateral unnest(array[person_id, organization_id]) x where x is not null)
  union all select 'government_contract', (select count(*) from legacy.government_contract), (select sum(contract_amount) from legacy.government_contract),
         (select count(distinct vendor_org_id) from legacy.government_contract where vendor_org_id is not null)
  union all select 'property_ownership', (select count(*) from legacy.property_ownership), null,
         (select count(distinct x) from legacy.property_ownership, lateral unnest(array[owner_person_id, owner_org_id]) x where x is not null)
  union all select 'data_source_record', (select count(*) from legacy.data_source_record), null, 0
  union all select 'user_profile', (select count(*) from legacy.user_profile), null, 0
  union all select 'import_cursor', (select count(*) from legacy.import_cursor), null, 0
),
core_docs as (
  select p.legacy_table, count(d.id) docs
    from prefix p left join document d on p.doc_prefix is not null and d.source_record_id like p.doc_prefix || '%'
   group by p.legacy_table
),
edge_rows as (
  select p.legacy_table, e.*
    from prefix p
    join document d on p.doc_prefix is not null and p.core_target = 'edge' and d.source_record_id like p.doc_prefix || '%'
    join edge e on e.document_id = d.id
),
core_edges as (
  select p.legacy_table,
         (select count(*) from edge_rows er where er.legacy_table = p.legacy_table) edges,
         (select sum(amount) from edge_rows er where er.legacy_table = p.legacy_table) s,
         (select count(*) from edge_rows er where er.legacy_table = p.legacy_table and match_status = 'matched') matched,
         (select count(*) from edge_rows er where er.legacy_table = p.legacy_table and match_status = 'review') review,
         (select count(*) from edge_rows er where er.legacy_table = p.legacy_table and match_status = 'unmatched') unmatched,
         (select count(distinct x) from edge_rows er, lateral unnest(array[er.from_id, er.to_id]) x where er.legacy_table = p.legacy_table and x is not null) ents
    from prefix p
),
core_entities as (
  select 'person' t, count(*) n from entity where kind = 'person' and attributes ->> 'legacy_table' = 'person'
  union all select 'organization', count(*) from entity where kind = 'org' and attributes ->> 'legacy_table' = 'organization'
  union all select 'puc_docket', count(*) from entity where kind = 'docket' and attributes ->> 'legacy_table' = 'puc_docket'
  union all select 'legislative_testimony', count(*) from entity where kind = 'bill'
  union all select 'property_ownership', count(*) from entity where kind = 'parcel'
),
mention_edges as (
  select count(*) edges, count(distinct from_id) ents from edge e join document d on d.id = e.document_id
   where e.type = 'mentioned_in' and d.source_record_id like 'article:%'
)
select p.legacy_table,
       lc.n::bigint as legacy_rows,
       coalesce(cd.docs, 0)::bigint as documents,
       case when p.legacy_table = 'article_entity_mention' then (select edges from mention_edges) else coalesce(ce.edges, 0) end::bigint as edges,
       coalesce(cen.n, 0)::bigint as entities,
       lc.s as legacy_sum,
       ce.s as core_sum,
       coalesce(ce.matched, 0)::bigint as matched,
       coalesce(ce.review, 0)::bigint as review,
       coalesce(ce.unmatched, 0)::bigint as unmatched,
       lc.ents::bigint as legacy_distinct_entities,
       case when p.legacy_table = 'article_entity_mention' then (select ents from mention_edges)
            when p.core_target = 'entity' then coalesce(cen.n, 0) else coalesce(ce.ents, 0) end::bigint as core_distinct_entities,
       case when p.legacy_table = 'user_profile' then (select count(*) from user_account)
            when p.legacy_table = 'import_cursor' then (select count(*) from import_cursor) end::bigint as other_rows
  from prefix p
  join legacy_counts lc on lc.t = p.legacy_table
  left join core_docs cd on cd.legacy_table = p.legacy_table
  left join core_edges ce on ce.legacy_table = p.legacy_table
  left join core_entities cen on cen.t = p.legacy_table
 order by p.legacy_table;
