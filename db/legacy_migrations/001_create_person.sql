CREATE TABLE person (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  slug TEXT UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  entity_types TEXT[] NOT NULL DEFAULT '{}',
  office_held TEXT,
  party TEXT,
  district TEXT,
  island TEXT,
  term_start DATE,
  term_end DATE,
  bio_summary TEXT,
  photo_url TEXT,
  website_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  is_featured BOOLEAN DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'gated',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX person_search_idx ON person
  USING GIN (to_tsvector('english',
    coalesce(full_name, '') || ' ' ||
    coalesce(array_to_string(aliases, ' '), '') || ' ' ||
    coalesce(office_held, '') || ' ' ||
    coalesce(bio_summary, '')
  ));

CREATE INDEX person_slug_idx ON person(slug);
CREATE INDEX person_status_idx ON person(status);
CREATE INDEX person_island_idx ON person(island);
CREATE INDEX person_featured_idx ON person(is_featured) WHERE is_featured = TRUE;
