-- Where every book is stops being three columns and becomes a ledger with a
-- projection over it.
--
-- ## What is being said in rows that used to be said in the present tense
--
-- `books.location` is a label somebody typed, `books.shelved_at` is when they
-- typed it, and `books.checked_out_at` is whether the book is in the house.
-- Between them they can say where a book is and nothing about where it has
-- been. After this every one of those facts is a row in `book_placement`, the
-- rows behind it are the history, and `books.current_area_id` is the latest
-- answer kept where a shelf can be drawn from it in one query.
--
--   books.location            ->  a `placed` row against the area that label
--                                 names, with the label parsed the way
--                                 `parseLocation` parses it
--   books.shelved_at          ->  that row's created_at
--   books.checked_out_at      ->  a `checked_out` row after it
--   state = 'withdrawn'       ->  a `withdrawn` row after it
--   (the fold of all of them) ->  books.current_area_id
--
-- ## Nothing is cut over, for the sixth step running
--
-- `books.location`, `books.shelved_at` and `books.checked_out_at` keep every
-- value and stay authoritative. `Store.setLocation`, `Store.setCheckedOut` and
-- the two save paths still write them, the client still reads them, and
-- `reviewShelving` still computes the misfile list from `location` against a
-- derived label. Nothing anywhere reads `book_placement` or `current_area_id`.
--
-- That is what makes the claim checkable rather than promised, exactly as in
-- #184: both models are live over one catalogue, so every book can be replayed
-- out of the ledger and compared with the column it came from, book by book.
-- `infrastructure/db/placement-ledger.test.ts` is where that comparison is made,
-- and three of its tests break the model on purpose and watch it fail.
--
-- ## No `assigned` row is written here, and that is the design rather than an
-- omission
--
-- `assigned` is what the rules want. The rules are `domain/placement/rules.ts`,
-- they are TypeScript, and `0013` already settled that a migration does not
-- reimplement them in SQL: a second implementation in a language the first is
-- not written in is two things to keep in step. An `assigned` row is written
-- when the engine runs, by `AssignPlacementsHandler`, and only where its answer
-- differs from where the book already is.
--
-- A backfill that wrote one per book would be the exact failure that design
-- forbids: a row per book saying nothing changed, with the rows that mean
-- something lost among them.
--
-- ## A recorded location the furniture does not have is counted, not refused
--
-- `PATCH /api/books/:id/location` accepts any label `parseLocation` accepts, so
-- `9Z` is a location a person may record and there is no area row for it. Those
-- books get no `placed` row, they are counted, and up to five of them are named.
--
-- Refusing would refuse a catalogue the app already handles: a book recorded on
-- a plank the layout does not draw is a misfile, which `reviewShelving` reports
-- and nothing corrects, because the recorded location is where the book really
-- is and a guess written into it is worse than nothing. This migration is not
-- the place that decides those, and inventing an area to hold them would invent
-- furniture nobody has.
--
-- What is refused is the arithmetic not adding up: every book whose location
-- does resolve gets exactly one `placed` row, the projection agrees with the
-- ledger for every book in the catalogue, and the shelf order hash is the same
-- string either side.
--
-- ## Safe to run twice
--
-- A `RETURN` at the top when there are already rows in `book_placement`. Drizzle
-- runs a migration once per database; this is the same belt to those braces that
-- `0011` and `0013` carry, so a migration somebody is not sure finished is safe
-- to set going again.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the cover
-- directory. It writes to `books` in exactly one column, `current_area_id`,
-- which no shelf query has ever read, and the shelf order hash is taken either
-- side and has to be the same string, which says so rather than promising it.

DO $$
DECLARE
  before_hash text;
  after_hash text;
  book_row record;
  loc text;
  parsed text[];
  fixture_position int;
  section text;
  area_position int;
  the_area bigint;
  placed_at text;
  placed_rows bigint := 0;
  checked_out_rows bigint := 0;
  withdrawn_rows bigint := 0;
  resolvable bigint := 0;
  unplaceable bigint := 0;
  unplaceable_names text[] := ARRAY[]::text[];
  never_placed bigint := 0;
  catalogued bigint;
  projected bigint;
  disagreeing bigint;
  at_char int;
BEGIN
  IF EXISTS (SELECT 1 FROM "book_placement") THEN
    RAISE NOTICE 'the placement ledger already has rows: nothing to do';
    RETURN;
  END IF;

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  -- Every book that is part of the collection, oldest first, so the ledger's
  -- ids run in the same order the catalogue's do. `catalogued_books` is the
  -- relation for exactly this question: shelved, checked out and withdrawn. A
  -- book still in the queue has never been anywhere and gets no rows, and a
  -- discarded scan was never a book.
  FOR book_row IN
    SELECT "id", "title", "state", "location", "sort_key", "shelved_at",
           "scanned_at", "checked_out_at"
      FROM "catalogued_books" ORDER BY "id"
  LOOP
    the_area := NULL;
    loc := btrim(COALESCE(book_row."location", ''));

    IF loc = '' THEN
      -- Never confirmed onto a shelf. One of the three cases `reviewShelving`
      -- excludes rather than reports, and there is nothing to record.
      never_placed := never_placed + 1;
    ELSE
      -- `parseLocation`, spelled in SQL: an optional S, the bookcase, and the
      -- plank's letters. The same expression, so `s4 b`, `S4B` and `4B` are one
      -- plank here as they are there.
      parsed := regexp_match(loc, '^\s*[Ss]?([0-9]+)\s*([A-Za-z]*)\s*$');
      IF parsed IS NULL THEN
        section := '';
      ELSE
        fixture_position := parsed[1]::int;
        section := upper(parsed[2]);
      END IF;

      IF parsed IS NOT NULL AND section <> '' THEN
        -- The letters are bijective base 26, which is what `areaLabel` writes:
        -- A is the first plank, Z the twenty-sixth, AA the twenty-seventh.
        area_position := 0;
        FOR at_char IN 1..length(section) LOOP
          area_position := area_position * 26 + (ascii(substr(section, at_char, 1)) - 64);
        END LOOP;
        area_position := area_position - 1;

        SELECT a."id" INTO the_area
          FROM "area" a JOIN "fixture" f ON f."id" = a."fixture_id"
         WHERE f."position" = fixture_position AND a."position" = area_position
         ORDER BY f."id", a."id" LIMIT 1;
      END IF;

      IF the_area IS NULL THEN
        unplaceable := unplaceable + 1;
        IF array_length(unplaceable_names, 1) IS NULL
           OR array_length(unplaceable_names, 1) < 5 THEN
          unplaceable_names := unplaceable_names || (book_row."title" || ' at ' || loc);
        END IF;
      ELSE
        resolvable := resolvable + 1;
      END IF;
    END IF;

    -- `shelved_at` is when somebody said where the book was, which is what this
    -- row records. A book placed before that column existed falls back to when
    -- it was scanned, which is the earliest moment it could have been anywhere.
    placed_at := COALESCE(book_row."shelved_at", book_row."scanned_at");

    IF the_area IS NOT NULL THEN
      INSERT INTO "book_placement"
        ("book_id", "kind", "area_id", "sort_key", "rule_id", "actor", "reason", "created_at")
      VALUES (book_row."id", 'placed', the_area, book_row."sort_key", NULL, 'migration',
              'books.location said ' || loc, placed_at);
      placed_rows := placed_rows + 1;
    END IF;

    -- After the placement, so the fold takes the book back off the shelf rather
    -- than the other way round. A checked out book holds no area on purpose:
    -- when it comes back it is placed again.
    IF book_row."state" = 'checked_out' THEN
      INSERT INTO "book_placement"
        ("book_id", "kind", "area_id", "sort_key", "rule_id", "actor", "reason", "created_at")
      VALUES (book_row."id", 'checked_out', NULL, book_row."sort_key", NULL, 'migration',
              'books.checked_out_at was set', COALESCE(book_row."checked_out_at", placed_at));
      checked_out_rows := checked_out_rows + 1;
    END IF;

    -- There is no `withdrawn_at` column to carry over, so this row is dated from
    -- the last moment anything is known about the book. Terminal and archival:
    -- the row stays and the book is nowhere.
    IF book_row."state" = 'withdrawn' THEN
      INSERT INTO "book_placement"
        ("book_id", "kind", "area_id", "sort_key", "rule_id", "actor", "reason", "created_at")
      VALUES (book_row."id", 'withdrawn', NULL, book_row."sort_key", NULL, 'migration',
              'books.state was withdrawn', placed_at);
      withdrawn_rows := withdrawn_rows + 1;
    END IF;
  END LOOP;

  -- The projection, built from the ledger rather than from the columns the
  -- ledger was built from. That is the point: it is the fold in
  -- `domain/placement/ledger.ts` said in SQL, so rebuilding it is this statement
  -- and nothing else, and a projection that has rotted is repaired by running
  -- it again.
  --
  -- The latest row that is not `assigned`, because `assigned` is where the rules
  -- want a book and never where it is. `placed` and `pinned` put it somewhere;
  -- the other three take it out of every area there is.
  WITH latest AS (
    SELECT DISTINCT ON ("book_id") "book_id", "kind", "area_id"
      FROM "book_placement" WHERE "kind" <> 'assigned'
     ORDER BY "book_id", "id" DESC
  )
  UPDATE "books" b
     SET "current_area_id" = CASE WHEN latest."kind" IN ('placed', 'pinned')
                                  THEN latest."area_id" ELSE NULL END
    FROM latest
   WHERE latest."book_id" = b."id";
  GET DIAGNOSTICS projected = ROW_COUNT;

  -- Every book whose recorded location names a plank the furniture has got
  -- exactly one `placed` row. A count that does not add up means the walk
  -- dropped a book, and a dropped book is one the ledger says has never been
  -- anywhere while it is sitting on a shelf.
  IF placed_rows <> resolvable THEN
    RAISE EXCEPTION
      'the placement ledger wrote % placed rows for % books whose recorded '
      'location names an area, and those do not add up: every such book gets '
      'exactly one', placed_rows, resolvable;
  END IF;

  SELECT count(*) INTO catalogued FROM "catalogued_books";

  -- The guard `0013` did not have until it was found to have quietly built
  -- nothing on every database anybody actually creates.
  --
  -- Not one recorded location naming a plank the furniture has is a broken
  -- parse, not a catalogue of misfiles: a person mistypes a location now and
  -- then, and all of them at once means this migration cannot read the labels it
  -- is reading. It would add up perfectly, write an empty ledger and say nothing
  -- except a NOTICE nobody is watching.
  IF resolvable = 0 AND unplaceable > 0 THEN
    RAISE EXCEPTION
      'the placement ledger could not place a single book: % recorded locations '
      'and not one of them names an area, including %. That is this migration '
      'failing to read a label rather than a catalogue full of misfiles',
      unplaceable, array_to_string(unplaceable_names, '; ');
  END IF;

  -- The claim the projection has to meet, made against the rows rather than
  -- against the columns both were written from. This is the same comparison
  -- `projectionDisagreements` makes on every start, asked once here so a
  -- migration that wrote a projection nobody could reproduce refuses instead of
  -- leaving it to be discovered.
  SELECT count(*) INTO disagreeing
    FROM "books" b
    LEFT JOIN LATERAL (
      SELECT p."kind", p."area_id" FROM "book_placement" p
       WHERE p."book_id" = b."id" AND p."kind" <> 'assigned'
       ORDER BY p."id" DESC LIMIT 1
    ) latest ON true
   WHERE b."current_area_id" IS DISTINCT FROM
         (CASE WHEN latest."kind" IN ('placed', 'pinned') THEN latest."area_id" END);
  IF disagreeing <> 0 THEN
    RAISE EXCEPTION
      'the placement projection disagrees with the ledger for % of % books '
      'immediately after being written from it, so one of the two statements '
      'that fold this ledger is wrong', disagreeing, catalogued;
  END IF;

  RAISE NOTICE 'where every book is becomes rows: % placed, % checked out, % withdrawn, '
    '% books projected, % never placed',
    placed_rows, checked_out_rows, withdrawn_rows, projected, never_placed;

  IF unplaceable <> 0 THEN
    RAISE NOTICE 'recorded on a plank the furniture does not have: % books, including %. '
      'They carry no placed row. A location is where a person says the book is, and '
      'this migration does not correct one',
      unplaceable, array_to_string(unplaceable_names, '; ');
  END IF;

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the placement ledger moved a book: shelved_books hashed % before and % '
      'after. The only column written to books here is current_area_id, which '
      'nothing orders by, so the two differing means a statement reached the '
      'catalogue', COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
