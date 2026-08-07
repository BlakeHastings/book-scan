-- The fiction flag, and how it was decided, become tags carrying the same
-- provenance.
--
-- Every book already answers "fiction or not", and `classification_source` and
-- `classification_confidence` already record who decided and how sure they
-- were. That is a tag with a source and a confidence, written in three columns
-- because there was nowhere else to put it. This moves it, and it moves the
-- provenance with it rather than restating the whole catalogue as a guess:
--
--   classification_source = 'manual'  ->  source = 'person'
--   anything else                     ->  source = 'guess'
--
-- 'manual' is what `Store.updateBook` writes when somebody saves an edit, and
-- 'auto' is what `Store.addBook` and the queue write when the classifier
-- decided. A person's answer surviving as a person's answer is the whole point:
-- once these are tags, a catalogue lookup may rewrite what it claimed and must
-- never touch what a person said, and it can only honour that if the rows say
-- which is which.
--
-- Nothing is dropped here. `books.is_fiction` still decides which shelf range a
-- book files into (`Store.resolveKey`) and is still the JSON the client reads,
-- so removing it belongs with the work that remodels `books` rather than with
-- the work that adds the vocabulary. See the pull request for #179.
--
-- Idempotent by construction: both inserts collide with the primary key rather
-- than duplicating, so re-running this migration on a database that already has
-- these rows changes nothing.

INSERT INTO "tag" ("slug", "label", "note") VALUES
  ('genre/fiction', 'Fiction', 'Carried over from books.is_fiction.'),
  ('genre/non-fiction', 'Non-fiction', 'Carried over from books.is_fiction.')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "book_tag" ("book_id", "tag_id", "source", "confidence", "added_at")
SELECT
  b."id",
  t."id",
  CASE WHEN b."classification_source" = 'manual' THEN 'person' ELSE 'guess' END,
  COALESCE(NULLIF(b."classification_confidence", ''), 'unknown'),
  -- When the fact was recorded, which is when the book was scanned. A migration
  -- timestamp would say every book was tagged the day this ran, which is a
  -- worse answer than the one the row already carries.
  COALESCE(NULLIF(b."scanned_at", ''), '1970-01-01T00:00:00.000Z')
FROM "books" b
JOIN "tag" t
  ON t."slug" = CASE WHEN b."is_fiction" = 1 THEN 'genre/fiction' ELSE 'genre/non-fiction' END
ON CONFLICT DO NOTHING;
