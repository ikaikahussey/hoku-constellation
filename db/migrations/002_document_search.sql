-- Indexes for the /documents browser: trigram search on titles and record ids, date ordering.
-- Idempotent; applied by scripts/db/migrate.ts after 001_core_schema.sql.
create extension if not exists pg_trgm;
create index if not exists document_title_trgm_idx on document using gin (title gin_trgm_ops);
create index if not exists document_source_record_id_trgm_idx on document using gin (source_record_id gin_trgm_ops);
create index if not exists document_doc_date_idx on document (doc_date desc nulls last, fetched_at desc);
