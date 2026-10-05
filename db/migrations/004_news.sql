-- News aggregator support (lib/news, lib/import/sources/news.ts). Idempotent.
--
-- Articles are ordinary `document` rows (doc_type 'article', source 'news'); entity tags are
-- `mentioned_in` edges; generated summaries go in `summary` with document_id set. This file adds
-- only the lookup machinery the tagger needs:
--
--   entity_match_key(text)                 SQL mirror of lib/entity-match.ts normalize()
--   entity_match_keys(kind, name, aliases) every key an entity answers to (name + aliases, and for
--                                          orgs the suffix-stripped normalizeOrg() form)
--   entity_match_keys_gin                  GIN index so `entity_match_keys(...) && $1::text[]` is an
--                                          index lookup for a whole article's candidate phrases.
--
-- Keep entity_match_key in sync with normalize(); tests/news.test.ts checks parity.

create or replace function public.entity_match_key(s text) returns text
  language sql immutable parallel safe
  as $$
    select btrim(regexp_replace(regexp_replace(replace(lower(regexp_replace(translate(s,
      'āēīōūĀĒĪŌŪáéíóúàèìòùâêîôûäëïöüñçÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑÇ',
      'aeiouAEIOUaeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC'),
      '[ʻ‘’`'']', '', 'g')), '&', ' and '), '[^a-z0-9[:space:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g'))
  $$;

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
    ) keys where key is not null and key <> ''
  $$;

create index if not exists entity_match_keys_gin on entity using gin (public.entity_match_keys(kind, name, aliases));
create index if not exists summary_document_idx on summary(document_id) where document_id is not null;

grant execute on function public.entity_match_key(text), public.entity_match_keys(text, text, text[]) to authenticated, anonymous;
