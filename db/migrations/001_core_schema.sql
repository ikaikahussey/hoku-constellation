-- HOKU Insider core schema (replaces legacy Supabase migrations 001–015, archived in db/legacy_migrations/).
--
-- Target: Neon Postgres. Applied with psql against DATABASE_URL_UNPOOLED.
-- Idempotent where practical so it can be re-applied on rehearsal branches.
--
-- Roles: Neon Data API provisions `authenticated` and `anonymous`; the owner role runs this file.
-- `auth.user_id()` is provided by Neon when Managed Better Auth / Data API is enabled. A shim is
-- created below only when the function does not already exist (local + PGlite test runs).

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ------------------------------------------------------------------------------------------------
-- Roles used by RLS (no-ops on Neon where they already exist)
-- ------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
end $$;

create schema if not exists auth;
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'user_id'
  ) then
    -- Mirrors Neon's definition: JWT `sub` claim as text.
    create function auth.user_id() returns text
      language sql stable
      as $f$ select nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub' $f$;
  end if;
end $$;

create schema if not exists app;

-- ------------------------------------------------------------------------------------------------
-- Core tables
-- ------------------------------------------------------------------------------------------------
create table if not exists entity (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('person','org','bill','docket','parcel','office')),
  name text not null,
  aliases text[] not null default '{}',
  identifiers jsonb not null default '{}',   -- {"ein","fec_id","dcca","sec_cik","uei","tmk","fcc_frn","olms",...}
  attributes jsonb not null default '{}',    -- kind-specific fields, validated in app (zod)
  merged_into_id uuid references entity(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_record_id text,
  doc_type text not null,
  url text,
  title text,
  doc_date date,
  raw jsonb not null,
  body_text text,
  embedding vector(1024),
  checksum text not null unique,
  fetched_at timestamptz not null default now(),
  unique (source, source_record_id)
);

create table if not exists edge (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  from_id uuid references entity(id),
  to_id uuid references entity(id),
  from_name_raw text,
  to_name_raw text,
  role text,
  amount numeric(14,2),
  start_date date,
  end_date date,
  document_id uuid not null references document(id),
  match_status text not null default 'unmatched' check (match_status in ('matched','review','unmatched')),
  match_confidence real,
  attributes jsonb not null default '{}',
  constraint edge_type_vocabulary check (type in (
    'contributed_to','spent_with','loaned_to',
    'lobbied_for','lobbied_on',
    'employed_by','officer_of','director_of','member_of',
    'appointed_to','confirmed_by',
    'sponsored','voted_on','testified_on',
    'awarded_contract','awarded_grant',
    'owns','leases','party_to',
    'disclosed_interest','licensed_by','sanctioned_by',
    'mentioned_in'
  ))
);

create table if not exists summary (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entity(id),
  edge_id uuid references edge(id),
  document_id uuid references document(id),
  body text not null,
  cites uuid[] not null default '{}',
  author text not null,                      -- 'staff:<user_id>' | 'model:<name>'
  status text not null default 'draft' check (status in ('draft','published')),
  tier text not null default 'paid' check (tier in ('free','paid')),
  embedding vector(1024),
  created_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, edge_id, document_id) = 1)
);

-- Neon Auth users live in neon_auth."user" (id text). The FK is added conditionally below so this
-- file also applies on branches/test databases where Neon Auth has not been provisioned.
create table if not exists user_account (
  user_id text primary key,                  -- Neon Auth user id
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free','individual','professional','institutional')),
  subscription_status text not null default 'inactive',  -- carried from legacy gating: active|trialing gate paid content
  stripe_customer_id text unique,
  stripe_subscription_id text,
  trial_ends_at timestamptz,
  watch_entity_ids uuid[] not null default '{}',
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'neon_auth' and table_name = 'user')
     and not exists (select 1 from pg_constraint where conname = 'user_account_user_id_fkey') then
    execute 'alter table user_account add constraint user_account_user_id_fkey
             foreign key (user_id) references neon_auth."user"(id) on delete cascade';
  end if;
end $$;

-- ------------------------------------------------------------------------------------------------
-- Operational tables
-- ------------------------------------------------------------------------------------------------
create table if not exists import_cursor (
  source text primary key,
  cursor_offset integer default 0,
  last_run_at timestamptz,
  status text default 'idle',
  metadata jsonb default '{}'
);

-- Legacy → Neon Auth user id map; dropped 30 days after cutover (see docs/NEON_CUTOVER.md).
create table if not exists migration_user_map (
  legacy_user_id uuid primary key,
  neon_user_id text not null,
  email text not null,
  migrated_at timestamptz not null default now()
);

-- Analytics-derived tables. Writable only by the owner/service role; disposable.
create table if not exists ax_influence_score (
  entity_id uuid primary key references entity(id) on delete cascade,
  composite_score numeric(5,1) not null default 0 check (composite_score between 0 and 100),
  political_money_score numeric(5,1) not null default 0,
  institutional_position_score numeric(5,1) not null default 0,
  lobbying_score numeric(5,1) not null default 0,
  economic_footprint_score numeric(5,1) not null default 0,
  network_centrality_score numeric(5,1) not null default 0,
  public_visibility_score numeric(5,1) not null default 0,
  rank integer,
  percentile numeric(5,2),
  computed_at timestamptz not null default now(),
  score_version integer not null default 2
);

create table if not exists ax_relationship_edge (
  id uuid primary key default gen_random_uuid(),
  source_entity_id uuid not null references entity(id) on delete cascade,
  target_entity_id uuid not null references entity(id) on delete cascade,
  relationship_type text not null,
  weight numeric(8,3) not null default 1.0,
  evidence jsonb not null default '[]',
  first_observed date,
  last_observed date,
  constraint no_self_edge check (source_entity_id <> target_entity_id)
);

create table if not exists ax_alert (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null check (severity in ('high','medium','low')),
  entity_id uuid references entity(id) on delete cascade,
  headline text not null,
  detail jsonb not null default '{}',
  source_records jsonb not null default '[]',
  created_at timestamptz not null default now(),
  acknowledged boolean not null default false
);

create table if not exists ax_graph_snapshot (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  node_count integer not null,
  edge_count integer not null,
  graph_data jsonb not null,
  metrics jsonb not null default '{}'
);

-- ------------------------------------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------------------------------------
create index if not exists edge_type_to_idx on edge(type, to_id);
create index if not exists edge_type_from_idx on edge(type, from_id);
create index if not exists edge_document_idx on edge(document_id);
create index if not exists edge_start_date_idx on edge(start_date);
create index if not exists edge_amount_idx on edge(amount) where amount is not null;
create index if not exists edge_needs_review_idx on edge(match_status) where match_status <> 'matched';
-- Ingestion idempotency: one edge per (document, type, raw names, role).
create unique index if not exists edge_dedup_idx
  on edge(document_id, type, coalesce(from_name_raw, ''), coalesce(to_name_raw, ''), coalesce(role, ''));

create index if not exists entity_identifiers_gin on entity using gin (identifiers);
create index if not exists entity_aliases_gin on entity using gin (aliases);
create index if not exists entity_name_trgm on entity using gin (name gin_trgm_ops);
create index if not exists entity_kind_idx on entity(kind);
create index if not exists entity_merged_idx on entity(merged_into_id) where merged_into_id is not null;
create unique index if not exists entity_kind_slug_idx on entity(kind, (attributes->>'slug')) where attributes ? 'slug';

create index if not exists document_source_date_idx on document(source, doc_date);
create index if not exists document_doc_type_idx on document(doc_type);
create index if not exists document_embedding_hnsw on document using hnsw (embedding vector_cosine_ops);
create index if not exists summary_embedding_hnsw on summary using hnsw (embedding vector_cosine_ops);
create index if not exists summary_entity_idx on summary(entity_id);

create index if not exists ax_influence_composite_idx on ax_influence_score(composite_score desc);
create index if not exists ax_influence_rank_idx on ax_influence_score(rank asc);
create index if not exists ax_edge_source_idx on ax_relationship_edge(source_entity_id);
create index if not exists ax_edge_target_idx on ax_relationship_edge(target_entity_id);
create index if not exists ax_alert_created_idx on ax_alert(created_at desc);
create index if not exists ax_alert_entity_idx on ax_alert(entity_id);

-- ------------------------------------------------------------------------------------------------
-- Gating helpers (mirrored in lib/db/gating.ts)
-- ------------------------------------------------------------------------------------------------
create or replace function app.is_staff() returns boolean
  language sql stable security definer set search_path = public
  as $$ select coalesce((select is_staff from user_account where user_id = auth.user_id()), false) $$;

create or replace function app.is_paid() returns boolean
  language sql stable security definer set search_path = public
  as $$
    select coalesce((
      select subscription_tier in ('individual','professional','institutional')
         and subscription_status in ('active','trialing')
      from user_account where user_id = auth.user_id()), false)
  $$;

-- Document types that were subscriber-only in the legacy schema (contribution, lobbying, ethics,
-- testimony, contracts, property, data_source_record). Everything else is public.
create or replace function app.paid_doc_types() returns text[]
  language sql immutable
  as $$ select array['contribution','expenditure','loan','lobbyist_registration','lobbyist_expenditure',
                     'financial_disclosure','gift_disclosure','testimony','contract','grant','property_record',
                     'source_record','exclusion','debarment'] $$;

create or replace function app.paid_edge_types() returns text[]
  language sql immutable
  as $$ select array['contributed_to','spent_with','loaned_to','lobbied_for','lobbied_on',
                     'disclosed_interest','testified_on','awarded_contract','awarded_grant','owns','leases'] $$;

create or replace function app.can_read_doc_type(t text) returns boolean
  language sql stable
  as $$ select not (t = any(app.paid_doc_types())) or app.is_paid() or app.is_staff() $$;

create or replace function app.can_read_edge_type(t text) returns boolean
  language sql stable
  as $$ select not (t = any(app.paid_edge_types())) or app.is_paid() or app.is_staff() $$;

-- ------------------------------------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------------------------------------
alter table entity enable row level security;
alter table document enable row level security;
alter table edge enable row level security;
alter table summary enable row level security;
alter table user_account enable row level security;
alter table import_cursor enable row level security;
alter table migration_user_map enable row level security;
alter table ax_influence_score enable row level security;
alter table ax_relationship_edge enable row level security;
alter table ax_alert enable row level security;
alter table ax_graph_snapshot enable row level security;

-- entity: legacy person/organization were readable by anyone.
drop policy if exists entity_read on entity;
create policy entity_read on entity for select to authenticated, anonymous using (true);

-- document / edge: gated by type per legacy subscriber rules.
drop policy if exists document_read on document;
create policy document_read on document for select to authenticated, anonymous
  using (app.can_read_doc_type(doc_type));

drop policy if exists edge_read on edge;
create policy edge_read on edge for select to authenticated, anonymous
  using (app.can_read_edge_type(type));

-- summary: published free → everyone; published paid → paid; drafts → staff.
drop policy if exists summary_read_free on summary;
create policy summary_read_free on summary for select to authenticated, anonymous
  using (status = 'published' and tier = 'free');
drop policy if exists summary_read_paid on summary;
create policy summary_read_paid on summary for select to authenticated
  using (status = 'published' and tier = 'paid' and app.is_paid());
drop policy if exists summary_read_staff on summary;
create policy summary_read_staff on summary for select to authenticated using (app.is_staff());

-- user_account: owner-only; staff read all; owner may update own watch list.
drop policy if exists user_account_read_own on user_account;
create policy user_account_read_own on user_account for select to authenticated
  using (user_id = auth.user_id() or app.is_staff());
drop policy if exists user_account_update_own on user_account;
create policy user_account_update_own on user_account for update to authenticated
  using (user_id = auth.user_id()) with check (user_id = auth.user_id());

-- ax_* : subscribers + staff read; no user writes (write policies intentionally absent).
drop policy if exists ax_influence_read on ax_influence_score;
create policy ax_influence_read on ax_influence_score for select to authenticated using (app.is_paid() or app.is_staff());
drop policy if exists ax_edge_read on ax_relationship_edge;
create policy ax_edge_read on ax_relationship_edge for select to authenticated using (app.is_paid() or app.is_staff());
drop policy if exists ax_alert_read on ax_alert;
create policy ax_alert_read on ax_alert for select to authenticated using (app.is_paid() or app.is_staff());
drop policy if exists ax_snapshot_read on ax_graph_snapshot;
create policy ax_snapshot_read on ax_graph_snapshot for select to authenticated using (app.is_paid() or app.is_staff());

-- import_cursor / migration_user_map: staff read only.
drop policy if exists import_cursor_read on import_cursor;
create policy import_cursor_read on import_cursor for select to authenticated using (app.is_staff());

-- ------------------------------------------------------------------------------------------------
-- Grants. Users never receive INSERT/DELETE on canonical or ax_* tables; writes are owner-only.
-- ------------------------------------------------------------------------------------------------
grant usage on schema public, app to authenticated, anonymous;
grant execute on all functions in schema app to authenticated, anonymous;
grant select on entity, document, edge, summary to authenticated, anonymous;
grant select on user_account, import_cursor, ax_influence_score, ax_relationship_edge, ax_alert, ax_graph_snapshot to authenticated;
grant update (watch_entity_ids) on user_account to authenticated;
revoke all on migration_user_map from authenticated, anonymous;

-- updated_at maintenance
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists entity_touch on entity;
create trigger entity_touch before update on entity for each row execute function app.touch_updated_at();
