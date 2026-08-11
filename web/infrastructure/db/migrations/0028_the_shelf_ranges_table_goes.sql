-- `shelf_ranges` goes, and it was configuration wearing a table's clothes.
--
-- Two rows, saying which bookcase each of the two runs begins on. That is a
-- `placement_rule` pointing at a fixture, which is how a run that spans bookcases
-- has been said since `0013` derived one from the other, and a rule can say more:
-- it names the books it claims, so a third run is a third rule rather than a
-- third row nothing matches against.
--
-- Nothing has read it since #232: `bandsOf` in
-- `infrastructure/shelving/areas.ts` asks the rules through `GENRE_RANGES`, which
-- is the one place a genre slug and a shelf range are the same fact, and
-- `Shelves.startOf` and `Store.rangeStart` read that. `applySchema` no longer
-- seeds anything on start, because a migration is what writes the rules.
--
-- The guard is that the two agree before one of them goes: each range's rule
-- points at a fixture standing where the column said the range began. It refuses
-- rather than dropping quietly, because a range that starts on the wrong bookcase
-- relabels every plank in it and sends somebody to the wrong piece of furniture.
--
-- `CASCADE` is what Drizzle generates, and there is nothing hanging off this
-- table.

DO $$
DECLARE
  out_of_step bigint;
BEGIN
  SELECT count(*) INTO out_of_step
    FROM "shelf_ranges" r
    LEFT JOIN LATERAL (
      SELECT f."position"
        FROM "placement_rule" pr
        JOIN "rule_condition" rc ON rc."rule_id" = pr."id"
        JOIN "fixture" f ON f."id" = pr."fixture_id"
       WHERE rc."field" = 'tag'
         AND rc."value" = CASE WHEN r."shelf_range" = 'fiction'
                               THEN 'genre/fiction' ELSE 'genre/non-fiction' END
       ORDER BY pr."priority", pr."id" LIMIT 1
    ) claimed ON true
   WHERE claimed."position" IS DISTINCT FROM r."start_shelf";

  IF out_of_step <> 0 THEN
    RAISE EXCEPTION
      'the shelf ranges and the placement rules disagree about where % of the runs '
      'begin, so dropping this table would move a whole range onto a different '
      'bookcase and relabel every plank in it', out_of_step;
  END IF;

  RAISE NOTICE 'shelf_ranges goes: every run begins on the bookcase its rule points at';
END $$;--> statement-breakpoint
DROP TABLE "shelf_ranges" CASCADE;
