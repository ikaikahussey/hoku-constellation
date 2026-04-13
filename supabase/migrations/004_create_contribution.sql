CREATE TABLE contribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_name_raw TEXT NOT NULL,
  recipient_name_raw TEXT NOT NULL,
  donor_person_id UUID REFERENCES person(id),
  donor_org_id UUID REFERENCES organization(id),
  recipient_person_id UUID REFERENCES person(id),
  recipient_org_id UUID REFERENCES organization(id),
  match_confidence REAL,
  match_status TEXT DEFAULT 'unmatched',
  amount NUMERIC(12,2) NOT NULL,
  contribution_date DATE,
  election_period TEXT,
  contribution_type TEXT,
  source TEXT NOT NULL,
  raw_record JSONB,
  source_file TEXT,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX contribution_donor_person_idx ON contribution(donor_person_id);
CREATE INDEX contribution_donor_org_idx ON contribution(donor_org_id);
CREATE INDEX contribution_recipient_person_idx ON contribution(recipient_person_id);
CREATE INDEX contribution_recipient_org_idx ON contribution(recipient_org_id);
CREATE INDEX contribution_date_idx ON contribution(contribution_date);
CREATE INDEX contribution_amount_idx ON contribution(amount);
CREATE INDEX contribution_match_status_idx ON contribution(match_status);
