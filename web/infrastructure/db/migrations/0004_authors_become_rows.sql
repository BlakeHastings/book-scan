-- The names on `book_authors` become authors, aliases and credits.
--
-- ## What this migration will not do
--
-- **It merges no pseudonyms, and that is the decision rather than a shortfall.**
-- Iain Banks and Iain M. Banks are one person and two aliases, and nothing in
-- this catalogue says so: the only evidence is two strings that differ by one
-- initial, which is also how two different people differ. Merging two authors
-- later is one UPDATE. Splitting one that swallowed two people is not
-- recoverable at all, because afterwards nobody can tell which books belonged to
-- whom. So every distinct printed name gets an author of its own, and joining
-- two of them is left to somebody who knows.
--
-- The one thing it does collapse is spelling. `J.R.R. Tolkien` and
-- `J. R. R. Tolkien` are the same name written twice, so they fold to one alias
-- on a key that ignores case, punctuation and runs of whitespace. That is not a
-- guess about identity: it is the key this app has always used for an author,
-- `normalise()` in shared/shelving.ts, which is how `author_filing.display_key`
-- has been computed since that table existed.
--
-- It differs from `normalise()` in one way, deliberately: it does not fold
-- accents, so `García` and `Garcia` stay two aliases. That is the conservative
-- direction, and it is the direction to be wrong in.
--
-- ## Where a filing name comes from
--
-- From `books.author_filing`, which is the filing name this app computed for
-- that name, with any override already applied, and which is the first component
-- of the `sort_key` the shelf is ordered by today. Taking it from the row means
-- an alias cannot disagree with where its books actually sit.
--
-- A name with no computed filing name keeps its printed name, and none is
-- invented here. The alternative is a second copy of `filingName()` written in
-- SQL, and the whole reason that heuristic is one function is that two of it
-- would drift. Which authors those are is recorded in `author.note`.
--
-- There are two ways to be one of those, and the second is a defect rather than
-- an absence. A name that has never been first-listed has never been asked
-- about. And **issue #195**: `Store.filingFor` returns '' rather than running
-- the heuristic when a name normalises to nothing, which every name written
-- entirely in a non-Latin script does, so those books carry an empty
-- `author_filing`. Taking that empty string would carry a defect into a new
-- table as data, where it is much harder to fix than in the one function that
-- causes it, so an empty stored filing name is treated as no answer rather than
-- as an answer. #180 does not fix #195; it declines to copy it.
--
-- ## What it leaves alone
--
-- Everything. `books.authors`, `books.author_filing`, `books.sort_key`,
-- `book_authors` and the `author_filing` table are all untouched, exactly as
-- #179 left `books.is_fiction` in place. Nothing reads the three new tables yet,
-- so no book can move, and cutting the shelving code over to them belongs with
-- the work that remodels `books`.
--
-- A book whose `books.authors` is set but which has no `book_authors` rows gets
-- no credit here. Splitting that string back apart is ambiguous, because a comma
-- separates two authors and also separates `Last, First`, which is the reason
-- `book_authors` was created. The string is still on the row; guessing at it
-- would put a fabricated name in the vocabulary permanently.
--
-- ## Running it twice
--
-- `NOT EXISTS (SELECT 1 FROM author)` in the first CTE. A second run selects no
-- rows, so it inserts nothing rather than duplicating everything, and it is one
-- statement, so a failure leaves no half-populated vocabulary behind.

WITH credited AS (
  SELECT
    ba.book_id,
    ba.position,
    btrim(ba.name) AS printed_name,
    b.author_filing,
    -- Which credit files the book. `Store.resolveKey` uses the first-listed
    -- author, and `Store.addBook` numbers from 1, but the lowest position is
    -- asked for rather than assumed so a gap cannot silently pick the wrong one.
    ba.position = min(ba.position) OVER (PARTITION BY ba.book_id) AS files_the_book,
    -- The alias key. Case, punctuation and whitespace folded, accents kept.
    -- `[:alnum:]` rather than `A-Za-z0-9` on purpose: the ASCII class would turn
    -- every accented letter into a separator and cut `García` into two words.
    upper(btrim(regexp_replace(btrim(ba.name), '[^[:alnum:]]+', ' ', 'g'))) AS alias_key
  FROM book_authors ba
  JOIN books b ON b.id = ba.book_id
  WHERE btrim(ba.name) <> ''
    -- A name with no letter or digit in it is not a name, and folding several of
    -- them together would make one alias out of unrelated punctuation.
    AND btrim(regexp_replace(btrim(ba.name), '[^[:alnum:]]+', ' ', 'g')) <> ''
    AND NOT EXISTS (SELECT 1 FROM author)
),

-- The printed spelling to keep: whichever the most books use, and the first in
-- byte order when they are level, so two runs of this on the same rows agree.
naming AS (
  SELECT DISTINCT ON (alias_key) alias_key, printed_name
  FROM (
    SELECT alias_key, printed_name, count(*) AS uses
      FROM credited GROUP BY alias_key, printed_name
  ) spellings
  ORDER BY alias_key, uses DESC, printed_name
),

-- The filing name the app already computed, from the books this name files.
-- Same tiebreak, for the same reason: two books can disagree when an override
-- was saved between saving them.
--
-- An empty stored filing name is no answer rather than an answer of ''. See the
-- note on issue #195 above: that is what a non-Latin name currently gets, and
-- copying it here would turn a defect in one function into rows.
filing AS (
  SELECT DISTINCT ON (alias_key) alias_key, author_filing
  FROM (
    SELECT alias_key, author_filing, count(*) AS uses
      FROM credited
     WHERE files_the_book AND coalesce(author_filing, '') <> ''
     GROUP BY alias_key, author_filing
  ) computed
  ORDER BY alias_key, uses DESC, author_filing
),

seed AS (
  SELECT
    -- Supplied rather than left to the identity sequence, which is why both
    -- columns are GENERATED BY DEFAULT: one number has to name the author and
    -- the alias at once, and there is no way to correlate two RETURNING sets.
    -- The sequences are moved past these ids by the statement below.
    row_number() OVER (ORDER BY n.alias_key) AS id,
    n.alias_key,
    n.printed_name,
    coalesce(f.author_filing, n.printed_name) AS filing_name,
    -- The whole of what `author_filing` held that is not already in
    -- `books.author_filing`. Its key is `normalise()`, which folds accents, so
    -- this join finds an override for an ASCII name and misses one for an
    -- accented name. Missing it costs nothing: the override's filing name has
    -- already reached the alias through `books.author_filing`, because
    -- `Store.filingFor` consulted it when the book was saved.
    coalesce(o.is_corporate, 0) AS is_corporate,
    CASE WHEN f.author_filing IS NULL
      THEN 'Backfilled by #180. No filing name had ever been computed for this '
           || 'name, so the printed name stands until somebody files it.'
      ELSE 'Backfilled by #180. Filing name taken from books.author_filing.'
    END || coalesce(' ' || nullif(o.note, ''), '') AS note
  FROM naming n
  LEFT JOIN filing f ON f.alias_key = n.alias_key
  LEFT JOIN author_filing o ON o.display_key = n.alias_key
),

-- Data-modifying CTEs run whether or not anything selects from them. The
-- foreign keys below are checked when the whole statement finishes, by which
-- point all three sets of rows exist, so one statement is enough and the
-- catalogue is never left holding half a vocabulary.
new_authors AS (
  INSERT INTO author (id, is_corporate, note)
  SELECT id, is_corporate, note FROM seed
),

new_aliases AS (
  INSERT INTO author_alias (id, author_id, display_name, filing_name, is_primary)
  -- One alias per author here, so the two numberings coincide. Nothing depends
  -- on that: a second alias for an existing author is an ordinary insert.
  SELECT id, id, printed_name, filing_name, 1 FROM seed
)

INSERT INTO book_author (book_id, position, author_alias_id)
SELECT c.book_id, c.position, s.id
  FROM credited c
  JOIN seed s ON s.alias_key = c.alias_key;
--> statement-breakpoint
-- Move the identity sequences past the ids just supplied, or the first author
-- somebody adds afterwards collides with one of these.
SELECT setval(
  pg_get_serial_sequence('author', 'id'),
  greatest(coalesce((SELECT max(id) FROM author), 0), 1),
  coalesce((SELECT max(id) FROM author), 0) > 0
);
--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('author_alias', 'id'),
  greatest(coalesce((SELECT max(id) FROM author_alias), 0), 1),
  coalesce((SELECT max(id) FROM author_alias), 0) > 0
);
