-- The current photograph of each kind, which is `Photographs.latest` said in SQL.
--
-- A book has as many photographs of a kind as somebody has taken, and every
-- question a shelf asks is about the newest one: "the spine" is what you look
-- for a book by, and a spine re-shot today is somebody deciding yesterday's was
-- not good enough. The domain answers that with `Photographs.latest`, over rows
-- already loaded. Two statements cannot load the rows first, because what they
-- want is the books whose current photograph is missing something:
-- `Store.missingHashes` and `CaptureQueue.waiting`.
--
-- The tie-break is the domain's, and it has to be. Two photographs of one book
-- can share a timestamp: every row `0006` wrote carries `books.scanned_at`,
-- which was one value for all three slots. `Photographs.of` sorts newest first
-- with a stable sort over rows read by id, so a tie resolves to the lower id,
-- which is `taken_at desc, id asc` here.
--
-- Nothing writes through this, and nothing is dropped by it.

CREATE VIEW "public"."current_photograph" AS (select distinct on ("book_id", "kind") "book_id", "kind", "file", "crop_file", "examined", "hash", "taken_at" from "capture" order by "book_id", "kind", "taken_at" desc, "id" asc);