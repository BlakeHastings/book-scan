-- The repair the cut-over owes: photographs a column names and no row records.
--
-- ## What went wrong, and why it cannot happen again
--
-- #192 turned every photograph a column named into a row in `capture`, and left
-- the rows being written by the two save routes and the background chain behind
-- one of them. Five other paths wrote those columns and recorded nothing: the
-- cover backfill (`Store.setCoverImage`, from `hashInBackground`,
-- `backfillCoversInBackground` and `POST /api/backfill/covers`), the hash
-- backfill (`Store.setHashes`), and the `crop-books` and `rehash-covers` command
-- line tools, which go through none of the server's wiring at all.
--
-- Nothing read `capture`, so the drift had no symptom. A cover the startup
-- backfill downloaded landed in `books.cover_image` and did not become a
-- photograph until that book was next saved, which for a book nobody edits is
-- never.
--
-- #214 fixed the cause: the recording moved off the five callers and onto the
-- three statements that write those columns, each of which hands back the row it
-- wrote. A caller cannot forget what it never had to remember. Rows written
-- between the two are still wrong, and they have been invisible because nothing
-- reads `capture`. **The commit after this one starts reading it**, so this is
-- where they stop being invisible and where they get fixed.
--
-- The sweep is the derivation `0006` already performs, re-run over the books
-- whose columns name something no row records, counting what it wrote.
-- `docs/data-model.md` records it as owed, under "What is built".
--
-- ## This runs while the columns are still authoritative
--
-- That is the whole reason it is here rather than later, and it is the same
-- argument `0016` makes about `books.is_fiction`. Two migrations after this one
-- the columns are gone; after that there is nothing left to repair from.
--
-- ## What it writes, and what it will not write
--
-- Every write here moves in one direction only, which is the same rule
-- `CaptureRepository.record` keeps and the reason two crop passes over one book
-- can race and still agree:
--
--   * a photograph with no row gets one
--   * a crop arrives where there was none
--   * a hash arrives where there was none
--   * `examined` goes false to true
--
-- and nothing here can take any of the four back. A photograph re-shot since is
-- a different file and therefore a different row, so a repair cannot reach back
-- over one: the newest row stays the newest and the column names an older one it
-- has no way to promote.
--
-- **The examined distinction is carried, not flattened.** A slot named in
-- `books.cropped` with an empty crop column was looked at and declined, which is
-- a different fact from never having been looked at, and only the first licenses
-- a caption to say the book could not be picked out of the photo. The block at
-- the end refuses to finish if a slot the column says was examined has a row
-- that says it was not.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the cover
-- directory. The photographs are files, they are over a gigabyte, they are half
-- of what is irreplaceable about this catalogue, and they are outside this
-- repository. What moves is the record of which file is what.
--
-- ## Safe to run twice
--
-- The second run finds every named photograph already recorded and every crop,
-- hash and flag already carried, so the `WHERE` on the conflict clause matches
-- nothing and the counts come back zero. A migration somebody is not sure
-- finished should be safe to set going again.

DO $$
DECLARE
  before_hash text;
  after_hash text;
  rows_added bigint;
  rows_amended bigint;
  photographs bigint;
  reachable bigint;
  crops bigint;
  crops_recorded bigint;
  looked_at_and_lost bigint;
  orphaned text;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  /*
   * `DISTINCT ON (book_id, file)` because a photograph is identified by the book
   * and the file, and `ON CONFLICT DO UPDATE` refuses to touch one row twice in
   * a statement. A book that somehow names one file in two columns has one
   * photograph, not two, which is the same thing `0006` says with `UNION` when it
   * counts. The order picks front over back over spine over catalogue, so the
   * kind such a row lands under is the one it would already be under.
   */
  WITH named AS (
    SELECT "id" AS book_id, 'front' AS kind, "front_image" AS file,
           COALESCE("front_crop", '') AS crop_file,
           (',' || COALESCE("cropped", '') || ',') LIKE '%,front,%' AS examined,
           COALESCE("front_hash", '') AS hash,
           COALESCE(NULLIF("scanned_at", ''), '1970-01-01T00:00:00.000Z') AS taken_at,
           1 AS rank
      FROM "books" WHERE COALESCE("front_image", '') <> ''
    UNION ALL
    SELECT "id", 'back', "back_image",
           COALESCE("back_crop", ''),
           (',' || COALESCE("cropped", '') || ',') LIKE '%,back,%',
           -- No hash column ever existed for the back photograph. Nothing is
           -- being lost here: there was never one to carry.
           '',
           COALESCE(NULLIF("scanned_at", ''), '1970-01-01T00:00:00.000Z'),
           2
      FROM "books" WHERE COALESCE("back_image", '') <> ''
    UNION ALL
    SELECT "id", 'spine', "edge_image",
           COALESCE("edge_crop", ''),
           (',' || COALESCE("cropped", '') || ',') LIKE '%,edge,%',
           '',
           COALESCE(NULLIF("scanned_at", ''), '1970-01-01T00:00:00.000Z'),
           3
      FROM "books" WHERE COALESCE("edge_image", '') <> ''
    UNION ALL
    SELECT "id", 'catalogue', "cover_image",
           '',
           -- The detector finds a book in a room. A publisher's artwork has no
           -- room in it and has never been offered one.
           false,
           COALESCE("cover_hash", ''),
           -- When the artwork was fetched, which `cover_checked_at` records.
           COALESCE(NULLIF("cover_checked_at", ''), NULLIF("scanned_at", ''),
                    '1970-01-01T00:00:00.000Z'),
           4
      FROM "books" WHERE COALESCE("cover_image", '') <> ''
  ),
  once AS (
    SELECT DISTINCT ON (book_id, file) book_id, kind, file, crop_file, examined, hash, taken_at
      FROM named ORDER BY book_id, file, rank
  ),
  written AS (
    INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
    SELECT book_id, kind, file, crop_file, examined, hash, taken_at FROM once
    ON CONFLICT ("book_id", "file") DO UPDATE SET
      "crop_file" = CASE
        WHEN excluded."crop_file" <> '' THEN excluded."crop_file"
        ELSE "capture"."crop_file"
      END,
      "examined" = "capture"."examined" OR excluded."examined",
      "hash" = CASE
        WHEN excluded."hash" <> '' THEN excluded."hash"
        ELSE "capture"."hash"
      END
      -- Only where the update would actually carry something across, so the
      -- counts below are what this repaired rather than what it visited.
      WHERE (excluded."crop_file" <> '' AND "capture"."crop_file" = '')
         OR (excluded."examined" AND NOT "capture"."examined")
         OR (excluded."hash" <> '' AND "capture"."hash" = '')
    -- `xmax = 0` on the returned row is Postgres saying this was an insert
    -- rather than an update, which is the difference between a photograph that
    -- had no row at all and one whose row was missing a crop or a hash.
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted)
    INTO rows_added, rows_amended
    FROM written;

  RAISE NOTICE 'capture repair: % photographs had no row, % rows were missing a crop, a hash or an examined flag',
    rows_added, rows_amended;

  -- ------------------------------------------------------------------------
  -- Count both ways, and refuse rather than finish quietly.
  -- ------------------------------------------------------------------------
  --
  -- "Both ways" is the point. Every photograph the columns name has to be
  -- reachable from `capture`, and every crop the columns name has to be on the
  -- row of the photograph it was cut from. A count that only went one way would
  -- pass on a table that had lost a photograph and gained a different one.
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
      'the capture repair would have left a photograph unreachable: books name % of them and % have a row. Not recorded: %',
      photographs, reachable, COALESCE(orphaned, '(none, which should be impossible here)');
  END IF;

  -- Every crop a column names, against the crop recorded on the photograph it
  -- was cut from. A crop whose photograph column is empty is a file nothing can
  -- reach, and it fails here rather than being dropped quietly: `cropPhotos`
  -- only ever writes a crop for a photograph it has just read.
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
      'the capture repair would have left a crop unreachable: books name % of them and % are recorded on a photograph',
      crops, crops_recorded;
  END IF;

  -- The distinction the whole table was built around, checked in the direction
  -- this repair is responsible for: a slot the column says a detector was shown
  -- must not be left on a row that says nothing has ever looked at it.
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
      'the capture repair would have lost the examined flag on % photographs a detector had already been shown',
      looked_at_and_lost;
  END IF;

  RAISE NOTICE 'capture repair: % photographs named, all reachable; % crops named, all recorded',
    photographs, crops;

  -- Nothing here writes to `books`, so the shelf cannot have moved. Said with a
  -- hash rather than promised, which is what `0008`, `0011` and `0016` do.
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF after_hash IS DISTINCT FROM before_hash THEN
    RAISE EXCEPTION 'the capture repair moved the shelf order: % became %', before_hash, after_hash;
  END IF;
END $$;
