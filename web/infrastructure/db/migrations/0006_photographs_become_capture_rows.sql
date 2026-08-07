-- Every photograph named by a column on `books` becomes a row in `capture`.
--
-- Four columns hold a photograph and three hold the crop derived from one, and
-- `cropped` holds a comma separated list of the slots a detector has looked at.
-- Between them they allow exactly one photograph of each kind, forever: a
-- blurred spine can only be re-shot by overwriting the original, and the
-- original is the record. This turns each one into a row, after which a second
-- photograph of a kind is an ordinary thing rather than a loss.
--
--   front_image  ->  kind 'front',     crop_file front_crop, hash front_hash
--   back_image   ->  kind 'back',      crop_file back_crop
--   edge_image   ->  kind 'spine',     crop_file edge_crop
--   cover_image  ->  kind 'catalogue', hash cover_hash
--
-- `edge` becomes `spine` here and nowhere above: `docs/data-model.md` settles
-- the vocabulary as front, back, spine and catalogue, and `edge` is a column
-- name from the schema being replaced. This file and `SLOT_OF_KIND` in
-- `server/photographs.ts` are the only two places the two spellings meet.
--
-- ## The examined distinction, carried across intact
--
-- `books.cropped` names the slots a detector has been shown, whether or not it
-- found anything. A slot named there with an empty crop column was **looked at
-- and declined**, which is a different fact from never having been looked at,
-- and only the first one licenses a caption to say the book could not be picked
-- out of the photo. That is one string per row describing three photographs, so
-- it could not have survived a second photograph of a kind at all. It becomes
-- `capture.examined`, per photograph, which is the only thing it was ever a fact
-- about.
--
-- The catalogue artwork is never examined. The detector finds a book in a room,
-- a downloaded cover has no room in it, and it has never been offered one.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the
-- cover directory. The photographs are files, they are over a gigabyte, they are
-- half of what is irreplaceable about this catalogue, and they are outside this
-- repository. What moves is the record of which file is what.
--
-- ## Nothing is dropped
--
-- `books.front_image` and the seven columns beside it are exactly as they were
-- afterwards. They are still what `Store`, the crop backfill, the gallery, the
-- queue panel and the shelf row read, and removing them belongs with the work
-- that remodels `books` and touches most of the client. This is the same shape
-- #179 used for `is_fiction`: copy, keep, and cut over separately.
--
-- **The queue table's three image columns are not migrated**, and that is a
-- decision rather than an oversight. `captures.book_id` is nullable, because a
-- capture waiting to be confirmed is not a book yet, and `capture.book_id` is
-- not null on purpose: a book exists from its first photograph and there is no
-- orphan state. A queue row with no book therefore has nowhere to go until #183
-- gives a scanned-but-unidentified book a state of its own. A queue row that
-- *has* become a book is the other half of the same problem from the other end:
-- `POST /api/books` hands the capture's filenames straight to the book
-- (`server/index.ts`, the `captureId` branch), so its photographs are already
-- migrated as the book's and a second row would be a second capture of one
-- photograph. Both halves want #183. See the pull request for #181.
--
-- ## Idempotent, and it counts rather than trusts
--
-- Every insert collides with `capture_book_file_key` rather than duplicating, so
-- a re-run changes nothing. The block at the end counts the photographs the
-- columns name and the rows that exist, and raises if they disagree, so a
-- statement that silently dropped a WHERE clause or a join fails the startup it
-- ran in rather than quietly losing a photograph.

INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
SELECT
  b."id",
  'front',
  b."front_image",
  COALESCE(b."front_crop", ''),
  (',' || COALESCE(b."cropped", '') || ',') LIKE '%,front,%',
  COALESCE(b."front_hash", ''),
  -- When the photograph was taken, which is when the book was scanned. A
  -- migration timestamp would say every photograph in the catalogue was taken
  -- the day this ran, which is a worse answer than the one the row carries.
  COALESCE(NULLIF(b."scanned_at", ''), '1970-01-01T00:00:00.000Z')
FROM "books" b
WHERE COALESCE(b."front_image", '') <> ''
ON CONFLICT ("book_id", "file") DO NOTHING;
--> statement-breakpoint

INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
SELECT
  b."id",
  'back',
  b."back_image",
  COALESCE(b."back_crop", ''),
  (',' || COALESCE(b."cropped", '') || ',') LIKE '%,back,%',
  -- No hash column exists for the back photograph. Nothing is being lost here:
  -- there was never one to carry.
  '',
  COALESCE(NULLIF(b."scanned_at", ''), '1970-01-01T00:00:00.000Z')
FROM "books" b
WHERE COALESCE(b."back_image", '') <> ''
ON CONFLICT ("book_id", "file") DO NOTHING;
--> statement-breakpoint

INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
SELECT
  b."id",
  'spine',
  b."edge_image",
  COALESCE(b."edge_crop", ''),
  (',' || COALESCE(b."cropped", '') || ',') LIKE '%,edge,%',
  '',
  COALESCE(NULLIF(b."scanned_at", ''), '1970-01-01T00:00:00.000Z')
FROM "books" b
WHERE COALESCE(b."edge_image", '') <> ''
ON CONFLICT ("book_id", "file") DO NOTHING;
--> statement-breakpoint

INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
SELECT
  b."id",
  'catalogue',
  b."cover_image",
  '',
  false,
  COALESCE(b."cover_hash", ''),
  -- When the artwork was fetched, which `cover_checked_at` already records.
  -- Falling back to the scan date rather than to the epoch, because a book with
  -- a cover and no stamp had it downloaded at some point after it was scanned.
  COALESCE(NULLIF(b."cover_checked_at", ''), NULLIF(b."scanned_at", ''), '1970-01-01T00:00:00.000Z')
FROM "books" b
WHERE COALESCE(b."cover_image", '') <> ''
ON CONFLICT ("book_id", "file") DO NOTHING;
--> statement-breakpoint

-- Count before, count after, and refuse to be a migration that lost a
-- photograph.
--
-- "Before" is the distinct `(book, file)` pairs the four photograph columns
-- name, which is what "one row per photograph" means: a book that somehow names
-- one file in two columns has one photograph, not two, and `UNION` says so. The
-- crops are counted the same way against `crop_file`.
--
-- A crop whose photograph column is empty is a file no capture row can reach,
-- and it fails here rather than being dropped quietly. It should not exist:
-- `cropPhotos` only ever writes a crop for a photograph it has just read.
DO $$
DECLARE
  photographs bigint;
  recorded bigint;
  crops bigint;
  crops_recorded bigint;
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

  SELECT count(*) INTO recorded FROM "capture";

  SELECT count(*) INTO crops FROM (
    SELECT "id" AS book_id, "front_crop" AS file FROM "books" WHERE COALESCE("front_crop", '') <> ''
    UNION
    SELECT "id", "back_crop" FROM "books" WHERE COALESCE("back_crop", '') <> ''
    UNION
    SELECT "id", "edge_crop" FROM "books" WHERE COALESCE("edge_crop", '') <> ''
  ) cut;

  SELECT count(*) INTO crops_recorded FROM "capture" WHERE "crop_file" <> '';

  RAISE NOTICE 'captures: % photographs named by books, % capture rows, % crops, % crop files recorded',
    photographs, recorded, crops, crops_recorded;

  IF recorded <> photographs THEN
    -- Named individually where there are few enough to read, because a count
    -- that disagrees and says nothing else sends somebody reading the whole
    -- catalogue.
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
      'the capture migration would have lost a photograph: books name % of them and % rows exist%',
      photographs, recorded,
      COALESCE('. Not recorded: ' || orphaned, '. Every named photograph has a row, so there are rows here that books does not name');
  END IF;

  IF crops_recorded <> crops THEN
    RAISE EXCEPTION
      'the capture migration would have lost a crop: books name % of them and % capture rows carry one',
      crops, crops_recorded;
  END IF;
END $$;
