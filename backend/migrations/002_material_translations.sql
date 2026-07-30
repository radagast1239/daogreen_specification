-- Additive English material translations (locale=en). Russian materials rows stay canonical.
CREATE TABLE IF NOT EXISTS material_translations (
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  locale TEXT NOT NULL CHECK (locale = 'en'),
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  translation_status TEXT NOT NULL DEFAULT 'fallback_original'
    CHECK (translation_status IN ('translated', 'needs_review', 'do_not_translate', 'fallback_original')),
  source_hash TEXT NOT NULL DEFAULT '',
  translator_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (material_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_material_translations_status
  ON material_translations(translation_status);
