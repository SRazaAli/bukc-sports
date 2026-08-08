-- ============================================================================
-- 005 — equipment_type attributes: indoor/outdoor, image, barcode length.
--
-- Indoor/Outdoor moves to equipment_type (an attribute), not sport_category
-- (a parallel tree) — equipment specs differ within a sport (e.g. an indoor
-- five-a-side ball vs an outdoor football) while the sport stays one category.
-- ============================================================================

ALTER TABLE equipment_type ADD COLUMN is_indoor boolean NOT NULL DEFAULT true;
ALTER TABLE equipment_type ADD COLUMN image_url text;

-- Standard barcode length practice (Code-128 / EAN-range identifiers).
ALTER TABLE article ADD CONSTRAINT ck_article_barcode_length
  CHECK (char_length(barcode) BETWEEN 6 AND 48);
