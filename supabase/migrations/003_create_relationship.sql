CREATE TABLE relationship (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_person_id UUID REFERENCES person(id) ON DELETE CASCADE,
  source_org_id UUID REFERENCES organization(id) ON DELETE CASCADE,
  target_person_id UUID REFERENCES person(id) ON DELETE CASCADE,
  target_org_id UUID REFERENCES organization(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  title TEXT,
  start_date DATE,
  end_date DATE,
  is_current BOOLEAN DEFAULT TRUE,
  source_url TEXT,
  source_description TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,

  CONSTRAINT relationship_has_source CHECK (
    source_person_id IS NOT NULL OR source_org_id IS NOT NULL
  ),
  CONSTRAINT relationship_has_target CHECK (
    target_person_id IS NOT NULL OR target_org_id IS NOT NULL
  )
);

CREATE INDEX rel_source_person_idx ON relationship(source_person_id);
CREATE INDEX rel_source_org_idx ON relationship(source_org_id);
CREATE INDEX rel_target_person_idx ON relationship(target_person_id);
CREATE INDEX rel_target_org_idx ON relationship(target_org_id);
CREATE INDEX rel_type_idx ON relationship(relationship_type);
CREATE INDEX rel_current_idx ON relationship(is_current) WHERE is_current = TRUE;
