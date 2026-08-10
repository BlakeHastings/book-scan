-- The ten photograph columns on `books` are dropped. `capture` is the record.
--
-- `front_image`, `back_image`, `edge_image`, `cover_image`, `front_hash`,
-- `cover_hash`, `front_crop`, `back_crop`, `edge_crop` and `cropped`. Between
-- them they allowed exactly one photograph of each kind, forever: a blurred
-- spine could only be re-shot by overwriting the original, and the original is
-- the record. #192 gave every one of them a row in `capture`, #214 put the three
-- statements that write one in charge of recording it, `0017` repaired the rows
-- written in between, and the commit before this one moved every reader onto the
-- rows. This is the step where there stops being a second answer.
--
-- `cover_checked_at` is not in the list and that is the one judgement here. It
-- records that a cover was looked for, including for a book that has none
-- anywhere, which is a fact about a search rather than about a photograph, and
-- it is what stops the backfill asking about the same book forever.
--
-- ## The views are dropped and rebuilt, and that is not incidental
--
-- `shelved_books`, `queued_books` and `catalogued_books` are `books` under three
-- predicates, so Postgres will not let a column go while one of them selects it.
-- They come back below with the same predicates and the columns that are left.
-- The block at the end reads each one back against the predicate it is supposed
-- to be, which is the check worth making: a rebuilt view with a predicate that
-- drifted would not fail, it would quietly show a different set of books.
--
-- ## It counts both ways before it drops anything
--
-- Every photograph the columns name has to be reachable from `capture`, and
-- every crop has to be recorded on the photograph it was cut from. Both are
-- counted here, against the columns, while there is still something to count
-- against. **A disagreement raises**, the way `0006` and `0013` raise, because a
-- migration that drops the only other copy of somebody's photographs and reports
-- nothing is the one shape that must not exist.
--
-- The examined distinction is checked in the same block. A slot named in
-- `books.cropped` is a photograph a detector was shown, and after this there is
-- nowhere but `capture.examined` for that to be recorded; a row that says
-- otherwise would turn "the book could not be picked out of this photo" into a
-- sentence about a photograph nothing has ever opened.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the cover
-- directory. The photographs are files, they are over a gigabyte, they are half
-- of what is irreplaceable about this catalogue, and they are outside this
-- repository. What goes is ten columns that named them.

DO $$
DECLARE
  photographs bigint;
  reachable bigint;
  crops bigint;
  crops_recorded bigint;
  looked_at_and_lost bigint;
  orphaned text;
BEGIN
  SELECT count(*) INTO photographs FROM (
    SELECT "id" AS book_id, "front_image" AS file FROM "books" WHERE COALESCE("front_image", '') <> ''
    UNION
    SELECT "id", "back_image" FROM "books" WHERE COALESCE("back_image", '') <> ''
    UNION
    SELECT "id", "edge_image" FROM "books" WHERE COALESCE("edge_image", '') <> ''
    UNION
    SELECT "id", "cover_image" FROM "books" WHERE COALESCE("cover_image", '') <> ''
  ) named;

  SELECT count(*) INTO reachable FROM (
    SELECT "id" AS book_id, "front_image" AS file FROM "books" WHERE COALESCE("front_image", '') <> ''
    UNION
    SELECT "id", "back_image" FROM "books" WHERE COALESCE("back_image", '') <> ''
    UNION
    SELECT "id", "edge_image" FROM "books" WHERE COALESCE("edge_image", '') <> ''
    UNION
    SELECT "id", "cover_image" FROM "books" WHERE COALESCE("cover_image", '') <> ''
  ) named
  WHERE EXISTS (
    SELECT 1 FROM "capture" c WHERE c."book_id" = named.book_id AND c."file" = named.file
  );

  RAISE NOTICE 'dropping the image columns: % photographs named, % reachable from capture',
    photographs, reachable;

  IF reachable <> photographs THEN
    SELECT string_agg(missing.file, ', ') INTO orphaned FROM (
      SELECT named.book_id, named.file FROM (
        SELECT "id" AS book_id, "front_image" AS file FROM "books" WHERE COALESCE("front_image", '') <> ''
        UNION
        SELECT "id", "back_image" FROM "books" WHERE COALESCE("back_image", '') <> ''
        UNION
        SELECT "id", "edge_image" FROM "books" WHERE COALESCE("edge_image", '') <> ''
        UNION
        SELECT "id", "cover_image" FROM "books" WHERE COALESCE("cover_image", '') <> ''
      ) named
      WHERE NOT EXISTS (
        SELECT 1 FROM "capture" c WHERE c."book_id" = named.book_id AND c."file" = named.file
      )
      LIMIT 20
    ) missing;

    RAISE EXCEPTION
      'refusing to drop the image columns: % photographs are named and only % have a capture row. Unreachable: %',
      photographs, reachable, COALESCE(orphaned, '(none listed)');
  END IF;

  SELECT count(*) INTO crops FROM (
    SELECT "id" AS book_id, "front_crop" AS file FROM "books" WHERE COALESCE("front_crop", '') <> ''
    UNION
    SELECT "id", "back_crop" FROM "books" WHERE COALESCE("back_crop", '') <> ''
    UNION
    SELECT "id", "edge_crop" FROM "books" WHERE COALESCE("edge_crop", '') <> ''
  ) cut;

  SELECT count(*) INTO crops_recorded FROM (
    SELECT "id" AS book_id, "front_crop" AS file FROM "books" WHERE COALESCE("front_crop", '') <> ''
    UNION
    SELECT "id", "back_crop" FROM "books" WHERE COALESCE("back_crop", '') <> ''
    UNION
    SELECT "id", "edge_crop" FROM "books" WHERE COALESCE("edge_crop", '') <> ''
  ) cut
  WHERE EXISTS (
    SELECT 1 FROM "capture" c WHERE c."book_id" = cut.book_id AND c."crop_file" = cut.file
  );

  IF crops_recorded <> crops THEN
    RAISE EXCEPTION
      'refusing to drop the image columns: % crops are named and only % are recorded on a photograph',
      crops, crops_recorded;
  END IF;

  SELECT count(*) INTO looked_at_and_lost FROM "books" b
    JOIN LATERAL (VALUES ('front', b."front_image"), ('back', b."back_image"), ('spine', b."edge_image")) AS s(kind, file)
      ON COALESCE(s.file, '') <> ''
   WHERE (',' || COALESCE(b."cropped", '') || ',')
         LIKE '%,' || CASE s.kind WHEN 'spine' THEN 'edge' ELSE s.kind END || ',%'
     AND NOT EXISTS (
       SELECT 1 FROM "capture" c
        WHERE c."book_id" = b."id" AND c."file" = s.file AND c."examined"
     );

  IF looked_at_and_lost <> 0 THEN
    RAISE EXCEPTION
      'refusing to drop the image columns: % photographs a detector was shown have no row saying so',
      looked_at_and_lost;
  END IF;

  RAISE NOTICE 'dropping the image columns: % crops named, all recorded, and every examined slot has a row',
    crops;
END $$;
--> statement-breakpoint

DROP VIEW "public"."catalogued_books";--> statement-breakpoint
DROP VIEW "public"."queued_books";--> statement-breakpoint
DROP VIEW "public"."shelved_books";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "front_image";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "back_image";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "edge_image";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "cover_image";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "front_hash";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "cover_hash";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "front_crop";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "back_crop";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "edge_crop";--> statement-breakpoint
ALTER TABLE "books" DROP COLUMN "cropped";--> statement-breakpoint
CREATE VIEW "public"."catalogued_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "is_fiction", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" in ('shelved', 'checked_out', 'withdrawn'));--> statement-breakpoint
CREATE VIEW "public"."queued_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "is_fiction", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" in ('scanned', 'unidentified', 'identified'));--> statement-breakpoint
CREATE VIEW "public"."shelved_books" AS (select "id", "isbn13", "isbn10", "title", "subtitle", "authors", "publisher", "published", "pages", "notes", "shelf_range", "is_fiction", "classification_source", "classification_confidence", "author_filing", "series_name", "series_index", "title_filing", "sort_key", "location", "lookup_source", "cover_checked_at", "isbn_source", "ocr_text", "scanned_at", "shelved_at", "checked_out_at", "state", "title_guess", "cover_text", "analysed", "draft_json", "edit_json", "edited_by", "edited_at", "scan_note", "claimed_by", "claimed_at", "processed_at", "current_area_id" from "books" where "books"."state" = 'shelved');
--> statement-breakpoint

-- The views are back. Read each one against the predicate it is supposed to be,
-- rather than trusting that it was written out correctly: a rebuilt view whose
-- predicate had drifted would not fail here, it would quietly draw a different
-- set of books, and the shelved one is what every ordering query reads.
DO $$
DECLARE
  from_view text;
  from_table text;
  queued bigint;
  queued_expected bigint;
  catalogued bigint;
  catalogued_expected bigint;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO from_view
    FROM "shelved_books";
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO from_table
    FROM "books" WHERE "state" = 'shelved';

  IF from_view IS DISTINCT FROM from_table THEN
    RAISE EXCEPTION
      'the rebuilt shelved_books is not the shelved books in order: % against %',
      from_view, from_table;
  END IF;

  SELECT count(*) INTO queued FROM "queued_books";
  SELECT count(*) INTO queued_expected FROM "books"
   WHERE "state" IN ('scanned', 'unidentified', 'identified');
  SELECT count(*) INTO catalogued FROM "catalogued_books";
  SELECT count(*) INTO catalogued_expected FROM "books"
   WHERE "state" IN ('shelved', 'checked_out', 'withdrawn');

  IF queued <> queued_expected OR catalogued <> catalogued_expected THEN
    RAISE EXCEPTION
      'the rebuilt views hold the wrong rows: queued % against %, catalogued % against %',
      queued, queued_expected, catalogued, catalogued_expected;
  END IF;
END $$;
