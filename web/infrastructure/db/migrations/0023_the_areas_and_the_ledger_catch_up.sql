-- The repair the placement cut-over owes, and it owes two.
--
-- Both are the shape `0016` and `0020` already are: something drifted behind the
-- column it shadows, nothing read it, so nothing noticed. This runs while the
-- columns still say something, because afterwards there is nothing left to
-- repair from. `0024` onwards is where they go, one apiece.
--
-- ## One: the areas a range's separators name
--
-- `0013` built `area` from `separators` once and nothing kept the two in step
-- until #213 put a write-through on the four statements that write a boundary. A
-- range that has had no boundary written in it since is still carrying whatever
-- `0013` left, so a divider added in between has no area, and no location on the
-- plank it opened could be recorded as a placement.
--
-- `recordAreasOf` is that repair and is idempotent, which is why the drift closes
-- itself the next time anybody moves a divider in a range. This is the same walk
-- run once over every range, so it closes without waiting for anybody, and after
-- it the areas are the boundaries rather than a copy of them.
--
-- ## Two: the placements a location names
--
-- `0015` wrote a `placed` row for every book whose recorded location named an
-- area **as the areas stood then**. A book put on a plank whose area was missing
-- got none and kept whatever placement it had. Those are exactly the books the
-- first half has just given somewhere to point, so this re-derives them: for
-- every catalogued book whose location names an area the projection does not
-- agree with, a `placed` row saying so.
--
-- ## What it refuses
--
-- A recorded location naming a plank the furniture does not have. `0015` counted
-- those and left them, because `books.location` was still authoritative and the
-- record was safe in the column. It is about to stop being safe anywhere, so
-- this refuses rather than dropping it, names the books, and says what to do:
-- record where each of them actually is, then run again.
--
-- Not one statement here writes `books.sort_key` or `books.shelf_range`, so no
-- book moves, and the shelf order hash either side says so.

CREATE TEMP TABLE "placement_wanted" (
  "book_id" bigint PRIMARY KEY,
  "area_id" bigint NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

DO $$
DECLARE
  before_hash text;
  after_hash text;
  range_row record;
  separator_row record;
  area_row record;
  the_collection bigint;
  the_fixture bigint;
  fixture_position int;
  area_position int;
  limit_position int;
  wanted int[];
  areas_written bigint := 0;
  areas_retired bigint := 0;
  fixtures_made bigint := 0;
  book_row record;
  loc text;
  parsed text[];
  section text;
  the_area bigint;
  at_char int;
  placed_rows bigint := 0;
  unplaceable bigint := 0;
  unplaceable_names text[] := ARRAY[]::text[];
  disagreeing bigint;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  SELECT "id" INTO the_collection FROM "collection" ORDER BY "id" LIMIT 1;
  IF the_collection IS NULL THEN
    RAISE NOTICE 'no collection: 0013 has not run here, so there is nothing to repair';
    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- The areas a range's separators name
  -- ------------------------------------------------------------------

  FOR range_row IN
    SELECT "shelf_range", "start_shelf", "start_area",
           lead("start_shelf") OVER (ORDER BY "start_shelf", "start_area", "shelf_range")
             AS next_start
      FROM "shelf_ranges"
     ORDER BY "start_shelf", "start_area", "shelf_range"
  LOOP
    fixture_position := range_row."start_shelf";
    area_position := range_row."start_area";
    limit_position := range_row.next_start;
    wanted := ARRAY[]::int[];

    -- The run's first area opens at nothing, which is how "from the beginning"
    -- is said without a null, and then one area per boundary. The boundaries are
    -- stepped over in anchor order, which is the sort `layoutRange` makes, with
    -- `position` breaking a tie: two boundaries on one anchor is what a boundary
    -- move that empties an area leaves behind, and stepping over them in the
    -- wrong order draws a plank's worth of books on the plank before.
    FOR separator_row IN
      SELECT NULL::text AS kind, ''::text AS starts_at, -1 AS position
      UNION ALL
      SELECT "kind", "starts_at", "position" FROM "separators"
       WHERE "shelf_range" = range_row."shelf_range"
      ORDER BY starts_at, position
    LOOP
      IF separator_row.kind IS NOT NULL THEN
        IF separator_row.kind = 'shelf' THEN
          fixture_position := fixture_position + 1;
          area_position := 0;
        ELSE
          area_position := area_position + 1;
        END IF;
      END IF;

      -- A range's run stops where the next range's begins. The areas past that
      -- bound are not written, exactly as `recordAreasOf` does not write them:
      -- such a catalogue is already drawing two planks with one label, and the
      -- comparison names every book affected rather than this inventing an
      -- arrangement nobody has.
      CONTINUE WHEN limit_position IS NOT NULL AND fixture_position >= limit_position;

      -- The fixture that was there first at this position, which is the run this
      -- range's own furniture is in.
      SELECT "id" INTO the_fixture FROM "fixture"
       WHERE "position" = fixture_position ORDER BY "id" LIMIT 1;
      IF the_fixture IS NULL THEN
        INSERT INTO "fixture" ("collection_id", "kind", "name", "position", "sort_strategy", "note")
        VALUES (the_collection, 'bookshelf', '', fixture_position, 'inherit', '')
        RETURNING "id" INTO the_fixture;
        fixtures_made := fixtures_made + 1;
      END IF;

      SELECT "id" INTO the_area FROM "area"
       WHERE "fixture_id" = the_fixture AND "position" = area_position;
      IF the_area IS NULL THEN
        INSERT INTO "area" ("fixture_id", "position", "name", "starts_at", "sort_strategy", "note")
        VALUES (the_fixture, area_position, '', separator_row.starts_at, 'inherit', '');
        areas_written := areas_written + 1;
      ELSE
        UPDATE "area" SET "starts_at" = separator_row.starts_at
         WHERE "id" = the_area AND "starts_at" IS DISTINCT FROM separator_row.starts_at;
        IF FOUND THEN areas_written := areas_written + 1; END IF;
      END IF;

      wanted := wanted || (fixture_position * 100000 + area_position);
    END LOOP;

    -- Anything on this range's bookcases the boundaries no longer name. It is
    -- deleted when nothing names it and retired otherwise: `book_placement` is
    -- the record of where books have been and pins the furniture it names, so a
    -- plank a book once sat on keeps its row and comes off the fixture's face
    -- instead. A negative position is outside every read of the furniture, which
    -- is what stops a boundary nobody asked for coming back out of the areas.
    FOR area_row IN
      SELECT a."id", f."position" * 100000 + a."position" AS at
        FROM "area" a JOIN "fixture" f ON f."id" = a."fixture_id"
       WHERE a."position" >= 0
         AND f."position" >= range_row."start_shelf"
         AND (limit_position IS NULL OR f."position" < limit_position)
    LOOP
      CONTINUE WHEN area_row.at = ANY (wanted);
      DELETE FROM "area" WHERE "id" = area_row."id"
        AND NOT EXISTS (SELECT 1 FROM "book_placement" p WHERE p."area_id" = "area"."id")
        AND NOT EXISTS (SELECT 1 FROM "books" b WHERE b."current_area_id" = "area"."id")
        AND NOT EXISTS (SELECT 1 FROM "placement_rule" r WHERE r."area_id" = "area"."id");
      IF NOT FOUND THEN
        UPDATE "area" SET "position" =
          (SELECT least(min(other."position"), 0) - 1 FROM "area" other
            WHERE other."fixture_id" = "area"."fixture_id")
         WHERE "id" = area_row."id";
      END IF;
      areas_retired := areas_retired + 1;
    END LOOP;
  END LOOP;

  -- ------------------------------------------------------------------
  -- The placements a location names
  -- ------------------------------------------------------------------

  FOR book_row IN
    SELECT "id", "title", "location", "sort_key", "shelved_at", "scanned_at", "current_area_id"
      FROM "catalogued_books" ORDER BY "id"
  LOOP
    loc := btrim(COALESCE(book_row."location", ''));
    CONTINUE WHEN loc = '';

    -- `parseLocation` and `areaIndex`, spelled in SQL exactly as `0015` spells
    -- them, so `s4 b`, `S4B` and `4B` are the one plank they are everywhere else.
    parsed := regexp_match(loc, '^\s*[Ss]?([0-9]+)\s*([A-Za-z]*)\s*$');
    the_area := NULL;
    IF parsed IS NOT NULL AND parsed[2] <> '' THEN
      section := upper(parsed[2]);
      area_position := 0;
      FOR at_char IN 1..length(section) LOOP
        area_position := area_position * 26 + (ascii(substr(section, at_char, 1)) - 64);
      END LOOP;
      area_position := area_position - 1;

      -- Unnamed fixtures and areas only, because naming either changes the
      -- label: a book recorded at `1A` is on the first plank of the first
      -- bookcase, and a bookcase somebody has called "Hall shelf" no longer
      -- answers to `1`. The same restriction `areaForLabel` makes.
      SELECT a."id" INTO the_area
        FROM "area" a JOIN "fixture" f ON f."id" = a."fixture_id"
       WHERE f."position" = parsed[1]::int AND a."position" = area_position
         AND f."name" = '' AND a."name" = ''
       ORDER BY f."id", a."id" LIMIT 1;
    END IF;

    IF the_area IS NULL THEN
      unplaceable := unplaceable + 1;
      IF array_length(unplaceable_names, 1) IS NULL
         OR array_length(unplaceable_names, 1) < 8 THEN
        unplaceable_names := unplaceable_names || (book_row."title" || ' at ' || loc);
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO "placement_wanted" ("book_id", "area_id")
    VALUES (book_row."id", the_area);

    CONTINUE WHEN book_row."current_area_id" IS NOT DISTINCT FROM the_area;

    INSERT INTO "book_placement"
      ("book_id", "kind", "area_id", "sort_key", "rule_id", "actor", "reason", "created_at")
    VALUES (book_row."id", 'placed', the_area, book_row."sort_key", NULL, 'migration',
            'books.location said ' || loc,
            COALESCE(book_row."shelved_at", book_row."scanned_at"));
    placed_rows := placed_rows + 1;
  END LOOP;

  -- The projection, folded out of the ledger rather than written from the column
  -- the rows were written from. The same statement `0015` and `rebuildProjection`
  -- use, so there is one definition of the fold in SQL.
  WITH latest AS (
    SELECT DISTINCT ON ("book_id") "book_id", "kind", "area_id"
      FROM "book_placement" WHERE "kind" <> 'assigned'
     ORDER BY "book_id", "id" DESC
  )
  UPDATE "books" b
     SET "current_area_id" = CASE WHEN latest."kind" IN ('placed', 'pinned')
                                  THEN latest."area_id" ELSE NULL END
    FROM latest
   WHERE latest."book_id" = b."id"
     AND b."current_area_id" IS DISTINCT FROM
         (CASE WHEN latest."kind" IN ('placed', 'pinned') THEN latest."area_id" END);

  IF unplaceable <> 0 THEN
    RAISE EXCEPTION
      'the placement cut-over would lose where % books are: their recorded '
      'location names a plank the furniture does not have, including %. '
      'books.location is about to be dropped and the ledger has nowhere to put '
      'a label like that, so record where each of those books actually is and '
      'run this again',
      unplaceable, array_to_string(unplaceable_names, '; ');
  END IF;

  -- Every book whose location names a plank is projected onto that plank. This
  -- is the claim the drop rests on, asked of the rows rather than of the column
  -- both were written from, and it is `projectionDisagreements` narrowed to the
  -- books this migration is about.
  SELECT count(*) INTO disagreeing
    FROM "placement_wanted" w JOIN "books" b ON b."id" = w."book_id"
   WHERE b."current_area_id" IS DISTINCT FROM w."area_id";

  IF disagreeing <> 0 THEN
    RAISE EXCEPTION
      'the placement projection disagrees with books.location for % books '
      'immediately after being written from it, so the ledger does not say what '
      'the column says and dropping the column would lose the difference',
      disagreeing;
  END IF;

  RAISE NOTICE 'the areas catch up: % anchors written, % areas taken out of a run, '
    '% bookcases made. The ledger catches up: % placed rows, over % books whose '
    'location names a plank',
    areas_written, areas_retired, fixtures_made, placed_rows,
    (SELECT count(*) FROM "placement_wanted");

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the placement repair moved a book: shelved_books hashed % before and % '
      'after. Nothing here writes sort_key or shelf_range, so the two differing '
      'means a statement reached the catalogue',
      COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
