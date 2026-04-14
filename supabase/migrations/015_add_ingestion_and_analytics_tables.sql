-- Migration: Add data ingestion and analytics tables
-- Purpose: Extends existing Constellation schema with tables for legislative testimony,
--          government contracts, property ownership, per-record provenance tracking,
--          and analytics-derived tables for influence scoring, relationship graphing,
--          alerts, and graph snapshots.
-- Affected tables: organization (altered), plus 8 new tables
-- Special considerations: Does NOT touch existing tables except organization (adding identifier columns).
--                         All new tables follow the match_status/raw_record pattern from contribution.

-- ============================================================
-- 1. ENRICH EXISTING TABLES
-- ============================================================

-- Add structured identifiers to organization for entity resolution.
-- These enable exact-match resolution before falling back to fuzzy name matching.
alter table organization
  add column if not exists ein text,
  add column if not exists dcca_file_number text,
  add column if not exists sec_cik text,
  add column if not exists fec_committee_id text;

create index if not exists org_ein_idx on organization(ein) where ein is not null;
create index if not exists org_dcca_idx on organization(dcca_file_number) where dcca_file_number is not null;
create index if not exists org_sec_cik_idx on organization(sec_cik) where sec_cik is not null;
create index if not exists org_fec_id_idx on organization(fec_committee_id) where fec_committee_id is not null;

-- ============================================================
-- 2. NEW CANONICAL TABLES (ingestion targets)
-- ============================================================

-- Legislative testimony: who testified on which bills, and their position.
-- This is the highest-value data source for mapping lobbying influence.
-- Follows the match_status / raw_record pattern established in contribution.
create table legislative_testimony (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references person(id),
  organization_id uuid references organization(id),
  person_name_raw text,
  org_name_raw text,
  match_confidence real,
  match_status text default 'unmatched',
  bill_number text not null,
  session text not null,
  committee text,
  position text not null check (position in ('support', 'oppose', 'comment')),
  hearing_date date,
  testimony_url text,
  raw_record jsonb,
  imported_at timestamptz default now()
);

create index testimony_person_idx on legislative_testimony(person_id);
create index testimony_org_idx on legislative_testimony(organization_id);
create index testimony_bill_idx on legislative_testimony(bill_number);
create index testimony_session_idx on legislative_testimony(session);
create index testimony_position_idx on legislative_testimony(position);
create index testimony_hearing_date_idx on legislative_testimony(hearing_date);
create index testimony_match_status_idx on legislative_testimony(match_status);

-- Government contracts: federal (USAspending) and state/county procurement awards.
create table government_contract (
  id uuid primary key default gen_random_uuid(),
  vendor_org_id uuid references organization(id),
  vendor_name_raw text,
  match_confidence real,
  match_status text default 'unmatched',
  awarding_agency text not null,
  contract_amount numeric(14,2),
  description text,
  award_date date,
  source text not null,
  source_record_id text,
  raw_record jsonb,
  imported_at timestamptz default now()
);

create index contract_vendor_idx on government_contract(vendor_org_id);
create index contract_agency_idx on government_contract(awarding_agency);
create index contract_amount_idx on government_contract(contract_amount);
create index contract_date_idx on government_contract(award_date);
create index contract_source_idx on government_contract(source);
create index contract_match_status_idx on government_contract(match_status);

-- Property ownership: county real property assessment records.
-- TMK (Tax Map Key) is the canonical property identifier in Hawaiʻi.
create table property_ownership (
  id uuid primary key default gen_random_uuid(),
  owner_person_id uuid references person(id),
  owner_org_id uuid references organization(id),
  owner_name_raw text,
  match_confidence real,
  match_status text default 'unmatched',
  tmk text not null,
  address text,
  county text,
  assessed_value numeric(14,2),
  tax_class text,
  assessment_year integer,
  raw_record jsonb,
  imported_at timestamptz default now()
);

create index property_owner_person_idx on property_ownership(owner_person_id);
create index property_owner_org_idx on property_ownership(owner_org_id);
create index property_tmk_idx on property_ownership(tmk);
create index property_county_idx on property_ownership(county);
create index property_value_idx on property_ownership(assessed_value);
create index property_match_status_idx on property_ownership(match_status);

-- Per-record provenance tracking.
-- Supplements import_cursor (which tracks cursor position per source).
-- This stores every individual raw record for audit and deduplication.
create table data_source_record (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  source_name text not null,
  raw_data jsonb not null,
  checksum text not null,
  ingested_at timestamptz not null default now()
);

create unique index dsr_checksum_idx on data_source_record(checksum);
create index dsr_source_idx on data_source_record(source_id);
create index dsr_ingested_idx on data_source_record(ingested_at);

-- ============================================================
-- 3. ANALYTICS DERIVED TABLES (written by analytics module only)
-- ============================================================

-- Influence scores: one row per scored person.
-- Can be dropped and rebuilt from canonical data at any time.
create table ax_influence_score (
  person_id uuid primary key references person(id),
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
  score_version integer not null default 1
);

create index idx_ax_influence_composite on ax_influence_score(composite_score desc);
create index idx_ax_influence_rank on ax_influence_score(rank asc);

-- Analytically derived relationship edges (co-donor, co-board, co-testimony, etc.).
-- Different from the canonical `relationship` table: these are computed, not observed.
-- Can be dropped and rebuilt from canonical data at any time.
create table ax_relationship_edge (
  id uuid primary key default gen_random_uuid(),
  source_person_id uuid not null references person(id),
  target_person_id uuid not null references person(id),
  relationship_type text not null,
  weight numeric(8,3) not null default 1.0,
  evidence jsonb not null default '[]',
  first_observed date,
  last_observed date,
  constraint no_self_edge check (source_person_id != target_person_id)
);

create index idx_ax_edge_source on ax_relationship_edge(source_person_id);
create index idx_ax_edge_target on ax_relationship_edge(target_person_id);
create index idx_ax_edge_type on ax_relationship_edge(relationship_type);

-- Alerts: newsworthy changes detected by the analytics engine.
create table ax_alert (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null check (severity in ('high', 'medium', 'low')),
  person_id uuid references person(id),
  organization_id uuid references organization(id),
  headline text not null,
  detail jsonb not null default '{}',
  source_records jsonb not null default '[]',
  created_at timestamptz not null default now(),
  acknowledged boolean not null default false
);

create index idx_ax_alert_created on ax_alert(created_at desc);
create index idx_ax_alert_person on ax_alert(person_id);
create index idx_ax_alert_org on ax_alert(organization_id);
create index idx_ax_alert_severity on ax_alert(severity);
create index idx_ax_alert_type on ax_alert(alert_type);

-- Graph snapshots: periodic captures for temporal comparison.
create table ax_graph_snapshot (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  node_count integer not null,
  edge_count integer not null,
  graph_data jsonb not null,
  metrics jsonb not null default '{}'
);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table legislative_testimony enable row level security;
alter table government_contract enable row level security;
alter table property_ownership enable row level security;
alter table data_source_record enable row level security;
alter table ax_influence_score enable row level security;
alter table ax_relationship_edge enable row level security;
alter table ax_alert enable row level security;
alter table ax_graph_snapshot enable row level security;

-- Legislative testimony: subscribers + staff can read
-- (follows the same pattern as contribution in 012_rls_policies.sql)
create policy "Subscribers can read testimony" on legislative_testimony for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Staff can manage testimony" on legislative_testimony for all using (
  auth.uid() in (select user_id from staff_role)
);

-- Government contracts: subscribers + staff
create policy "Subscribers can read contracts" on government_contract for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Staff can manage contracts" on government_contract for all using (
  auth.uid() in (select user_id from staff_role)
);

-- Property ownership: subscribers + staff
create policy "Subscribers can read property" on property_ownership for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Staff can manage property" on property_ownership for all using (
  auth.uid() in (select user_id from staff_role)
);

-- Data source records: staff only
create policy "Staff can read data source records" on data_source_record for select using (
  auth.uid() in (select user_id from staff_role)
);
create policy "Staff can manage data source records" on data_source_record for all using (
  auth.uid() in (select user_id from staff_role)
);

-- Analytics derived tables: subscribers can read, service_role can write
create policy "Subscribers can read scores" on ax_influence_score for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Service role writes scores" on ax_influence_score for all to service_role using (true);

create policy "Subscribers can read edges" on ax_relationship_edge for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Service role writes edges" on ax_relationship_edge for all to service_role using (true);

create policy "Subscribers can read alerts" on ax_alert for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Service role writes alerts" on ax_alert for all to service_role using (true);

create policy "Subscribers can read snapshots" on ax_graph_snapshot for select using (
  auth.uid() in (
    select id from user_profile
    where subscription_tier in ('individual', 'professional', 'institutional')
    and subscription_status in ('active', 'trialing')
  )
  or auth.uid() in (select user_id from staff_role)
);
create policy "Service role writes snapshots" on ax_graph_snapshot for all to service_role using (true);
