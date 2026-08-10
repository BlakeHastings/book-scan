-- `books.shelved_at` goes, and it is the one of the five nothing ever read.
--
-- Three statements wrote it, in `Store.addBook`, `Store.updateBook` and
-- `Store.setLocation`, and no query, route, client or browser scenario ever
-- selected it back. Its one reader was `0015`, which turned it into the
-- `created_at` of the `placed` row it wrote for each book, and that has run.
--
-- So the fact it held is in the ledger, on the row it belongs to, and there is
-- more of it than there was: a column could say when a book was last put
-- somewhere and the rows say every time it was put anywhere.
--
-- The guard is the one claim worth making about a column nobody reads: every
-- book that carried a moment has a placement to carry it. It refuses rather than
-- finishing quietly.
--
-- The three views are dropped and rebuilt because they select this column.
-- No book moves.

DO $$
DECLARE
  behind bigint;
BEGIN
  SELECT count(*) INTO behind FROM "catalogued_books" b
   WHERE b."shelved_at" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "book_placement" p
                      WHERE p."book_id" = b."id" AND p."kind" IN ('placed', 'pinned'));

  IF behind <> 0 THEN
    RAISE EXCEPTION
      'dropping books.shelved_at would lose when % books were put somewhere: they '
      'carry a moment and no placement row to hold it', behind;
  END IF;

  RAISE NOTICE 'books.shelved_at goes: every book that carried a moment has a '
    'placement holding it';
END $$;--> statement-breakpoint
DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "shelved_at";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" = 'shelved');