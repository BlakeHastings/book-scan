-- `books.location` goes, and it is the placement half of the cut-over.
--
-- Nothing has read it since #232: `withPlacements` in `server/placement-ledger.ts`
-- derives the label from `books.current_area_id`, which is the projection of
-- `book_placement`, and `Store.setLocation` writes a `placed` row and no column.
-- The ledger says the same thing and more: where the book has been, who said so,
-- and whether the rules wanted it there.
--
-- **What proves it is safe is `infrastructure/db/cutover.test.ts`**, which places
-- every shelved book twice, by this column and by the ledger, and compares the
-- two answers one book at a time over a catalogue the size and shape of the live
-- one. That comparison cannot be made after this statement, which is why it is
-- made before it and in the same pull request, and `0023` is the repair that made
-- the two agree while the column still said something.
--
-- The guard below is that claim asked once more, of the rows this database
-- actually has, immediately before the column goes. It refuses rather than
-- finishing quietly, because a book whose location the ledger cannot reproduce is
-- a book nobody can find afterwards.
--
-- The three views are dropped and rebuilt because they select this column and
-- Postgres will not drop a column a view depends on. Their predicates are
-- unchanged, and so is every other column in them, including the collations.
--
-- No book moves. `books.sort_key` and `books.shelf_range` are untouched, and a
-- shelf is ordered by those two and by nothing else.

DO $$
DECLARE
  behind bigint;
  named text[];
BEGIN
  SELECT count(*), (array_agg(b."title" || ' at ' || btrim(b."location")))[1:8]
    INTO behind, named
    FROM "catalogued_books" b
    LEFT JOIN "area" a ON a."id" = b."current_area_id"
    LEFT JOIN "fixture" f ON f."id" = a."fixture_id"
   WHERE btrim(COALESCE(b."location", '')) <> ''
     AND (a."id" IS NULL
          OR f."position" <> (regexp_match(btrim(b."location"),
                                           '^\s*[Ss]?([0-9]+)'))[1]::int);

  IF behind <> 0 THEN
    RAISE EXCEPTION
      'dropping books.location would lose where % books are: the ledger does not '
      'put them on the bookcase the column names, including %. Run 0023 again, or '
      'record where those books actually are',
      behind, array_to_string(named, '; ');
  END IF;

  RAISE NOTICE 'books.location goes: every recorded location is a placement the '
    'ledger already holds';
END $$;--> statement-breakpoint
DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "location";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" = 'shelved');