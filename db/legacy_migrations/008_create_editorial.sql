CREATE TABLE article (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at DATE,
  summary TEXT,
  source TEXT NOT NULL,
  author TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE article_entity_mention (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID REFERENCES article(id) ON DELETE CASCADE,
  person_id UUID REFERENCES person(id),
  organization_id UUID REFERENCES organization(id),
  mention_type TEXT NOT NULL,
  CONSTRAINT mention_has_entity CHECK (
    person_id IS NOT NULL OR organization_id IS NOT NULL
  )
);

CREATE INDEX article_source_idx ON article(source);
CREATE INDEX article_published_idx ON article(published_at);
CREATE INDEX mention_article_idx ON article_entity_mention(article_id);
CREATE INDEX mention_person_idx ON article_entity_mention(person_id);
CREATE INDEX mention_org_idx ON article_entity_mention(organization_id);
