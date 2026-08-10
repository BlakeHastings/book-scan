-- `books.is_fiction` goes, and it is the genre half of the cut-over.
--
-- Nothing has decided anything by it since #223: `settleGenre` writes the genre
-- tag before the row, `rangeOfGenre` reads the tags back, and `books.shelf_range`
-- is written from that answer. The column has been written from the same answer
-- since, so it shadowed the tag rather than competing with it, which is exactly
-- what made it droppable. #227 took it off the wire, so nothing reads it either.
--
-- **What proves it is safe is `infrastructure/db/cutover.test.ts`**, which places
-- every shelved book twice, by this column and by the genre tags, and compares
-- the two answers one book at a time over a catalogue the size and shape of the
-- live one. That comparison cannot be made after this statement, which is why it
-- is made before it and in the same pull request.
--
-- It is not the first column dropped here: `0019` took the ten image columns a
-- fortnight of migrations earlier, and `migrate.test.ts` now names every column
-- the folder removes as well as every one it adds.
--
-- The three views are dropped and rebuilt because they are `SELECT *` over this
-- table and Postgres will not drop a column one depends on. Their predicates are
-- unchanged, and so is every other column in them, including the collations:
-- a view column takes the type of the expression behind it, and
-- `migrate.test.ts` reads those back out of the catalogue rather than trusting
-- the statement below.
--
-- No book moves. `books.sort_key` and `books.shelf_range` are untouched, and a
-- shelf is ordered by those two and by nothing else.

DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "is_fiction";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" = 'shelved');