CREATE TABLE financial_disclosure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES person(id),
  filing_year INTEGER NOT NULL,
  position_held TEXT,
  financial_interests JSONB,
  source_url TEXT,
  raw_record JSONB,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX disclosure_person_idx ON financial_disclosure(person_id);
CREATE INDEX disclosure_year_idx ON financial_disclosure(filing_year);
