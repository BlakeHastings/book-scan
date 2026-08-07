-- Every book already in the catalogue is told which state it is in.
--
-- `0007` added the column with `DEFAULT 'scanned'`, which is true of no row that
-- already exists: a row in `books` got there by somebody confirming what the
-- book was and filing it. So every row has to be stated here, and a row left
-- reading `scanned` is a row this migration failed to decide about rather than a
-- row that is genuinely at the beginning of its life.
--
-- ## The mapping, taken from the data rather than assumed
--
--   checked_out_at IS NOT NULL  ->  'checked_out'
--   checked_out_at IS NULL      ->  'shelved'
--
-- That is not a guess about what the rows mean; it is the predicate the shelf
-- has always been drawn with. `Store.neighbours` and `Shelves.booksIn` selected
-- `checked_out_at IS NULL` and `Shelves.review` and `Store.checkedOut` selected
-- its complement, so these two states name exactly the two sets the app already
-- treated as different, and no row can be in both or in neither.
--
-- **`identified` is not used here, and that is the point of the state existing.**
-- Knowing what a book is and knowing where it went are separate facts. Nothing
-- in this schema records a book that was confirmed and not yet placed, because
-- until now such a book was a row in the queue table instead. Those rows are not
-- touched by this migration; the queue is dissolved separately. Inventing an
-- `identified` book here would be inventing a fact the catalogue does not hold.
--
-- ## Nothing is dropped
--
-- `checked_out_at` is exactly as it was afterwards and stays the column the
-- client reads and the one `Store.setCheckedOut` compares and sets. The state is
-- written beside it, in the same statement, so the two cannot drift. This is the
-- shape #179, #180 and #192 used: copy, keep, and cut over separately.
--
-- ## Idempotent, and it proves the shelf did not move
--
-- Both updates are conditional on the row still reading `scanned`, so a second
-- run states nothing and cannot overwrite a state somebody has since set.
--
-- The block at the end does two things, and the second one is the reason this
-- migration is safe to point at somebody's real catalogue. It counts the rows in
-- each state and refuses when any row was left undecided. Then it takes the
-- shelf order hash **the backup tool takes**, `md5(string_agg(id::text, ',' order
-- by sort_key, id))`, over the books the shelf was drawn from before and over
-- `shelved_books` after, and refuses when they differ. That is the whole claim of
-- this change reduced to two strings: the same books, in the same order, read
-- through a view instead of a `WHERE` clause. A statement that dropped a
-- predicate, a view whose collation did not come through, or a mapping that put
-- one book on the wrong side all move that hash, and every one of them would
-- otherwise be silent until somebody was stood at a shelf.

UPDATE "books" SET "state" = 'checked_out'
 WHERE "checked_out_at" IS NOT NULL AND "state" = 'scanned';
--> statement-breakpoint

UPDATE "books" SET "state" = 'shelved'
 WHERE "checked_out_at" IS NULL AND "state" = 'scanned';
--> statement-breakpoint

DO $$
DECLARE
  total bigint;
  shelved bigint;
  checked_out bigint;
  undecided bigint;
  before_hash text;
  after_hash text;
BEGIN
  SELECT count(*) INTO total FROM "books";
  SELECT count(*) INTO shelved FROM "books" WHERE "state" = 'shelved';
  SELECT count(*) INTO checked_out FROM "books" WHERE "state" = 'checked_out';
  SELECT count(*) INTO undecided FROM "books" WHERE "state" NOT IN ('shelved', 'checked_out');

  RAISE NOTICE 'book states: % books, % shelved, % checked out, % undecided',
    total, shelved, checked_out, undecided;

  IF undecided <> 0 THEN
    RAISE EXCEPTION
      'the state migration would have left % of % books with no state. A book '
      'with no state is a book no shelf query can see', undecided, total;
  END IF;

  -- The shelf as it was, and the shelf as the view reports it. Ordered by
  -- sort_key then id, which is what the backup tool compares and what stage H
  -- compared the two databases with: a count does not move when an ordering
  -- does, and an ordering that moved has not lost a book, it has misfiled one.
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "books" WHERE "checked_out_at" IS NULL;
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the state migration moved a book: the shelf hashed % before and the '
      'shelved_books view hashes % after. Same books in the same order was the '
      'entire claim', COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
