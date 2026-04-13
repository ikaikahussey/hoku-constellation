CREATE TABLE lobbyist_registration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobbyist_person_id UUID REFERENCES person(id),
  lobbying_firm_org_id UUID REFERENCES organization(id),
  client_org_id UUID REFERENCES organization(id),
  client_name_raw TEXT,
  registration_period TEXT,
  issues TEXT[],
  source_url TEXT,
  raw_record JSONB,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE lobbyist_expenditure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID REFERENCES lobbyist_registration(id),
  lobbyist_person_id UUID REFERENCES person(id),
  client_org_id UUID REFERENCES organization(id),
  amount NUMERIC(12,2),
  period TEXT,
  expenditure_type TEXT,
  raw_record JSONB,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE org_lobbying_expenditure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organization(id),
  org_name_raw TEXT,
  amount NUMERIC(12,2),
  period TEXT,
  expenditure_type TEXT,
  raw_record JSONB,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX lobby_reg_person_idx ON lobbyist_registration(lobbyist_person_id);
CREATE INDEX lobby_reg_firm_idx ON lobbyist_registration(lobbying_firm_org_id);
CREATE INDEX lobby_reg_client_idx ON lobbyist_registration(client_org_id);
CREATE INDEX lobby_exp_person_idx ON lobbyist_expenditure(lobbyist_person_id);
CREATE INDEX lobby_exp_client_idx ON lobbyist_expenditure(client_org_id);
