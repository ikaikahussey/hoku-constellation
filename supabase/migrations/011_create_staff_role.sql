CREATE TABLE staff_role (
  user_id UUID PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMPTZ DEFAULT now()
);
