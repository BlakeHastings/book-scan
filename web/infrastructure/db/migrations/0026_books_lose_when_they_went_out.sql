-- `books.checked_out_at` goes, and it was three things wearing one name.
--
-- It was a column, a state and a placement kind. `0008` made the state from it
-- (`checked_out_at IS NOT NULL` is `state = 'checked_out'`, which is the
-- predicate every shelf query already read), `0015` made the placement kind from
-- it, and #232 is where the column stops being the third answer.
--
-- What the client reads is unchanged: `withPlacements` in
-- `server/placement-ledger.ts` answers `checked_out_at` from the `created_at` of
-- the latest `checked_out` row, and only while the book is in that state, so a
-- checkout that changes nothing still keeps the moment the book actually left.
-- `Store.setCheckedOut` compares and sets `books.state` in one statement, which
-- is what it always did with the column beside it.
--
-- The guard is both directions at once, because the two ways this could be wrong
-- are opposite: a book off the shelf with no row to say when it left, and a
-- column saying a book is out that the state does not agree with. It refuses
-- rather than finishing quietly.
--
-- The three views are dropped and rebuilt because they select this column.
-- No book moves.

DO $$
DECLARE
  without_a_row bigint;
  out_of_step bigint;
BEGIN
  SELECT count(*) INTO without_a_row FROM "books" b
   WHERE b."checked_out_at" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "book_placement" p
                      WHERE p."book_id" = b."id" AND p."kind" = 'checked_out');

  SELECT count(*) INTO out_of_step FROM "books" b
   WHERE (b."checked_out_at" IS NOT NULL) <> (b."state" = 'checked_out');

  IF without_a_row <> 0 THEN
    RAISE EXCEPTION
      'dropping books.checked_out_at would lose when % books went out: they carry '
      'a moment and no checked_out row to hold it', without_a_row;
  END IF;

  IF out_of_step <> 0 THEN
    RAISE EXCEPTION
      'books.checked_out_at and books.state disagree about % books, so one of the '
      'two says a book is in somebody''s bag and the other says it is on a shelf. '
      'The state is what survives this migration, so settle them first',
      out_of_step;
  END IF;

  RAISE NOTICE 'books.checked_out_at goes: the state says which books are out and '
    'the ledger says when each of them left';
END $$;--> statement-breakpoint
DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "checked_out_at";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" = 'shelved');