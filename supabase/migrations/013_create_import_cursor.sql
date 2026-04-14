CREATE TABLE import_cursor (
  source TEXT PRIMARY KEY,
  cursor_offset INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  status TEXT DEFAULT 'idle',
  metadata JSONB DEFAULT '{}'
);
