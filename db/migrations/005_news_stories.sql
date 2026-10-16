-- News stories and wider entity tagging (lib/news/stories.ts, lib/news/tagger.ts). Idempotent.
--
-- 1. entity_match_keys(): a person also answers to the first + last word of their name, so "Joshua B.
--    Green" in the database matches "Joshua Green" in an article (lib/news/tagger.ts firstLastKey()
--    mirrors this). The expression index is rebuilt because the function body changed.
-- 2. ax_news_story / ax_news_story_article: articles from different outlets about the same event,
--    grouped by lib/news/stories.ts. Derived and rebuildable from `document` and `edge`; written by the
--    service role only. A story's id is stable: story_key is the document id of its earliest article.

create or replace function public.entity_match_keys(k text, n text, a text[]) returns text[]
  language sql immutable parallel safe
  as $$
    select coalesce(array_agg(distinct key), '{}') from (
      select public.entity_match_key(x) as key from unnest(array_prepend(n, coalesce(a, '{}'::text[]))) x
      union
      select btrim(regexp_replace(regexp_replace(public.entity_match_key(x),
               '\m(inc|incorporated|llc|l l c|ltd|corp|corporation|co|company|lp|llp|pac|the)\M', ' ', 'g'),
               '[[:space:]]+', ' ', 'g'))
        from unnest(array_prepend(n, coalesce(a, '{}'::text[]))) x where k = 'org'
      union
      select w[1] || ' ' || w[array_length(w, 1)]
        from (select regexp_split_to_array(btrim(regexp_replace(public.entity_match_key(x), '( (jr|sr|ii|iii|iv))+$', '')), ' ') w
                from unnest(array_prepend(n, coalesce(a, '{}'::text[]))) x where k = 'person') p
       where array_length(w, 1) between 3 and 5
    ) keys where key is not null and key <> ''
  $$;

drop index if exists entity_match_keys_gin;
create index entity_match_keys_gin on entity using gin (public.entity_match_keys(kind, name, aliases));

create table if not exists ax_news_story (
  id uuid primary key default gen_random_uuid(),
  story_key uuid not null unique,
  headline text not null,
  headline_document_id uuid references document(id) on delete set null,
  members_hash text not null,
  article_count int not null,
  outlet_count int not null,
  first_published timestamptz,
  last_published timestamptz,
  summary text,
  summary_author text,
  summary_cites uuid[] not null default '{}',
  summary_members_hash text,
  updated_at timestamptz not null default now()
);

create table if not exists ax_news_story_article (
  story_id uuid not null references ax_news_story(id) on delete cascade,
  document_id uuid not null unique references document(id) on delete cascade,
  similarity real,
  primary key (story_id, document_id)
);

create index if not exists ax_news_story_last_idx on ax_news_story(last_published desc nulls last);
create index if not exists ax_news_story_article_story_idx on ax_news_story_article(story_id);

alter table ax_news_story enable row level security;
alter table ax_news_story_article enable row level security;
-- News stories are free content: everyone may read them; no user writes.
drop policy if exists ax_news_story_read on ax_news_story;
create policy ax_news_story_read on ax_news_story for select to authenticated, anonymous using (true);
drop policy if exists ax_news_story_article_read on ax_news_story_article;
create policy ax_news_story_article_read on ax_news_story_article for select to authenticated, anonymous using (true);
grant select on ax_news_story, ax_news_story_article to authenticated, anonymous;
