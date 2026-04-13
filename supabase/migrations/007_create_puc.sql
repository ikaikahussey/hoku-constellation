CREATE TABLE puc_docket (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  docket_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  docket_type TEXT,
  status TEXT DEFAULT 'open',
  filed_date DATE,
  decision_date DATE,
  summary TEXT,
  utility_type TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE puc_participant (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  docket_id UUID REFERENCES puc_docket(id) ON DELETE CASCADE,
  person_id UUID REFERENCES person(id),
  organization_id UUID REFERENCES organization(id),
  role TEXT NOT NULL,
  CONSTRAINT puc_participant_has_entity CHECK (
    person_id IS NOT NULL OR organization_id IS NOT NULL
  )
);

CREATE INDEX puc_docket_number_idx ON puc_docket(docket_number);
CREATE INDEX puc_docket_status_idx ON puc_docket(status);
CREATE INDEX puc_participant_docket_idx ON puc_participant(docket_id);
CREATE INDEX puc_participant_person_idx ON puc_participant(person_id);
CREATE INDEX puc_participant_org_idx ON puc_participant(organization_id);
