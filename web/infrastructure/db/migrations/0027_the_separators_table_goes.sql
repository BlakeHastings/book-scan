-- `separators` goes, and `area` is what it became.
--
-- An area is a separator grown a parent: `area.starts_at` is
-- `separators.starts_at` under a name that says what it anchors, carrying the
-- same `COLLATE "C"` for the same reason, and what the row lost is `kind` and
-- `position`, both of which are derived from where the area sits. A `shelf`
-- boundary is one whose area hangs on a different fixture from the area before
-- it, and a boundary's ordinal is its place in the run.
--
-- **This is the first table this repository has ever dropped.** Twelve columns
-- have gone across #227, #228 and this change, and no table had, which is why the
-- `captures` queue is still sitting there with its rows and nothing reading it.
-- A table is not a bigger column: dropping one takes its indexes, its identity
-- sequence and every row anybody put in it, and there is no ledger of boundaries
-- to fall back on the way `book_placement` catches `books.location`. What makes
-- it safe is that every one of these rows is an `area` row, checked below both
-- ways, and that `0023` made them agree while this table still said something.
--
-- Nothing has read it since #232: `DrizzleSeparatorRepository` presents the same
-- port over the areas, `boundariesFrom` in `infrastructure/shelving/areas.ts` is
-- the inverse of the walk `0013` and `layoutRange` both make, and `Shelves` never
-- learned a new word.
--
-- **What proves it is safe is `infrastructure/db/cutover.test.ts`**, which places
-- every shelved book twice, by these rows and by the areas, and compares the two
-- answers one book at a time over a catalogue the size and shape of the live one.
--
-- The guard is that claim asked of the rows this database has: every boundary
-- here is an anchored area, and every anchored area is a boundary here. Both
-- directions, because a missing area draws a plank's worth of books on the plank
-- before and a surplus one draws a boundary nobody asked for.
--
-- `CASCADE` is what Drizzle generates, and there is nothing hanging off this
-- table for it to take: no other table references it, and the retraction
-- receipt's separator ids are deliberately not a foreign key.

DO $$
DECLARE
  boundaries bigint;
  areas bigint;
BEGIN
  SELECT count(*) INTO boundaries FROM "separators";

  -- Every area that is not the first of its run, which is what a boundary is:
  -- the first opens at nothing. A negative position is an area taken out of a run
  -- and kept only because a placement names it, so it is not one either.
  SELECT count(*) INTO areas FROM "area" a
   WHERE a."position" >= 0 AND a."starts_at" <> '';

  IF boundaries <> areas THEN
    RAISE EXCEPTION
      'the separators and the areas do not describe the same shelves: % boundaries '
      'and % anchored areas. Dropping this table with the two out of step moves '
      'books, so run 0023 again and read what it says',
      boundaries, areas;
  END IF;

  RAISE NOTICE 'separators goes: % boundaries, % anchored areas, and they are the '
    'same shelves', boundaries, areas;
END $$;--> statement-breakpoint
DROP TABLE "separators" CASCADE;
