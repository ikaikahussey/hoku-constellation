-- HOKU Insider Part E — team workspace schema (`app`).
--
-- The core graph stays at five tables (entity, document, edge, summary, user_account). Everything a
-- subscriber team creates — clients, watchlists, alert rules, notes, reports — lives in the `app`
-- schema. RLS on every table: team members see only their own team's rows; staff read everything.
-- Writes that change billing state (plan, seats, Stripe ids) or deliver alerts are service-role only.
--
-- Entitlements come from team membership through app.entitlements(user_id). app.is_paid() and the
-- content gates in 001 are redefined on top of it at the end of this file.
--
-- Idempotent: safe to re-apply.

create schema if not exists app;

-- ------------------------------------------------------------------------------------------------
-- Core additions needed for freshness and alert watermarks (columns only; no new core tables)
-- ------------------------------------------------------------------------------------------------
alter table document add column if not exists source_posted_at timestamptz;
alter table edge add column if not exists created_at timestamptz not null default now();
create index if not exists document_fetched_at_idx on document(fetched_at);
create index if not exists edge_created_at_idx on edge(created_at);
create index if not exists document_body_fts_idx on document using gin (to_tsvector('english', coalesce(body_text, '')));

-- ------------------------------------------------------------------------------------------------
-- Teams
-- ------------------------------------------------------------------------------------------------
create table if not exists app.team (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free' check (plan in ('free','reader','pro','organization')),
  subscription_status text not null default 'inactive',
  billing_interval text check (billing_interval in ('month','year')),
  collection_method text not null default 'charge_automatically' check (collection_method in ('charge_automatically','send_invoice')),
  po_number text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  seat_count integer not null default 1 check (seat_count >= 1),
  logo_key text,
  letterhead_key text,
  sender_name text,
  slack_webhook_enc text,                    -- AES-256-GCM ciphertext (lib/crypto.ts); never plaintext
  is_personal boolean not null default false,
  is_design_partner boolean not null default false,
  coupon_code text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.team_member (
  team_id uuid not null references app.team(id) on delete cascade,
  user_id text not null,
  role text not null default 'member' check (role in ('owner','admin','member')),
  email text,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  removed_at timestamptz,
  primary key (team_id, user_id)
);
create index if not exists team_member_user_idx on app.team_member(user_id);
create unique index if not exists team_one_owner_idx on app.team_member(team_id) where role = 'owner' and removed_at is null;

create table if not exists app.invitation (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token_hash text not null unique,
  invited_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by text,
  revoked_at timestamptz
);
create index if not exists invitation_team_idx on app.invitation(team_id);

-- ------------------------------------------------------------------------------------------------
-- Clients, watchlists, alert rules
-- ------------------------------------------------------------------------------------------------
create table if not exists app.client (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  name text not null,
  entity_id uuid references entity(id),
  report_recipients text[] not null default '{}',
  report_cadence text not null default 'weekly' check (report_cadence in ('weekly','none')),
  auto_draft boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists client_team_idx on app.client(team_id);

create table if not exists app.watchlist (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  client_id uuid references app.client(id) on delete set null,
  name text not null,
  is_default boolean not null default false,
  owner_user_id text,
  created_at timestamptz not null default now()
);
create index if not exists watchlist_team_idx on app.watchlist(team_id);
create unique index if not exists watchlist_default_idx on app.watchlist(team_id, owner_user_id) where is_default;

create table if not exists app.watchlist_item (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references app.watchlist(id) on delete cascade,
  entity_id uuid references entity(id),
  keyword text,
  committee_entity_id uuid references entity(id),
  source_key text,
  position text check (position in ('support','oppose','monitor')),
  priority smallint check (priority between 1 and 3),
  created_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, keyword, committee_entity_id, source_key) = 1)
);
create index if not exists watchlist_item_list_idx on app.watchlist_item(watchlist_id);
create index if not exists watchlist_item_entity_idx on app.watchlist_item(entity_id) where entity_id is not null;
create index if not exists watchlist_item_committee_idx on app.watchlist_item(committee_entity_id) where committee_entity_id is not null;
create unique index if not exists watchlist_item_unique_idx on app.watchlist_item(
  watchlist_id, coalesce(entity_id::text, ''), coalesce(lower(keyword), ''), coalesce(committee_entity_id::text, ''), coalesce(source_key, ''));

create table if not exists app.alert_rule (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references app.watchlist(id) on delete cascade,
  user_id text,                               -- recipient; null = team channel (Slack)
  event_types text[] not null default '{}',   -- empty = every event type
  channel text not null check (channel in ('email','slack','digest_daily','digest_weekly','sms')),
  quiet_start time,                           -- Pacific/Honolulu local time
  quiet_end time,
  muted_until timestamptz,
  unsubscribed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists alert_rule_watchlist_idx on app.alert_rule(watchlist_id);

-- ------------------------------------------------------------------------------------------------
-- Alert events and deliveries (replace ax_alert once parity is shown; see docs/OPERATIONS.md)
-- ------------------------------------------------------------------------------------------------
create table if not exists app.alert_event (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  watchlist_id uuid references app.watchlist(id) on delete set null,
  rule_ids uuid[] not null default '{}',
  event_type text not null,
  dedup_key text not null,
  document_id uuid references document(id),
  edge_id uuid references edge(id),
  entity_id uuid references entity(id),
  headline text not null,
  detail jsonb not null default '{}',
  detected_at timestamptz not null default now(),
  source_posted_at timestamptz,
  fetched_at timestamptz,
  unique (team_id, dedup_key)
);
create index if not exists alert_event_team_idx on app.alert_event(team_id, detected_at desc);
create index if not exists alert_event_entity_idx on app.alert_event(entity_id, detected_at desc);

create table if not exists app.alert_delivery (
  id uuid primary key default gen_random_uuid(),
  alert_event_id uuid not null references app.alert_event(id) on delete cascade,
  team_id uuid not null references app.team(id) on delete cascade,
  rule_id uuid references app.alert_rule(id) on delete set null,
  user_id text,
  channel text not null check (channel in ('email','slack','digest_daily','digest_weekly','sms')),
  dedup_key text not null,
  status text not null default 'pending' check (status in ('pending','deferred','sent','failed','collapsed','digested','skipped')),
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  error text,
  collapsed_into uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz
);
-- One alert per event per user, however many rules match; one per event per team Slack channel.
create unique index if not exists alert_delivery_user_dedup_idx on app.alert_delivery(user_id, dedup_key) where user_id is not null;
create unique index if not exists alert_delivery_team_dedup_idx on app.alert_delivery(team_id, dedup_key, channel) where user_id is null;
create index if not exists alert_delivery_pending_idx on app.alert_delivery(status, scheduled_for) where status in ('pending','deferred');

create table if not exists app.matcher_state (
  key text primary key,
  watermark timestamptz not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------------------------
-- Notes, reports, briefings, corrections
-- ------------------------------------------------------------------------------------------------
create table if not exists app.note (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  author_user_id text not null,              -- kept after the author leaves the team
  entity_id uuid references entity(id),
  document_id uuid references document(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(entity_id, document_id) = 1)
);
create index if not exists note_team_idx on app.note(team_id);

create table if not exists app.report (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references app.team(id) on delete cascade,
  client_id uuid not null references app.client(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','approved','sent')),
  content jsonb not null default '{}',
  cited_document_ids uuid[] not null default '{}',
  narrative_source text not null default 'facts_only' check (narrative_source in ('model','facts_only','edited')),
  pdf_key text,
  docx_key text,
  recipients text[] not null default '{}',
  created_by text,
  approved_by text,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists report_team_idx on app.report(team_id, created_at desc);

create table if not exists app.briefing (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entity(id) on delete cascade,
  kind text not null default 'bill' check (kind in ('bill','person','org')),
  generated_at timestamptz not null default now(),
  content jsonb not null,
  cites uuid[] not null default '{}',
  stale boolean not null default false,
  unique (entity_id, kind)
);

create table if not exists app.correction (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  team_id uuid references app.team(id) on delete set null,
  reporter_email text,
  entity_id uuid references entity(id),
  edge_id uuid references edge(id),
  document_id uuid references document(id),
  page_url text,
  description text not null check (length(description) between 5 and 5000),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','rejected')),
  resolution text,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now()
);
create index if not exists correction_status_idx on app.correction(status, created_at);

-- Stored reports/briefings (PDF, DOCX) and team logos. Small binaries live in Postgres so no extra
-- storage account is needed; keys are referenced from report.pdf_key / team.logo_key.
create table if not exists app.stored_file (
  key text primary key,
  team_id uuid references app.team(id) on delete cascade,
  content_type text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

-- Per-user settings: ICS feed secret (hash only), onboarding dismissal.
create table if not exists app.user_pref (
  user_id text primary key,
  ics_token_hash text unique,
  ics_rotated_at timestamptz,
  onboarding_dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

-- Q&A log for rate limits and usage (never the question text).
create table if not exists app.ask_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  team_id uuid references app.team(id) on delete set null,
  question_length integer not null,
  result_count integer not null,
  created_at timestamptz not null default now()
);
create index if not exists ask_log_user_idx on app.ask_log(user_id, created_at desc);

-- Usage events for the design-partner dashboard (login, briefing_view, report_generated, …).
create table if not exists app.usage_event (
  id bigint generated always as identity primary key,
  team_id uuid references app.team(id) on delete cascade,
  user_id text,
  kind text not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists usage_event_team_idx on app.usage_event(team_id, created_at desc);

-- ------------------------------------------------------------------------------------------------
-- Entitlements
-- ------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app' and t.typname = 'entitlement') then
    create type app.entitlement as (
      tier text,
      is_staff boolean,
      paid_content boolean,
      alerts boolean,
      max_watch_items integer,       -- null = unlimited
      reports boolean,
      briefings boolean,
      dossiers boolean,
      qa boolean,
      qa_daily_limit integer,        -- per seat per day; 0 = none
      exports boolean,
      api boolean,
      custom_letterhead boolean,
      invoice_billing boolean,
      priority_support boolean
    );
  end if;
end $$;

create or replace function app.tier_rank(t text) returns integer
  language sql immutable
  as $$ select case t when 'organization' then 3 when 'pro' then 2 when 'reader' then 1 else 0 end $$;

-- Feature flags per tier (mirrored in lib/entitlements.ts).
create or replace function app.plan_features(t text) returns app.entitlement
  language sql immutable
  as $$
    select case coalesce(t, 'free')
      when 'organization' then row('organization', false, true, true, null, true, true, true, true, 300, true, true, true, true, true)::app.entitlement
      when 'pro'          then row('pro',          false, true, true, null, true, true, true, true, 100, true, false, false, false, false)::app.entitlement
      when 'reader'       then row('reader',       false, true, true, 10,   false, false, false, false, 0, false, false, false, false, false)::app.entitlement
      else                     row('free',         false, false, false, 10, false, false, false, false, 0, false, false, false, false, false)::app.entitlement
    end
  $$;

-- A team's effective tier: its plan while the subscription is active/trialing (design partners always).
create or replace function app.team_tier(tid uuid) returns text
  language sql stable security definer set search_path = app, public
  as $$
    select coalesce((
      select case when t.subscription_status in ('active','trialing') or t.is_design_partner then t.plan else 'free' end
      from app.team t where t.id = tid), 'free')
  $$;

create or replace function app.team_features(tid uuid) returns app.entitlement
  language sql stable security definer set search_path = app, public
  as $$ select app.plan_features(app.team_tier(tid)) $$;

-- Legacy individual subscriptions (user_account.subscription_tier) map onto the new tiers until they
-- are moved to teams: individual → reader, professional → pro (+ API, as before), institutional → organization.
create or replace function app.legacy_tier(uid text) returns text
  language sql stable security definer set search_path = app, public
  as $$
    select coalesce((
      select case when subscription_status in ('active','trialing') then
        case subscription_tier when 'individual' then 'reader' when 'professional' then 'pro' when 'institutional' then 'organization' else 'free' end
        else 'free' end
      from user_account where user_id = uid), 'free')
  $$;

create or replace function app.entitlements(uid text) returns app.entitlement
  language plpgsql stable security definer set search_path = app, public
  as $$
  declare
    best text := 'free';
    t text;
    staff boolean := false;
    legacy_api boolean := false;
    e app.entitlement;
  begin
    -- Callers may only inspect their own entitlements unless they are staff or the service role.
    if auth.user_id() is not null and uid is distinct from auth.user_id() and not app.is_staff() then
      raise exception 'entitlements: permission denied' using errcode = '42501';
    end if;
    if uid is null then return app.plan_features('free'); end if;
    for t in select app.team_tier(m.team_id) from app.team_member m
              where m.user_id = uid and m.joined_at is not null and m.removed_at is null loop
      if app.tier_rank(t) > app.tier_rank(best) then best := t; end if;
    end loop;
    t := app.legacy_tier(uid);
    if app.tier_rank(t) > app.tier_rank(best) then best := t; end if;
    select coalesce(u.is_staff, false),
           coalesce(u.subscription_tier in ('professional','institutional') and u.subscription_status in ('active','trialing'), false)
      into staff, legacy_api from user_account u where u.user_id = uid;
    e := app.plan_features(best);
    if legacy_api then e.api := true; end if;
    if coalesce(staff, false) then
      e := app.plan_features('organization');
      e.tier := best;
      e.is_staff := true;
    end if;
    return e;
  end $$;

create or replace function app.my_entitlements() returns app.entitlement
  language sql stable security definer set search_path = app, public
  as $$ select app.entitlements(auth.user_id()) $$;

-- Content gates from 001, now driven by entitlements.
create or replace function app.is_paid() returns boolean
  language sql stable security definer set search_path = app, public
  as $$ select coalesce((app.entitlements(auth.user_id())).paid_content, false) $$;

-- ------------------------------------------------------------------------------------------------
-- Membership helpers (security definer so policies on team_member do not recurse)
-- ------------------------------------------------------------------------------------------------
create or replace function app.is_team_member(tid uuid) returns boolean
  language sql stable security definer set search_path = app, public
  as $$ select exists (select 1 from app.team_member m where m.team_id = tid and m.user_id = auth.user_id()
                         and m.joined_at is not null and m.removed_at is null) $$;

create or replace function app.team_role(tid uuid) returns text
  language sql stable security definer set search_path = app, public
  as $$ select m.role from app.team_member m where m.team_id = tid and m.user_id = auth.user_id()
          and m.joined_at is not null and m.removed_at is null $$;

create or replace function app.is_team_admin(tid uuid) returns boolean
  language sql stable security definer set search_path = app, public
  as $$ select coalesce(app.team_role(tid) in ('owner','admin'), false) $$;

create or replace function app.watchlist_team(wid uuid) returns uuid
  language sql stable security definer set search_path = app, public
  as $$ select team_id from app.watchlist where id = wid $$;

-- Watch-item limits by tier, enforced for every writer (users and the service role).
-- The one-time watch_entity_ids migration below sets app.bypass_watch_limit to carry old lists over intact.
create or replace function app.enforce_watch_limit() returns trigger
  language plpgsql security definer set search_path = app, public
  as $$
  declare
    tid uuid := app.watchlist_team(new.watchlist_id);
    lim integer := (app.team_features(tid)).max_watch_items;
    n integer;
  begin
    if coalesce(current_setting('app.bypass_watch_limit', true), '') = 'on' or lim is null then return new; end if;
    select count(*) into n from app.watchlist_item i join app.watchlist w on w.id = i.watchlist_id where w.team_id = tid;
    if n >= lim then
      raise exception 'watch item limit reached (% on the % plan)', lim, app.team_tier(tid) using errcode = 'P0001';
    end if;
    return new;
  end $$;
drop trigger if exists watchlist_item_limit on app.watchlist_item;
create trigger watchlist_item_limit before insert on app.watchlist_item for each row execute function app.enforce_watch_limit();

drop trigger if exists team_touch on app.team;
create trigger team_touch before update on app.team for each row execute function app.touch_updated_at();
drop trigger if exists report_touch on app.report;
create trigger report_touch before update on app.report for each row execute function app.touch_updated_at();
drop trigger if exists note_touch on app.note;
create trigger note_touch before update on app.note for each row execute function app.touch_updated_at();

-- Reports move draft → approved → sent. Users may only draft and approve; "sent" is set by the
-- service role after an approved report is delivered. An approved report cannot go back to draft
-- without clearing its approval, and a sent report is immutable.
create or replace function app.guard_report_status() returns trigger
  language plpgsql
  as $$
  begin
    if tg_op = 'UPDATE' and old.status = 'sent' then
      raise exception 'report already sent' using errcode = 'P0001';
    end if;
    if new.status = 'sent' and (tg_op = 'INSERT' or old.status <> 'approved') then
      raise exception 'report must be approved before it is sent' using errcode = 'P0001';
    end if;
    if new.status = 'approved' and (new.approved_by is null or new.approved_at is null) then
      raise exception 'approval requires approved_by and approved_at' using errcode = 'P0001';
    end if;
    if new.status = 'draft' then new.approved_by := null; new.approved_at := null; end if;
    return new;
  end $$;
drop trigger if exists report_status_guard on app.report;
create trigger report_status_guard before insert or update on app.report for each row execute function app.guard_report_status();

-- ------------------------------------------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------------------------------------------
alter table app.team enable row level security;
alter table app.team_member enable row level security;
alter table app.invitation enable row level security;
alter table app.client enable row level security;
alter table app.watchlist enable row level security;
alter table app.watchlist_item enable row level security;
alter table app.alert_rule enable row level security;
alter table app.alert_event enable row level security;
alter table app.alert_delivery enable row level security;
alter table app.matcher_state enable row level security;
alter table app.note enable row level security;
alter table app.report enable row level security;
alter table app.briefing enable row level security;
alter table app.correction enable row level security;
alter table app.stored_file enable row level security;
alter table app.user_pref enable row level security;
alter table app.ask_log enable row level security;
alter table app.usage_event enable row level security;

-- team
drop policy if exists team_read on app.team;
create policy team_read on app.team for select to authenticated using (app.is_team_member(id) or app.is_staff());
drop policy if exists team_update on app.team;
create policy team_update on app.team for update to authenticated using (app.is_team_admin(id)) with check (app.is_team_admin(id));

-- team_member / invitation: visible within the team; changed only by the server (role checks in lib/teams.ts)
drop policy if exists team_member_read on app.team_member;
create policy team_member_read on app.team_member for select to authenticated using (app.is_team_member(team_id) or app.is_staff());
drop policy if exists invitation_read on app.invitation;
create policy invitation_read on app.invitation for select to authenticated using (app.is_team_admin(team_id) or app.is_staff());

-- client and report: team members on a plan with reports
drop policy if exists client_read on app.client;
create policy client_read on app.client for select to authenticated
  using ((app.is_team_member(team_id) and (app.team_features(team_id)).reports) or app.is_staff());
drop policy if exists client_write on app.client;
create policy client_write on app.client for all to authenticated
  using (app.is_team_member(team_id) and (app.team_features(team_id)).reports)
  with check (app.is_team_member(team_id) and (app.team_features(team_id)).reports);

drop policy if exists report_read on app.report;
create policy report_read on app.report for select to authenticated
  using ((app.is_team_member(team_id) and (app.team_features(team_id)).reports) or app.is_staff());
drop policy if exists report_insert on app.report;
create policy report_insert on app.report for insert to authenticated
  with check (app.is_team_member(team_id) and (app.team_features(team_id)).reports and status = 'draft');
drop policy if exists report_update on app.report;
create policy report_update on app.report for update to authenticated
  using (app.is_team_member(team_id) and (app.team_features(team_id)).reports)
  with check (app.is_team_member(team_id) and (app.team_features(team_id)).reports and status in ('draft','approved')
              and (approved_by is null or approved_by = auth.user_id()));
drop policy if exists report_delete on app.report;
create policy report_delete on app.report for delete to authenticated
  using (app.is_team_member(team_id) and status = 'draft');

-- watchlists, items, rules: every team member (limits enforced by trigger; alerts need the feature)
drop policy if exists watchlist_rw on app.watchlist;
create policy watchlist_rw on app.watchlist for all to authenticated
  using (app.is_team_member(team_id)) with check (app.is_team_member(team_id));
drop policy if exists watchlist_staff_read on app.watchlist;
create policy watchlist_staff_read on app.watchlist for select to authenticated using (app.is_staff());

drop policy if exists watchlist_item_rw on app.watchlist_item;
create policy watchlist_item_rw on app.watchlist_item for all to authenticated
  using (app.is_team_member(app.watchlist_team(watchlist_id))) with check (app.is_team_member(app.watchlist_team(watchlist_id)));
drop policy if exists watchlist_item_staff_read on app.watchlist_item;
create policy watchlist_item_staff_read on app.watchlist_item for select to authenticated using (app.is_staff());

drop policy if exists alert_rule_read on app.alert_rule;
create policy alert_rule_read on app.alert_rule for select to authenticated
  using (app.is_team_member(app.watchlist_team(watchlist_id)) or app.is_staff());
drop policy if exists alert_rule_write on app.alert_rule;
create policy alert_rule_write on app.alert_rule for all to authenticated
  using (app.is_team_member(app.watchlist_team(watchlist_id)))
  with check (app.is_team_member(app.watchlist_team(watchlist_id)) and (app.team_features(app.watchlist_team(watchlist_id))).alerts
              and (user_id is null or user_id = auth.user_id()) and channel <> 'sms');

-- alert events / deliveries: team-visible, service-written. A member marks their own delivery opened.
drop policy if exists alert_event_read on app.alert_event;
create policy alert_event_read on app.alert_event for select to authenticated using (app.is_team_member(team_id) or app.is_staff());
drop policy if exists alert_delivery_read on app.alert_delivery;
create policy alert_delivery_read on app.alert_delivery for select to authenticated using (app.is_team_member(team_id) or app.is_staff());

-- notes: team-private
drop policy if exists note_rw on app.note;
create policy note_rw on app.note for all to authenticated
  using (app.is_team_member(team_id)) with check (app.is_team_member(team_id) and author_user_id = auth.user_id());
drop policy if exists note_staff_read on app.note;
create policy note_staff_read on app.note for select to authenticated using (app.is_staff());

-- briefings: a shared cache readable by any user whose plan includes briefings; written by the service role.
drop policy if exists briefing_read on app.briefing;
create policy briefing_read on app.briefing for select to authenticated using ((app.my_entitlements()).briefings);

-- corrections: anyone signed in may file; reporters see their own; staff see and resolve all.
drop policy if exists correction_insert on app.correction;
create policy correction_insert on app.correction for insert to authenticated
  with check (user_id = auth.user_id() and status = 'open' and (team_id is null or app.is_team_member(team_id)));
drop policy if exists correction_read on app.correction;
create policy correction_read on app.correction for select to authenticated using (user_id = auth.user_id() or app.is_staff());
drop policy if exists correction_staff_update on app.correction;
create policy correction_staff_update on app.correction for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- stored files: team-private
drop policy if exists stored_file_read on app.stored_file;
create policy stored_file_read on app.stored_file for select to authenticated using (app.is_team_member(team_id) or app.is_staff());

-- per-user rows
drop policy if exists user_pref_own on app.user_pref;
create policy user_pref_own on app.user_pref for select to authenticated using (user_id = auth.user_id());
drop policy if exists ask_log_read on app.ask_log;
create policy ask_log_read on app.ask_log for select to authenticated using (user_id = auth.user_id() or app.is_staff());
drop policy if exists usage_event_read on app.usage_event;
create policy usage_event_read on app.usage_event for select to authenticated using (app.is_staff());

-- matcher_state: no user policies (service role only).

-- ------------------------------------------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------------------------------------------
grant usage on schema app to authenticated, anonymous;
grant select on app.team, app.team_member, app.invitation, app.client, app.watchlist, app.watchlist_item, app.alert_rule,
  app.alert_event, app.alert_delivery, app.note, app.report, app.briefing, app.correction, app.stored_file, app.user_pref,
  app.ask_log, app.usage_event to authenticated;
grant update (name, sender_name) on app.team to authenticated;
grant insert, update, delete on app.client, app.watchlist, app.watchlist_item, app.alert_rule, app.note to authenticated;
grant insert, delete on app.report to authenticated;
grant update (content, status, approved_by, approved_at, recipients, narrative_source) on app.report to authenticated;
grant insert on app.correction to authenticated;
grant update (status, resolution, acknowledged_at, resolved_at, resolved_by) on app.correction to authenticated;
revoke all on app.matcher_state from authenticated, anonymous;

-- New functions default to EXECUTE for PUBLIC; narrow the ones that reveal account state.
revoke execute on function app.entitlements(text) from public, anonymous;
revoke execute on function app.legacy_tier(text) from public, anonymous, authenticated;
grant execute on function app.entitlements(text), app.my_entitlements(), app.is_team_member(uuid), app.team_role(uuid),
  app.is_team_admin(uuid), app.team_features(uuid), app.team_tier(uuid), app.watchlist_team(uuid), app.plan_features(text),
  app.tier_rank(text), app.is_paid(), app.is_staff() to authenticated;

-- ------------------------------------------------------------------------------------------------
-- One-time data migration: user_account.watch_entity_ids → a personal team with a default watchlist.
-- Runs only for users without a personal team, so re-applying the migration is a no-op.
-- ------------------------------------------------------------------------------------------------
do $$
declare
  u record;
  tid uuid;
  wid uuid;
begin
  perform set_config('app.bypass_watch_limit', 'on', true);
  for u in
    select ua.user_id, ua.watch_entity_ids from user_account ua
     where cardinality(ua.watch_entity_ids) > 0
       and not exists (select 1 from app.team t join app.team_member m on m.team_id = t.id
                        where t.is_personal and m.user_id = ua.user_id and m.role = 'owner')
  loop
    insert into app.team(name, is_personal, created_by) values ('Personal', true, u.user_id) returning id into tid;
    insert into app.team_member(team_id, user_id, role, joined_at) values (tid, u.user_id, 'owner', now());
    insert into app.watchlist(team_id, name, is_default, owner_user_id) values (tid, 'My watchlist', true, u.user_id) returning id into wid;
    insert into app.watchlist_item(watchlist_id, entity_id, position)
      select wid, e.id, 'monitor' from unnest(u.watch_entity_ids) as w(id) join entity e on e.id = w.id
      on conflict do nothing;
  end loop;
  perform set_config('app.bypass_watch_limit', '', true);
end $$;
