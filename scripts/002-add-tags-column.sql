ALTER TABLE snippets ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_snippets_tags ON snippets USING GIN(tags);
