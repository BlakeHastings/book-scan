-- The repair the authors' half of the cut-over owes: an alias files under what
-- the shelf was actually built from.
--
-- ## What drifted, and why nothing noticed
--
-- #180 filled `author_alias.filing_name` from `books.author_filing`, which is
-- the value this app had already computed for that name with any override
-- applied, and which is the first component of every `sort_key` the shelf is
-- ordered by. That was right on the day it ran and nothing has kept the two in
-- step since:
--
--   * `Store.saveFilingOverride` writes the `author_filing` **table**, and
--     `Store.filingFor` reads it, so an override saved after #180 reaches
--     `books.author_filing` on the next save and never reaches the alias.
--   * `AuthorRepository.introduce` deliberately never rewrites an existing
--     alias's filing name, because re-saving a book must not undo somebody's
--     correction. So the save that carried the override wrote the column and
--     left the alias exactly as it was.
--
-- Nothing has read the alias, so the drift has been invisible, exactly as the
-- two genre rows on a corrected book were until #223 started reading tags. **The
-- commit after this one starts ordering by `author_alias.filing_name`**, so this
-- is where it stops being invisible and where it gets fixed.
--
-- ## The rule, and it is `0016`'s rule with the nouns changed
--
-- **Keep what `books.author_filing` says**, because that is the first component
-- of the `sort_key` the book is physically shelved by, and it is the only value
-- here that corresponds to where the book is in the room. The alias's own value
-- is a copy of an older answer to the same question.
--
-- **This runs while `books.author_filing` is still authoritative**, which is the
-- whole reason it is here rather than two commits later. After the column is
-- dropped there is nothing left to be right.
--
-- ## What it will not do
--
-- **It invents no filing name.** An alias whose books all carry an empty
-- `books.author_filing` keeps the printed name #180 gave it. There are such
-- aliases and they are #195: `Store.filingFor` returned '' rather than running
-- the heuristic for a name written in a script with no `A-Z` in it, so those
-- books were stored filing under nobody. #222 fixed the function and did not
-- rewrite the rows, and the answer to those rows is `server/refile-books.ts` or
-- somebody filing the name by hand, not a second copy of `filingName()` written
-- in SQL. That is #180's reasoning and it has not changed.
--
-- So those aliases are **counted and named**, and the books they file are the
-- books the cut-over's comparison reports as moving. See
-- `infrastructure/db/cutover.test.ts`.
--
-- ## Nothing here writes to books
--
-- Not one statement touches `books`, `separators`, `area` or the cover
-- directory. The shelf order hash is taken either side and has to be the same
-- string, which says so rather than promising it.
--
-- ## Safe to run twice
--
-- The update selects the aliases whose filing name differs from the column's
-- answer and leaves each of them agreeing with it, so a second run finds none.

DO $$
DECLARE
  before_hash text;
  after_hash text;
  aliases_repaired bigint;
  filing_as_printed bigint;
  books_filing_as_printed bigint;
  named text;
BEGIN
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO before_hash
    FROM "shelved_books";

  /*
   * What the shelf was built from, per alias.
   *
   * Only the credit that files a book counts: `books.sort_key` is built from
   * the first-listed author and from nothing else, so a name credited second
   * has never had a filing name computed for it on that book. The lowest
   * position is asked for rather than assumed to be 1, which is the same
   * caution `0004` took over the same join.
   *
   * The tiebreak is `0004`'s, for the same reason: two books can disagree when
   * an override was saved between saving them, so the spelling the most books
   * were filed by wins and byte order settles a level count. That makes two
   * runs of this on the same rows agree.
   */
  WITH files_the_book AS (
    SELECT ba."author_alias_id" AS alias_id,
           coalesce(b."author_filing", '') AS shelved_as
      FROM "book_author" ba
      JOIN "books" b ON b."id" = ba."book_id"
     WHERE ba."position" = (SELECT min(inner_ba."position") FROM "book_author" inner_ba
                             WHERE inner_ba."book_id" = ba."book_id")
  ),
  computed AS (
    SELECT DISTINCT ON (alias_id) alias_id, shelved_as
      FROM (
        SELECT alias_id, shelved_as, count(*) AS uses
          FROM files_the_book
         WHERE shelved_as <> ''
         GROUP BY alias_id, shelved_as
      ) spellings
     ORDER BY alias_id, uses DESC, shelved_as
  ),
  repaired AS (
    UPDATE "author_alias" a
       SET "filing_name" = c.shelved_as
      FROM computed c
     WHERE c.alias_id = a."id"
       AND a."filing_name" <> c.shelved_as
    RETURNING a."id"
  )
  SELECT count(*) INTO aliases_repaired FROM repaired;

  /*
   * The aliases this could not answer for, and the books they file.
   *
   * An alias with no computed filing name anywhere is one of two things: a name
   * that has never been first-listed, so nobody has ever asked, or a name #195
   * folded away. Either way it files as printed until somebody files it, and
   * the books it files are the ones whose sort key changes the first time they
   * are saved after the cut-over.
   */
  SELECT count(*) INTO filing_as_printed
    FROM "author_alias" a
   WHERE NOT EXISTS (
     SELECT 1 FROM "book_author" ba JOIN "books" b ON b."id" = ba."book_id"
      WHERE ba."author_alias_id" = a."id"
        AND coalesce(b."author_filing", '') <> ''
        AND ba."position" = (SELECT min(inner_ba."position") FROM "book_author" inner_ba
                              WHERE inner_ba."book_id" = ba."book_id"));

  SELECT count(*), string_agg(DISTINCT display_name, '; ' ORDER BY display_name)
    INTO books_filing_as_printed, named
    FROM (
      SELECT b."id", a."display_name"
        FROM "books" b
        JOIN "book_author" ba ON ba."book_id" = b."id"
        JOIN "author_alias" a ON a."id" = ba."author_alias_id"
       WHERE coalesce(b."author_filing", '') = ''
         AND ba."position" = (SELECT min(inner_ba."position") FROM "book_author" inner_ba
                               WHERE inner_ba."book_id" = b."id")
    ) AS unfiled;

  IF aliases_repaired = 0 THEN
    RAISE NOTICE 'alias filing names: every alias already files under what the shelf was built from';
  ELSE
    RAISE NOTICE 'alias filing names: % aliases now file under books.author_filing, which is '
      'the first component of the sort key their books are shelved by. An override saved '
      'after #180 reached the column and not the alias; see 0020',
      aliases_repaired;
  END IF;

  IF filing_as_printed <> 0 THEN
    RAISE NOTICE 'filing as printed: % aliases have no computed filing name on any book they '
      'file, so they keep the printed name #180 gave them, and % books file under it. '
      'None is invented here: that would be a second copy of filingName() written in SQL. '
      'These are the books the cut-over comparison names as moving. %',
      filing_as_printed, books_filing_as_printed, coalesce(named, 'no names');
  END IF;

  -- Every book must still be exactly where it was. This writes only to
  -- `author_alias`, and until the commit after it nothing derives a sort key
  -- from that table, so the two hashes differing would mean a statement here
  -- reached the catalogue.
  SELECT md5(string_agg("id"::text, ',' ORDER BY "sort_key", "id")) INTO after_hash
    FROM "shelved_books";

  IF before_hash IS DISTINCT FROM after_hash THEN
    RAISE EXCEPTION
      'the filing name repair moved a book: shelved_books hashed % before and % after. '
      'Nothing here writes to books, so the two differing means a statement '
      'reached the catalogue',
      COALESCE(before_hash, 'nothing'), COALESCE(after_hash, 'nothing');
  END IF;

  RAISE NOTICE 'shelf order unchanged: % on both sides', COALESCE(before_hash, 'an empty shelf');
END $$;
