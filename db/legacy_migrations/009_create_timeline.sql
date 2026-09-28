CREATE TABLE timeline_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES person(id),
  organization_id UUID REFERENCES organization(id),
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  source_description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID,

  CONSTRAINT event_has_entity CHECK (
    person_id IS NOT NULL OR organization_id IS NOT NULL
  )
);

CREATE INDEX timeline_person_idx ON timeline_event(person_id);
CREATE INDEX timeline_org_idx ON timeline_event(organization_id);
CREATE INDEX timeline_date_idx ON timeline_event(event_date);
CREATE INDEX timeline_type_idx ON timeline_event(event_type);
