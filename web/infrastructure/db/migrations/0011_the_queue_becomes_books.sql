-- Every row in the `captures` queue becomes a row in `books`.
--
-- A book exists from its first photograph. The queue was a second table holding
-- the same thing at an earlier point in its life, and the two were kept apart
-- for one reason: `books` drives shelf ordering and misfile detection, and a
-- half-identified row must never reach either. #204 replaced that separation
-- with something better, the `shelved_books` view and the partial index under
-- it, so the separation has stopped paying for itself and the second table can
-- go.
--
-- ## The mapping, and why each pairing is what it is
--
--   status 'pending'  ->  state 'scanned'       nothing has read the photographs
--   status 'failed'   ->  state 'unidentified'  read, and no catalogue has it
--   status 'ready'    ->  state 'identified'    confirmed, not yet placed
--   status 'done'     ->  the book it already became
--
-- `failed` becomes `unidentified` and the word is better than the one it
-- replaces: nothing failed. The photographs were read and no catalogue in the
-- world has the book, which is an ordinary thing for a 1974 paperback and is
-- not an error anybody should go and fix.
--
-- **`identified` gets its first rows here**, which is the honest limit #204
-- wrote down. Until now a book that was confirmed and not yet placed was a row
-- in the queue, so the state existed with nothing in it.
--
-- A `done` capture is a book already, by `book_id`, and this migration creates
-- nothing for it: a second row would be a second book. The one exception is a
-- `done` capture whose `book_id` is null, which means the book it became was
-- later deleted (`captures_book_id_fkey` is ON DELETE SET NULL). That scan
-- happened and its record should not be a dangling row, so it comes across as
-- `discarded` and is counted separately below.
--
-- ## The queue's three image columns, finally answered
--
-- `0006` migrated the eight image columns on `books` into `capture` rows and
-- deliberately left the queue's three where they were. Its reasoning is at the
-- top of that file and it is worth repeating here because this is where it
-- resolves: `captures.book_id` was nullable, because a capture waiting to be
-- confirmed was not a book yet, while `capture.book_id` is NOT NULL on purpose.
-- A queue row with no book had photographs and nowhere to hang them.
--
-- Once the queue row *is* a book row that objection dissolves with the table.
-- Every photograph a migrated queue row names becomes a `capture` row against
-- the book it just became, with the same `front` / `back` / `spine` vocabulary
-- and the same `examined` reading of `cropped` that `0006` used.
--
-- A `done` capture's photographs are already `capture` rows: `POST /api/books`
-- handed the filenames straight to the book, `0006` read them off the book, and
-- a crop is named after the photograph it came from, so the book's crop and the
-- capture's crop are one file. Nothing is inserted for those, and the unique
-- key on ("book_id", "file") would refuse a duplicate anyway.
--
-- ## What a migrated queue row does not get
--
-- No `title`, no `shelf_range`, no `sort_key`, no `author_filing`. Those are
-- empty strings and that is the point: a book nobody has identified has no
-- title and belongs nowhere yet, and inventing any of them would be inventing a
-- fact the catalogue does not hold. It is also a second protection underneath
-- the state, and an independent one: a row with no shelf range is not in any
-- range, so even a query that forgot the state entirely could not file it
-- between two real books.
--
-- A title somebody typed into the queue stays in `edit_json`, where it is
-- today. It is not copied into `books.title`, because `books.title` is a title
-- a person stated about a book they have confirmed, and the whole reason the
-- overlay exists is that these two are different facts (#65, #156). It moves
-- when the book is shelved, which is when somebody says it is right.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the
-- cover directory. The same sentence as `0006` and it is true for the same
-- reason: the photographs are over a gigabyte, they are half of what is
-- irreplaceable about this catalogue, and they are outside this repository.
--
-- ## Nothing is dropped and nothing is deleted
--
-- The `captures` table and every row in it are exactly as they were afterwards,
-- with `book_id` filled in to say which book each row became. That column is
-- what makes this safe to run twice: a row that already has one is skipped.
--
-- ## It counts, and it refuses rather than finishing quietly
--
-- The block at the end reports how many rows became which state, refuses if a
-- single queue row was left without a book, and takes the shelf order hash
-- either side of itself. The hash is the sharp one. This migration only ever
-- inserts rows that are not `shelved`, so `shelved_books` must be byte for byte
-- what it was; a statement that wrote the wrong state, or a state name that did
-- not match the view's predicate, would put a book with no title on somebody's
-- shelf, and would otherwise be silent until they were stood in front of it.

DO $$
DECLARE
  queue_row record;
  new_book bigint;
  before_hash text;
  after_hash text;
  made bigint := 0;
  photographs bigint := 0;
  scanned bigint;
  unidentified bigint;
  identified bigint;
  discarded bigint;
  already bigint;
  orphaned bigint;
  recorded bigint;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  FOR queue_row IN
    SELECT * FROM "captures" WHERE "book_id" IS NULL ORDER BY "id"
  LOOP
    INSERT INTO "books" (
      "isbn13", "isbn10", "isbn_source",
      "title", "shelf_range", "is_fiction", "sort_key",
      "front_image", "back_image", "edge_image",
      "front_crop", "back_crop", "edge_crop", "cropped", "front_hash",
      "scanned_at", "state",
      "title_guess", "cover_text", "analysed", "draft_json",
      "edit_json", "edited_by", "edited_at",
      "scan_note", "claimed_by", "claimed_at", "processed_at"
    ) VALUES (
      COALESCE(queue_row."isbn13", ''),
      COALESCE(queue_row."isbn10", ''),
      COALESCE(queue_row."isbn_source", ''),
      -- Empty on purpose. See "What a migrated queue row does not get" above.
      '', '', 0, '',
      COALESCE(queue_row."front_image", ''),
      COALESCE(queue_row."back_image", ''),
      COALESCE(queue_row."edge_image", ''),
      COALESCE(queue_row."front_crop", ''),
      COALESCE(queue_row."back_crop", ''),
      COALESCE(queue_row."edge_crop", ''),
      COALESCE(queue_row."cropped", ''),
      COALESCE(queue_row."front_hash", ''),
      queue_row."created_at",
      CASE queue_row."status"
        WHEN 'pending' THEN 'scanned'
        WHEN 'failed'  THEN 'unidentified'
        WHEN 'ready'   THEN 'identified'
        -- 'done' with no book_id: the book it became was deleted.
        ELSE 'discarded'
      END,
      COALESCE(queue_row."title_guess", ''),
      COALESCE(queue_row."cover_text", ''),
      COALESCE(queue_row."analysed", ''),
      COALESCE(queue_row."draft_json", ''),
      COALESCE(queue_row."edit_json", ''),
      COALESCE(queue_row."edited_by", ''),
      queue_row."edited_at",
      COALESCE(queue_row."note", ''),
      COALESCE(queue_row."claimed_by", ''),
      queue_row."claimed_at",
      queue_row."processed_at"
    )
    RETURNING "id" INTO new_book;

    -- The link, and the whole of what makes a second run a no-op.
    UPDATE "captures" SET "book_id" = new_book WHERE "id" = queue_row."id";
    made := made + 1;

    -- The photographs. `edge` becomes `spine` here for the reason `0006` gives:
    -- docs/data-model.md settles the vocabulary as front, back, spine and
    -- catalogue, and `edge` is a column name from the schema being replaced.
    INSERT INTO "capture" ("book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at")
    SELECT new_book, kind, file, crop_file, examined, hash, queue_row."created_at"
      FROM (
        VALUES
          ('front', COALESCE(queue_row."front_image", ''), COALESCE(queue_row."front_crop", ''),
           (',' || COALESCE(queue_row."cropped", '') || ',') LIKE '%,front,%',
           COALESCE(queue_row."front_hash", '')),
          ('back', COALESCE(queue_row."back_image", ''), COALESCE(queue_row."back_crop", ''),
           (',' || COALESCE(queue_row."cropped", '') || ',') LIKE '%,back,%',
           -- No hash column exists for the back photograph, here or on books.
           -- Nothing is lost: there was never one to carry.
           ''),
          ('spine', COALESCE(queue_row."edge_image", ''), COALESCE(queue_row."edge_crop", ''),
           (',' || COALESCE(queue_row."cropped", '') || ',') LIKE '%,edge,%',
           '')
      ) AS photo(kind, file, crop_file, examined, hash)
     WHERE file <> ''
    ON CONFLICT ("book_id", "file") DO NOTHING;

    GET DIAGNOSTICS recorded = ROW_COUNT;
    photographs := photographs + recorded;
  END LOOP;

  SELECT count(*) INTO orphaned FROM "captures" WHERE "book_id" IS NULL;
  SELECT count(*) INTO already FROM "captures" WHERE "status" = 'done';
  SELECT count(*) INTO scanned FROM "books" WHERE "state" = 'scanned';
  SELECT count(*) INTO unidentified FROM "books" WHERE "state" = 'unidentified';
  SELECT count(*) INTO identified FROM "books" WHERE "state" = 'identified';
  SELECT count(*) INTO discarded FROM "books" WHERE "state" = 'discarded';

  RAISE NOTICE 'the queue becomes books: % queue rows became books (% already were), % photographs recorded',
    made, already, photographs;
  RAISE NOTICE 'queue states: % scanned, % unidentified, % identified, % discarded',
    scanned, unidentified, identified, discarded;

  IF orphaned <> 0 THEN
    RAISE EXCEPTION
      'the queue migration would have left % queue rows with no book. A scan '
      'with no book is a scan nothing can find, which is what dissolving the '
      'queue table was supposed to stop being possible', orphaned;
  END IF;

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the queue migration put a book on a shelf: shelved_books hashed % before '
      'and % after. This migration inserts nothing that is shelved, so the two '
      'being different means a queue row reached somebody''s shelf',
      COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
