-- The repair the cut-over owes: a book left carrying both range genres keeps
-- the one the shelf was actually built from.
--
-- ## What went wrong, and why it cannot happen again
--
-- Before #201, correcting a book's ISBN left the old book's genre tag in place
-- beside the new book's. A relookup arrives as a guess, and a guess may only
-- take back its own claims, so a `person` row about the book the row used to be
-- survived beside a `guess` row about the book it now is. The book therefore
-- carries `genre/fiction` and `genre/non-fiction` at once, and the row with the
-- higher authority is the wrong one.
--
-- #201 fixed the cause: correcting an ISBN now withdraws every tag about the
-- work first, whoever said it. Rows written before it are still here, and they
-- have been invisible because nothing reads tags. **#223 is what starts reading
-- them**, so this is where they stop being invisible and where they get fixed.
--
-- ## The rule, which is the owner's and not an implementer's
--
-- Settled on 2026-08-07 and recorded in docs/data-model.md, under "One repair
-- the cut-over owes":
--
--   * find books carrying more than one distinct slug under `genre`
--   * **keep the row that agrees with `books.is_fiction`**, because that is what
--     the shelf was actually built from, and not the row with the higher source
--   * count what it changed and say so
--
-- Keeping the higher source is the obvious answer and it is the wrong one. The
-- `person` row is about a different book. `books.is_fiction` is what
-- `Store.resolveKey` filed the book by, so it is what somebody physically put
-- the book on a shelf according to, and it is the only thing here that
-- corresponds to where the book is in the room.
--
-- **This runs while `is_fiction` is still authoritative, and that is the whole
-- reason it is here rather than later.** The commit after this one derives the
-- range from the tag instead; after that there is nothing left to be right and
-- the information needed to repair correctly is gone.
--
-- ## What it does not touch, and why the count is two counts
--
-- Only `genre/fiction` and `genre/non-fiction`, which are the two slugs a shelf
-- range is built from and the two #194 left together. `genre/fantasy` is a real
-- tag somebody may have applied and `is_fiction` can neither agree nor disagree
-- with it, so the rule has nothing to say about it and this deletes none. A
-- book carrying a third genre alongside the pair is reported separately rather
-- than quietly counted as repaired: it is a book somebody should look at, and
-- it is not this defect.
--
-- ## Nothing here writes to books
--
-- Not one statement touches `books`, `separators`, `area` or the cover
-- directory. The shelf order hash is taken either side and has to be the same
-- string, which says so rather than promising it.
--
-- ## Safe to run twice
--
-- The delete finds nothing the second time, because the books it selects are
-- the ones carrying both slugs and it leaves each of them carrying one. A
-- migration somebody is not sure finished should be safe to set going again.

DO $$
DECLARE
  before_hash text;
  after_hash text;
  books_repaired bigint;
  rows_deleted bigint;
  person_rows bigint;
  other_genres bigint;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  /*
   * One statement, and the counts come out of what it actually deleted rather
   * than out of a second query asking the same question a moment earlier.
   *
   * `carrying_both` is every book with both range slugs on it, together with
   * the one that agrees with its column; `is_fiction` is an integer for the
   * reason `db.pg.ts` gives. `removed` hands back each row it deleted with the
   * source that wrote it, so the number of a person's answers this rewrote is
   * counted from the rows themselves.
   */
  WITH carrying_both AS (
    SELECT b."id" AS book_id,
           CASE WHEN b."is_fiction" = 1 THEN 'genre/fiction' ELSE 'genre/non-fiction' END
             AS keeping
      FROM "books" b
     WHERE EXISTS (SELECT 1 FROM "book_tag" bt JOIN "tag" t ON t."id" = bt."tag_id"
                    WHERE bt."book_id" = b."id" AND t."slug" = 'genre/fiction')
       AND EXISTS (SELECT 1 FROM "book_tag" bt JOIN "tag" t ON t."id" = bt."tag_id"
                    WHERE bt."book_id" = b."id" AND t."slug" = 'genre/non-fiction')
  ),
  removed AS (
    DELETE FROM "book_tag" bt
     USING "tag" t, carrying_both c
     WHERE t."id" = bt."tag_id"
       AND c."book_id" = bt."book_id"
       AND t."slug" IN ('genre/fiction', 'genre/non-fiction')
       AND t."slug" <> c."keeping"
    RETURNING bt."source"
  )
  SELECT (SELECT count(*) FROM carrying_both),
         (SELECT count(*) FROM removed),
         (SELECT count(*) FROM removed WHERE "source" = 'person')
    INTO books_repaired, rows_deleted, person_rows;

  -- A book left carrying two genres for a reason that is not this defect: the
  -- pair is gone and something else under `genre` is still there beside it.
  -- Counted and left alone, the way 0013 counted these before there was a
  -- repair to hand them to.
  SELECT count(*) INTO other_genres FROM (
    SELECT bt."book_id"
      FROM "book_tag" bt
      JOIN "tag" t ON t."id" = bt."tag_id"
     WHERE t."slug" LIKE 'genre/%'
     GROUP BY bt."book_id"
    HAVING count(DISTINCT t."slug") > 1
  ) AS carrying_two;

  IF books_repaired = 0 THEN
    RAISE NOTICE 'one genre per book: no book carried both genre/fiction and genre/non-fiction';
  ELSE
    RAISE NOTICE 'one genre per book: % books carried both range genres, % rows removed, '
      '% of them a person''s. The kept row is the one agreeing with books.is_fiction, '
      'which is what the shelf was built from. See "One repair the cut-over owes" '
      'in docs/data-model.md',
      books_repaired, rows_deleted, person_rows;
  END IF;

  IF other_genres <> 0 THEN
    RAISE NOTICE 'ambiguous genre: % books still carry more than one genre tag, and none of '
      'them is the fiction/non-fiction pair this repairs. Nothing was removed from them',
      other_genres;
  END IF;

  -- Every book must still be exactly where it was. This only deletes tag rows,
  -- and until the commit after it nothing derives a shelf range from a tag, so
  -- the two hashes differing would mean a statement here reached the catalogue.
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the genre repair moved a book: shelved_books hashed % before and % after. '
      'Nothing here writes to books, so the two differing means a statement '
      'reached the catalogue',
      COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
