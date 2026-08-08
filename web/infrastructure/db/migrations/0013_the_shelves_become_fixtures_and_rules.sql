-- The shelf ranges and their separators become a collection, fixtures, areas
-- and two placement rules.
--
-- ## What is being said in rows that used to be said in code
--
-- Today there is one global order per range, carved into planks by walking a
-- list of separators, and which of the two ranges a book joins is decided by
-- `books.is_fiction`. Fiction and non-fiction are written into the code: there
-- are two of them, there will only ever be two of them, and a third question
-- about the same books has nowhere to go.
--
-- After this there is a `collection`, a `fixture` per bookcase, an `area` per
-- plank-run and a `placement_rule` per range, and the two ranges are two rows.
--
--   shelf_ranges.start_shelf, .start_area  ->  where a run's first fixture and
--                                              area are numbered from
--   separators kind 'shelf'                ->  a new fixture, area back to 0
--   separators kind 'area'                 ->  a new area in the same fixture
--   separators.starts_at                   ->  area.starts_at, same collation
--   books.is_fiction                       ->  two rules, on the genre tags
--                                              0002 wrote from that column
--
-- The vocabulary is confusing and it is the vocabulary being replaced: a
-- separator of kind 'shelf' means *a new bookcase starts here* and one of kind
-- 'area' means *a new plank starts here*. See docs/shelving.md.
--
-- ## Nothing is cut over, exactly as in #179, #180, #181 and #183
--
-- `shelf_ranges` and `separators` keep every row and stay authoritative:
-- `Shelves.layout`, `Store.resolveKey` and the misfile review all read them and
-- are untouched by this. `books.is_fiction` still decides which range a book
-- files into. Nothing in the app reads a fixture, an area or a rule yet.
--
-- That is what makes the central claim checkable rather than a promise. Both
-- models exist over the same catalogue at once, so every book can be placed
-- twice and the two answers compared, which is what
-- `infrastructure/db/placement-backfill.test.ts` does book by book. Cutting over
-- is a separate change and it is the one that gets to delete something.
--
-- ## The two rules, and the exactness they owe
--
-- `0002` turned `books.is_fiction` into `genre/fiction` and `genre/non-fiction`
-- with the provenance the column carried, and every save since has written the
-- tag beside the column. So the rules are written against those slugs, and the
-- claim they have to meet is not "approximately the same books": a book the
-- rules and the column disagree about would be a book that files into a
-- different bookcase under the new model, which is the whole failure this step
-- could have and the one nobody would see, because nothing reads these rows.
--
-- The guard below therefore refuses when a shelved book carries no `genre` tag
-- at all, because such a book is one no rule can claim and the rules would put
-- it nowhere. It counts, and does not refuse, the books carrying more than one
-- distinct `genre` slug: those are the rows #201 stopped happening and
-- docs/data-model.md hands to the cut-over to repair, and this is not the
-- cut-over. `priority` is what decides where such a book goes in the meantime,
-- and fiction is rule 1, so a doubly tagged book files as fiction.
--
-- ## Why the guard is counts and hashes rather than a second placement engine
--
-- It would be possible to replay the layout in SQL here and compare it with
-- itself. That is a second implementation of the thing being introduced, in a
-- language the first one is not written in, and the two would drift. The
-- placement rule lives once, in `domain/placement/`, and the comparison against
-- the layout the app actually uses is a test that runs both.
--
-- ## The ranges are seeded here, and that is not a duplicate by accident
--
-- `applySchema` seeds `shelf_ranges` **after** it runs the migrations, because
-- on an empty database the table does not exist until the baseline has created
-- it. So at the moment this migration runs on a database that was created
-- rather than adopted, `shelf_ranges` is empty, and a walk over no ranges builds
-- no fixtures, no areas and no rules, adds up correctly, and finishes quietly
-- with nothing. Every developer's database, every CI run and every end to end
-- run is created rather than adopted, so that is the common case and not the
-- edge.
--
-- Found by starting the app and looking at the rows rather than at the tests,
-- which all passed: the fixture in `placement-backfill.test.ts` seeds the ranges
-- before migrating, the way an adopted catalogue already has them.
--
-- So the seed is stated here too, as a migration states any other fact it needs
-- true at the moment it runs, together with the two repairs `applySchema` makes
-- to a seed written before ranges had a starting bookcase. Those have to happen
-- **before** the walk rather than after it: a `start_shelf` left at its default
-- would put non-fiction's fixtures on bookcase 1 among fiction's, which is the
-- interleaving the guard below refuses. All three statements are idempotent and
-- `applySchema` still runs its own afterwards, where they find nothing to do.
--
-- ## Safe to run twice
--
-- A `RETURN` at the top when this collection already has fixtures. Drizzle runs
-- a migration once per database, so this is the same belt-and-braces `0011` has
-- in `book_id IS NULL`: a migration that can be run twice can be re-run when
-- somebody is not sure whether it finished.
--
-- ## This migration moves rows and never files
--
-- Not one statement here reads, writes, renames or deletes anything in the cover
-- directory, and not one of them writes to `books`. The shelf order hash is
-- taken either side and has to be the same string, which says so rather than
-- promising it.

INSERT INTO "sort_strategy" ("code", "label", "is_inherit", "available", "note") VALUES
  ('inherit', 'Same as the shelf it is on', true, true,
   'A row, not a null. No absence in this schema means anything.'),
  ('author', 'Author', false, true,
   'Author filing name, then series, then title. This is books.sort_key, which every shelf here is ordered by today.'),
  ('title', 'Title', false, true, 'Title, then author.'),
  ('published', 'Year published', false, true, 'Published, then author, then title.'),
  ('tag', 'Tag', false, true, 'Tag slug, then author, then title. Never the collection default.')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "shelf_ranges" ("shelf_range", "start_label", "start_shelf", "start_area", "note") VALUES
  ('fiction', '1A', 1, 0, 'Starts on the first bookcase'),
  ('nonfiction', '4A', 4, 0, 'Bookcase 4 is dedicated to non-fiction')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "shelf_ranges" SET "start_shelf" = 4, "start_area" = 0, "start_label" = '4A'
 WHERE "shelf_range" = 'nonfiction' AND "start_label" = 'S4';
--> statement-breakpoint
UPDATE "shelf_ranges" SET "start_label" = '1A'
 WHERE "shelf_range" = 'fiction' AND "start_label" <> '1A';
--> statement-breakpoint
DO $$
DECLARE
  before_hash text;
  after_hash text;
  the_collection bigint;
  range_row record;
  separator_row record;
  the_fixture bigint;
  first_fixture bigint;
  fixture_position int;
  area_position int;
  the_rule bigint;
  rule_priority int := 0;
  genre_slug text;
  fixtures_made bigint := 0;
  areas_made bigint := 0;
  rules_made bigint := 0;
  separators_read bigint;
  untagged bigint;
  shelved bigint;
  doubly_tagged bigint;
  overlapping bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM "fixture") THEN
    RAISE NOTICE 'the shelves are already fixtures: nothing to do';
    RETURN;
  END IF;

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  INSERT INTO "collection" ("name", "default_sort_strategy", "note")
  VALUES ('', 'author',
          'The one collection. Its default is the order every shelf here is already in.')
  RETURNING "id" INTO the_collection;

  -- Ranges in the order they stand on the floor, which is the order their
  -- fixtures are numbered in and therefore the order the rules are tried in.
  FOR range_row IN
    SELECT * FROM "shelf_ranges" ORDER BY "start_shelf", "start_area", "shelf_range"
  LOOP
    -- The slug each range's rule is written against. Refused rather than
    -- guessed: a range this does not recognise would get a rule matching
    -- nothing, and every book in it would silently have nowhere to go.
    genre_slug := CASE range_row."shelf_range"
      WHEN 'fiction' THEN 'genre/fiction'
      WHEN 'nonfiction' THEN 'genre/non-fiction'
    END;
    IF genre_slug IS NULL THEN
      RAISE EXCEPTION
        'shelf range % has no tag to write a placement rule against. 0002 turned '
        'books.is_fiction into genre/fiction and genre/non-fiction, and a range '
        'that is neither needs somebody to say which tag means it', range_row."shelf_range";
    END IF;

    fixture_position := range_row."start_shelf";
    area_position := range_row."start_area";

    INSERT INTO "fixture" ("collection_id", "kind", "name", "position", "sort_strategy", "note")
    VALUES (the_collection, 'bookshelf', '', fixture_position, 'inherit',
            'Carried over from shelf_ranges.' || range_row."shelf_range")
    RETURNING "id" INTO the_fixture;
    fixtures_made := fixtures_made + 1;
    first_fixture := the_fixture;

    -- The area a run begins in, anchored at the empty string, which sorts below
    -- every sort key this catalogue can hold. That is how "from the beginning"
    -- is said without a null, and it is why the walk below never has to ask
    -- whether it has passed a boundary yet.
    INSERT INTO "area" ("fixture_id", "position", "name", "starts_at", "sort_strategy", "note")
    VALUES (the_fixture, area_position, '', '', 'inherit', '');
    areas_made := areas_made + 1;

    -- `starts_at` first and `position` second, which is the order
    -- `layoutRange` walks them in: it sorts the separators of a range by
    -- `startsAt` with a stable sort over a list already ordered by position, so
    -- two boundaries on one anchor keep their recorded order. Two on one anchor
    -- is not hypothetical; it is what a boundary move that empties an area
    -- leaves behind.
    FOR separator_row IN
      SELECT * FROM "separators" WHERE "shelf_range" = range_row."shelf_range"
       ORDER BY "starts_at", "position", "id"
    LOOP
      IF separator_row."kind" = 'shelf' THEN
        -- A whole bookcase ended, so the next area is the top of the next one.
        fixture_position := fixture_position + 1;
        area_position := 0;
        INSERT INTO "fixture" ("collection_id", "kind", "name", "position", "sort_strategy", "note")
        VALUES (the_collection, 'bookshelf', '', fixture_position, 'inherit', '')
        RETURNING "id" INTO the_fixture;
        fixtures_made := fixtures_made + 1;
      ELSE
        area_position := area_position + 1;
      END IF;

      INSERT INTO "area" ("fixture_id", "position", "name", "starts_at", "sort_strategy", "note")
      VALUES (the_fixture, area_position, '', separator_row."starts_at", 'inherit',
              COALESCE(separator_row."note", ''));
      areas_made := areas_made + 1;
    END LOOP;

    -- A fixture rule, not an area rule, and that is the point: it names where
    -- the run begins and the run flows on through every area after it until the
    -- next rule's entry point. A range spanning three bookcases is exactly that.
    rule_priority := rule_priority + 1;
    INSERT INTO "placement_rule" ("area_id", "fixture_id", "priority", "name", "enabled")
    VALUES (NULL, first_fixture, rule_priority,
            CASE range_row."shelf_range" WHEN 'fiction' THEN 'Fiction' ELSE 'Non-fiction' END,
            true)
    RETURNING "id" INTO the_rule;
    rules_made := rules_made + 1;

    INSERT INTO "rule_condition" ("rule_id", "field", "operator", "value")
    VALUES (the_rule, 'tag', 'is', genre_slug);
  END LOOP;

  -- The guard that would have caught the quiet completion described above. A
  -- run that walked no ranges leaves a collection with no furniture in it, adds
  -- up perfectly, and says nothing, and the only symptom is that the tables are
  -- empty on a database nobody thinks to look at.
  IF rules_made = 0 THEN
    RAISE EXCEPTION
      'the furniture migration found no shelf ranges to build from, so it would '
      'have left a collection with no fixtures, no areas and no rules in it. '
      'shelf_ranges is seeded at the top of this migration, so an empty one here '
      'means that statement did not run';
  END IF;

  SELECT count(*) INTO separators_read FROM "separators";

  -- Every separator became an area, and every range got one more for the area
  -- it begins in. A count that does not add up means the walk lost a boundary,
  -- and a lost boundary is a plank's worth of books drawn on the plank before.
  IF areas_made <> separators_read + rules_made THEN
    RAISE EXCEPTION
      'the furniture migration wrote % areas from % separators across % ranges, '
      'and those do not add up: every separator is an area and every range begins '
      'in one more', areas_made, separators_read, rules_made;
  END IF;

  -- Two runs whose fixture positions interleave. `start_shelf` is 4 for
  -- non-fiction, so fiction growing to a fourth bookcase would put a fiction
  -- fixture and a non-fiction fixture both at position 4 and a fiction fixture
  -- at 5 after it, and the sequence of areas would no longer be one run
  -- followed by the other. That catalogue is already drawing two planks with
  -- the label 4A, so this refuses rather than recording an arrangement nothing
  -- can read back.
  SELECT count(*) INTO overlapping
    FROM "fixture" a
    JOIN "fixture" b ON b."id" > a."id" AND b."position" < a."position";
  IF overlapping <> 0 THEN
    RAISE EXCEPTION
      'the furniture migration would have interleaved two runs: % fixtures are '
      'numbered before a fixture created earlier. Two ranges are sharing '
      'bookcase numbers, which means two planks already answer to one label. '
      'Move a range''s starting bookcase in shelf_ranges first', overlapping;
  END IF;

  -- A shelved book with no genre tag is a book no rule can claim, and the rules
  -- would put it nowhere at all. 0002 gave every book in the catalogue one from
  -- `is_fiction` and every save has written one since, so this is unreachable
  -- from the data and is here for the day something stops writing them.
  SELECT count(*) INTO untagged
    FROM "shelved_books" b
   WHERE NOT EXISTS (
     SELECT 1 FROM "book_tag" bt JOIN "tag" t ON t."id" = bt."tag_id"
      WHERE bt."book_id" = b."id" AND t."slug" LIKE 'genre/%');
  SELECT count(*) INTO shelved FROM "shelved_books";
  IF untagged <> 0 THEN
    RAISE EXCEPTION
      'the furniture migration would have left % of % shelved books with no rule '
      'to claim them: they carry no genre tag, and the two rules written here are '
      'written against genre/fiction and genre/non-fiction', untagged, shelved;
  END IF;

  -- Counted and said, not refused. These are the rows #201 stopped happening
  -- and that docs/data-model.md hands to the cut-over: correcting a book's ISBN
  -- used to leave the old book's genre tag beside the new one. Both rules claim
  -- such a book and `priority` decides, so it files as fiction.
  SELECT count(*) INTO doubly_tagged FROM (
    SELECT bt."book_id"
      FROM "book_tag" bt
      JOIN "tag" t ON t."id" = bt."tag_id"
      JOIN "shelved_books" b ON b."id" = bt."book_id"
     WHERE t."slug" LIKE 'genre/%'
     GROUP BY bt."book_id"
    HAVING count(DISTINCT t."slug") > 1
  ) AS carrying_two;

  RAISE NOTICE 'the shelves become fixtures: % fixtures, % areas and % rules from % separators',
    fixtures_made, areas_made, rules_made, separators_read;
  IF doubly_tagged <> 0 THEN
    RAISE NOTICE 'ambiguous genre: % shelved books carry more than one genre tag and file '
      'as fiction by rule priority. See "One repair the cut-over owes" in docs/data-model.md',
      doubly_tagged;
  END IF;

  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the furniture migration moved a book: shelved_books hashed % before and % '
      'after. Nothing here writes to books, so the two differing means a '
      'statement reached the catalogue',
      COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
