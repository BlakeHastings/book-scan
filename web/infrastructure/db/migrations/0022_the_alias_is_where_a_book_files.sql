-- `books.author_filing` goes, and the three views answer it from the alias.
--
-- The second and last column #227 drops. It held what the first-listed
-- author files under, which is the first component of every `sort_key` a shelf
-- is ordered by, and `author_alias.filing_name` has held the same fact since
-- #180 with nothing reading it. `0020` made the alias agree with the column
-- wherever they had drifted; the commit before this one made `Store` read the
-- alias and write the column from that answer, so it has been a shadow rather
-- than a second opinion; this takes it away.
--
-- **The value did not go anywhere.** The views carry `author_filing` still, from
-- the credit at position 1, so every statement that reads a book out of one of
-- them answers exactly what it answered before, and the client's listings and
-- shelf rows are untouched. What is gone is the copy on the row.
--
-- `books` itself no longer has it, and that is the point of the split: a lookup
-- by id is a lookup of a book, and what its author files under is a fact about
-- the author. `GET /api/books/:id` answers with the book's credits beside it.
--
-- **The collation survives the `coalesce`.** `author_alias.filing_name` is
-- `COLLATE "C"` and a string literal carries no collation of its own, so the
-- result keeps the column's, which is what makes the view column comparable byte
-- by byte the way the dropped one was. `migrate.test.ts` reads it back out of the
-- catalogue rather than trusting this paragraph.
--
-- **What proves it is safe is `infrastructure/db/cutover.test.ts`**, which places
-- every shelved book twice, by this column and by the credited alias, and
-- compares the two answers one book at a time. That comparison cannot be made
-- after this statement, which is why it is made before it and in the same pull
-- request. It names the books the two models place differently and says why:
-- they are #195's, whose stored filing name is the empty string.
--
-- No book moves. `books.sort_key` is untouched, and a shelf is ordered by that
-- and by `shelf_range`.

DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "author_filing";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."location", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."location", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "books"."id", "books"."isbn13", "books"."isbn10", "books"."title", "books"."subtitle", "books"."authors", "books"."publisher", "books"."published", "books"."pages", "books"."notes", "books"."shelf_range", "books"."classification_source", "books"."classification_confidence", "books"."series_name", "books"."series_index", "books"."title_filing", "books"."sort_key", "books"."location", "books"."lookup_source", "books"."cover_checked_at", "books"."isbn_source", "books"."ocr_text", "books"."scanned_at", "books"."shelved_at", "books"."checked_out_at", "books"."state", "books"."title_guess", "books"."cover_text", "books"."analysed", "books"."draft_json", "books"."edit_json", "books"."edited_by", "books"."edited_at", "books"."scan_note", "books"."claimed_by", "books"."claimed_at", "books"."processed_at", "books"."current_area_id", coalesce("author_alias"."filing_name", '') as "author_filing" from "books" left join "book_author" on ("book_author"."book_id" = "books"."id" and "book_author"."position" = 1) left join "author_alias" on "author_alias"."id" = "book_author"."author_alias_id" where "books"."state" = 'shelved');