CREATE TABLE organization (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  org_type TEXT NOT NULL,
  description TEXT,
  website_url TEXT,
  island TEXT,
  sector TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  is_featured BOOLEAN DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'gated',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX org_search_idx ON organization
  USING GIN (to_tsvector('english',
    coalesce(name, '') || ' ' ||
    coalesce(array_to_string(aliases, ' '), '') || ' ' ||
    coalesce(description, '')
  ));

CREATE INDEX org_slug_idx ON organization(slug);
CREATE INDEX org_type_idx ON organization(org_type);
CREATE INDEX org_sector_idx ON organization(sector);
