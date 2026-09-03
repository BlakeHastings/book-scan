-- A move receipt said where it went as an address. Now it says which plank.
--
-- `outstanding_move` held `4B`, and every reader parsed it back into an area
-- (#481). An address is a statement about **position**, and position is exactly
-- what a boundary move changes: `resequenceFace` renumbers a face when an area
-- comes off it, so the row that read `1C` reads `1B` afterwards, and two pieces
-- of furniture can stand on one number, which is what `AreaStanding` exists to
-- say. So the string a receipt carried named whichever plank answered to that
-- address on the day somebody read it, not the plank the move was about.
--
-- Nothing was wrong today, and the issue says why: the address written there is
-- always the canonical `4B` form, never `Hall shelf · B`, because the layout
-- arithmetic that writes it has never heard of a piece's name. That is the whole
-- of what made #356's family expensive, and it cannot happen here. What is being
-- closed is a set of facts that hold and that nothing enforces.
--
-- ## No foreign key, on purpose
--
-- The receipt has to be readable **after the plank it names is gone**, because
-- the move that wrote it is what retired the plank. Retirement leaves the row,
-- so a foreign key would survive that much. It would not survive
-- `removeAreaIfUnused`, which deletes an area outright when no placement, no
-- projection and no rule names it: a key here would be a fourth such reference,
-- and would either block a boundary removal somebody is making at a shelf, or
-- cascade and destroy the receipt, or null the ids and call that a record. The
-- separator ids inside `restore` are not a foreign key for the same reason, and
-- have not been since `0009`.
--
-- ## The backfill, and the one row it can leave null
--
-- Both labels are read back exactly the way `areaForRecordedLabel` reads them,
-- which is `parseLocation` and `areaIndex` spelled in SQL as `0015` and `0023`
-- already spell them, over a lookup that will answer a plank taken off the face:
-- a retired area's position is `-(plank + 1)` and a retired piece's is
-- `-(bookcase + 1)`, and a row on the face wins over one retired from the same
-- position.
--
-- **A label that names no plank at all is left null rather than refused.** That
-- is not a loss: it is the same answer `areaOfRecordedLocation` gave for the same
-- row a moment before this ran, so the misfile list withheld the undo then and
-- withholds it now, and `Shelves.retractMove` never read these columns and still
-- does not. Refusing would block a deployment over a row that is by nature
-- transient — a receipt is cleared the moment somebody says where the book is —
-- and deleting it would take away a retraction that still works. Nothing written
-- after this migration can be null: every receipt from here on is recorded with
-- the two planks the move was between.
--
-- No row's labels are rewritten. A receipt says what somebody read that day, and
-- rewriting it to make a comparison easier is the mistake this whole area exists
-- not to make. No row is deleted and nothing outside this table is touched.
ALTER TABLE "outstanding_move" ADD COLUMN "from_area_id" integer;--> statement-breakpoint
ALTER TABLE "outstanding_move" ADD COLUMN "to_area_id" integer;--> statement-breakpoint

WITH parsed AS (
  SELECT "book_id", 'from' AS side,
         regexp_match("from_label", '^\s*[Ss]?([0-9]+)\s*([A-Za-z]*)\s*$') AS parts
    FROM "outstanding_move"
  UNION ALL
  SELECT "book_id", 'to',
         regexp_match("to_label", '^\s*[Ss]?([0-9]+)\s*([A-Za-z]*)\s*$')
    FROM "outstanding_move"
),
addressed AS (
  -- `areaIndex`: base 26 over the letters, A being 1, then one off it, so `A`
  -- is the top plank. A label with no letters names no plank and drops out here,
  -- exactly as `areaIndex` answers -1 for one.
  SELECT "book_id", side,
         parts[1]::int AS fixture_position,
         (SELECT (sum((ascii(substr(upper(parts[2]), letter, 1)) - 64)
                      * power(26, length(parts[2]) - letter)) - 1)::int
            FROM generate_series(1, length(parts[2])) AS letter) AS area_position
    FROM parsed
   WHERE parts IS NOT NULL AND parts[2] <> ''
),
found AS (
  SELECT "book_id", side,
         (SELECT a."id" FROM "area" a JOIN "fixture" f ON f."id" = a."fixture_id"
           WHERE (f."position" = addressed.fixture_position
                  OR f."position" = -(addressed.fixture_position + 1))
             AND (a."position" = addressed.area_position
                  OR a."position" = -(addressed.area_position + 1))
           ORDER BY (f."position" >= 0) DESC, (a."position" >= 0) DESC, f."id", a."id"
           LIMIT 1) AS area_id
    FROM addressed
)
UPDATE "outstanding_move" m
   SET "from_area_id" =
         (SELECT area_id FROM found WHERE found."book_id" = m."book_id" AND side = 'from'),
       "to_area_id" =
         (SELECT area_id FROM found WHERE found."book_id" = m."book_id" AND side = 'to');
--> statement-breakpoint

DO $$
DECLARE
  resolved bigint;
  unresolved bigint;
  unresolved_labels text[];
BEGIN
  SELECT count(*) FILTER (WHERE "from_area_id" IS NOT NULL AND "to_area_id" IS NOT NULL),
         count(*) FILTER (WHERE "from_area_id" IS NULL OR "to_area_id" IS NULL)
    INTO resolved, unresolved
    FROM "outstanding_move";

  IF unresolved <> 0 THEN
    SELECT array_agg("from_label" || ' -> ' || "to_label")
      INTO unresolved_labels
      FROM (SELECT "from_label", "to_label" FROM "outstanding_move"
             WHERE "from_area_id" IS NULL OR "to_area_id" IS NULL
             ORDER BY "book_id" LIMIT 8) AS few;

    RAISE NOTICE
      'a move receipt names the plank: % receipts name planks this collection no '
      'longer has, including %. They keep their labels and their restore, so the '
      'retraction still works; what they lose is the undo button on the misfile '
      'list, which their address had already stopped earning',
      unresolved, array_to_string(unresolved_labels, '; ');
  END IF;

  RAISE NOTICE 'a move receipt names the plank: % receipts carry two planks, % carry fewer',
    resolved, unresolved;
END $$;
