ALTER TABLE person ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbyist_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobbyist_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_lobbying_expenditure ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_disclosure ENABLE ROW LEVEL SECURITY;
ALTER TABLE puc_docket ENABLE ROW LEVEL SECURITY;
ALTER TABLE puc_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE article ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_entity_mention ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_role ENABLE ROW LEVEL SECURITY;

-- Person: anyone can read basic info
CREATE POLICY "Anyone can read person" ON person FOR SELECT USING (true);
CREATE POLICY "Staff can manage person" ON person FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Organization: anyone can read
CREATE POLICY "Anyone can read organization" ON organization FOR SELECT USING (true);
CREATE POLICY "Staff can manage organization" ON organization FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Relationship: anyone can read
CREATE POLICY "Anyone can read relationship" ON relationship FOR SELECT USING (true);
CREATE POLICY "Staff can manage relationship" ON relationship FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Contribution: subscribers only
CREATE POLICY "Subscribers can read contributions" ON contribution FOR SELECT USING (
  auth.uid() IN (
    SELECT id FROM user_profile
    WHERE subscription_tier IN ('individual', 'professional', 'institutional')
    AND subscription_status IN ('active', 'trialing')
  )
  OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Staff can manage contributions" ON contribution FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Lobbying: subscribers only
CREATE POLICY "Subscribers can read lobby registrations" ON lobbyist_registration FOR SELECT USING (
  auth.uid() IN (
    SELECT id FROM user_profile
    WHERE subscription_tier IN ('individual', 'professional', 'institutional')
    AND subscription_status IN ('active', 'trialing')
  )
  OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Staff can manage lobby registrations" ON lobbyist_registration FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

CREATE POLICY "Subscribers can read lobby expenditures" ON lobbyist_expenditure FOR SELECT USING (
  auth.uid() IN (
    SELECT id FROM user_profile
    WHERE subscription_tier IN ('individual', 'professional', 'institutional')
    AND subscription_status IN ('active', 'trialing')
  )
  OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Staff can manage lobby expenditures" ON lobbyist_expenditure FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

CREATE POLICY "Subscribers can read org lobby expenditures" ON org_lobbying_expenditure FOR SELECT USING (
  auth.uid() IN (
    SELECT id FROM user_profile
    WHERE subscription_tier IN ('individual', 'professional', 'institutional')
    AND subscription_status IN ('active', 'trialing')
  )
  OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Staff can manage org lobby expenditures" ON org_lobbying_expenditure FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Financial disclosures: subscribers only
CREATE POLICY "Subscribers can read disclosures" ON financial_disclosure FOR SELECT USING (
  auth.uid() IN (
    SELECT id FROM user_profile
    WHERE subscription_tier IN ('individual', 'professional', 'institutional')
    AND subscription_status IN ('active', 'trialing')
  )
  OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Staff can manage disclosures" ON financial_disclosure FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- PUC: anyone can read
CREATE POLICY "Anyone can read puc_docket" ON puc_docket FOR SELECT USING (true);
CREATE POLICY "Staff can manage puc_docket" ON puc_docket FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

CREATE POLICY "Anyone can read puc_participant" ON puc_participant FOR SELECT USING (true);
CREATE POLICY "Staff can manage puc_participant" ON puc_participant FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Articles: anyone can read
CREATE POLICY "Anyone can read article" ON article FOR SELECT USING (true);
CREATE POLICY "Staff can manage article" ON article FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

CREATE POLICY "Anyone can read article mentions" ON article_entity_mention FOR SELECT USING (true);
CREATE POLICY "Staff can manage article mentions" ON article_entity_mention FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- Timeline: anyone can read
CREATE POLICY "Anyone can read timeline" ON timeline_event FOR SELECT USING (true);
CREATE POLICY "Staff can manage timeline" ON timeline_event FOR ALL USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);

-- User profile: users can read own, staff can read all
CREATE POLICY "Users can read own profile" ON user_profile FOR SELECT USING (
  auth.uid() = id OR auth.uid() IN (SELECT user_id FROM staff_role)
);
CREATE POLICY "Users can update own profile" ON user_profile FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role can manage profiles" ON user_profile FOR ALL USING (true);

-- Staff role: staff can read
CREATE POLICY "Staff can read staff roles" ON staff_role FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM staff_role)
);
