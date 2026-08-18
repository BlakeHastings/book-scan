/**
 * Reading, and resetting, the database the app under test is writing to.
 *
 * This is the point of the suite. A book that renders on screen but was
 * persisted with the wrong filing name, or not persisted at all, is exactly
 * the bug a screen-only assertion misses, so every journey ends by opening the
 * database and looking.
 *
 * **Postgres since stage G, and the shape of that change is worth stating.**
 * The connection is not guessed and not rebuilt here: it is read out of the api
 * resource's own environment by global-setup, so this opens the database the
 * AppHost gave the app rather than one reconstructed and hoped to match. That
 * is the same argument the old version made for asking `/api/health` for a file
 * path, and it is a better answer than teaching a health endpoint to hand out a
 * password.
 *
 * Every method is asynchronous now, because `pg` is. That is the only change to
 * the step files: not one assertion moved, and if one had to, the migration
 * changed behaviour and that is the finding rather than something to
 * accommodate.
 *
 * Safe to open alongside the running server, which is the whole reason a real
 * database was worth moving to: these are separate connections, and the app
 * goes on serving while a scenario reads.
 */

import pg from 'pg'

export interface BookRow {
  id: number
  isbn13: string
  isbn10: string
  title: string
  subtitle: string
  authors: string
  publisher: string
  published: string
  pages: string
  shelf_range: string
  author_filing: string
  sort_key: string
  front_image: string
  back_image: string
  edge_image: string
  cover_image: string
  isbn_source: string
  lookup_source: string
  /**
   * Which of the seven states the book is in. `checked_out` is a book in
   * somebody's bag and `shelved` is one on the bookcase, which is the pair
   * `books.checked_out_at` used to answer before #232 dropped it.
   */
  state: string
  /**
   * The area the book was last placed in, or null for one nobody has placed.
   *
   * This is where `books.location` went. The column held a label and this holds
   * a row; `areas()` below is what turns one back into the other.
   */
  current_area_id: number | null
}

/**
 * A book photographed but not yet filed.
 *
 * Not a table any more since #183: the queue was dissolved into `books`, so a
 * row here is a book in one of the three early states, read back through the
 * projection below. The field names are unchanged because the app's wire
 * vocabulary is unchanged, and a suite that had to be rewritten alongside a
 * table move would stop being independent evidence that the move kept its
 * promises.
 */
export interface CaptureRow {
  id: number
  status: string
  isbn13: string
  isbn10: string
  isbn_source: string
  title_guess: string
  /** What the background worker read off the photographs. */
  draft_json: string
  /** What a person stated while it sat in the queue. */
  edit_json: string
  edited_by: string
  edited_at: string | null
  note: string
  claimed_by: string
  book_id: number | null
  /**
   * Hash of the front photograph, written by the background pass after the
   * reading. Empty until then, and empty for good on a frame the hash refused
   * as featureless. It is what lets a book held up be recognised as one
   * already waiting to be shelved.
   */
  front_hash: string
}

/**
 * A queued book in the shape the queue has always handed one over.
 *
 * A mirror of `QUEUE_ROW` in web/server/queue.ts, copied rather than imported
 * for the same reason `connectionConfig` below is a copy: this package is a
 * separate npm tree, and reaching into the app to save a dozen lines would give
 * the suite a build dependency on the thing it is testing.
 *
 * Four names are aliased back because #183 renamed the columns underneath them.
 * `status` is derived from `state`, so the four words the steps know survive the
 * seven states arriving. `note` is `scan_note`, because `books.notes` is already
 * a person's note about a book. `created_at` is `scanned_at`, the same moment
 * under the name `books` has always used. And the capture that became a book is
 * the book, so `book_id` is the row's own id once it has left the queue.
 */
const QUEUE_ROW = `
  id,
  CASE "state"
    WHEN 'scanned' THEN 'pending'
    WHEN 'identified' THEN 'ready'
    WHEN 'unidentified' THEN 'failed'
    ELSE 'done'
  END AS status,
  isbn13, isbn10, isbn_source, title_guess, cover_text, analysed,
  draft_json, edit_json, edited_by, edited_at,
  scan_note AS note, claimed_by, claimed_at,
  CASE WHEN "state" IN ('scanned', 'unidentified', 'identified') THEN NULL ELSE id END AS book_id,
  scanned_at AS created_at, processed_at`

/**
 * The photographs, joined on rather than selected, because they are rows in
 * `capture` and not columns on `books` (#228).
 *
 * `current_photograph` is the app's own relation for "the newest photograph of
 * each kind", which is the question every screen asks. Reading it here rather
 * than reproducing the tie-break is deliberate: this suite asserts on what
 * reaches the database, and a second copy of the rule would let both copies be
 * wrong together.
 */
const PHOTOGRAPHS = `
  COALESCE(front.file, '')     AS front_image,
  COALESCE(back.file, '')      AS back_image,
  COALESCE(spine.file, '')     AS edge_image,
  COALESCE(artwork.file, '')   AS cover_image,
  COALESCE(front.hash, '')     AS front_hash`

/** The four joins `PHOTOGRAPHS` reads, against a relation aliased `b`. */
const PHOTOGRAPH_JOINS = `
  LEFT JOIN current_photograph front   ON front.book_id = b.id   AND front.kind = 'front'
  LEFT JOIN current_photograph back    ON back.book_id = b.id    AND back.kind = 'back'
  LEFT JOIN current_photograph spine   ON spine.book_id = b.id   AND spine.kind = 'spine'
  LEFT JOIN current_photograph artwork ON artwork.book_id = b.id AND artwork.kind = 'catalogue'`

/**
 * Where one run of books ends and the next begins, which is an `area` row since
 * #232: a boundary is not a record of a divider any more, it is the plank the
 * books after it stand on.
 *
 * `kind` is therefore derived rather than stored. The furniture says whether a
 * boundary starts a fresh bookcase by putting its area on a fresh fixture, and
 * that is the same distinction the feature files have always written as 'shelf'
 * and 'area'.
 */
export interface BoundaryRow {
  id: number
  /** 'shelf' when a new bookcase starts here, 'area' when a new plank does. */
  kind: 'shelf' | 'area'
  starts_at: string
}

/**
 * One plank, with the bookcase it hangs on, which is everything a label needs.
 *
 * Here because `books.location` is gone and `books.current_area_id` is what
 * replaced it (#232). A step that wants to say which plank a book is recorded on
 * has to join the two rows back together, and there is no other way to reach
 * them from the suite. The label itself is built in `catalogue.steps.ts`, where
 * the wire's vocabulary belongs; this hands back rows, which is what the rest of
 * this file does.
 */
export interface PlankRow {
  id: number
  /** The bookcase's ordinal, which is the `1` in `1A`. */
  fixture_position: number
  /** The plank's ordinal within it, 0-based, which is the `A` in `1A`. */
  position: number
  fixture_name: string
  name: string
}

/** One area on its fixture, in the order somebody walking the run meets them. */
interface AreaRow {
  id: number
  fixture_position: number
  position: number
  starts_at: string
}

/**
 * The furniture back to what migration `0013` leaves on a fresh database, so
 * what a scenario added to the two runs is put back.
 *
 * The furniture is not truncated and cannot be: the fixtures, the areas and the
 * two rules that file into them are seeded by that migration, and a scenario
 * expects to find the two runs standing, exactly as the app does. Each run
 * begins in one area at position 0 on the fixture its rule points at, anchored
 * at the empty string; everything else on the floor was put there by a
 * scenario, including a retired area, which is one at a negative position kept
 * only because a `book_placement` named it. The truncate cascades to
 * `book_placement`, so by the time these run nothing names an area at all.
 *
 * **A name is put back too**, because a name is not decoration: every label on a
 * piece is derived from it, so a scenario that calls bookcase 1 "Hall shelf"
 * leaves every scenario after it reading `Hall shelf · A` where it seeded `1A`.
 *
 * **And so is the number.** Deleting what no rule points at is not enough for a
 * scenario that moved a run: the piece it left behind goes and the piece it
 * arrived on stays, standing wherever it was sent. Non-fiction would then begin
 * on bookcase 3 for every scenario afterwards, which is a world none of them
 * seeded and only some of them notice. The two runs begin where `0013` put them,
 * and that is asked of the rule rather than of the row, because the rule is what
 * says which run a piece is carrying.
 */
const STARTS_ON: [string, number][] = [['genre/fiction', 1], ['genre/non-fiction', 4]]

const RESTORE_FURNITURE = [
  'DELETE FROM area WHERE position <> 0 OR fixture_id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  'DELETE FROM fixture WHERE id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  ...STARTS_ON.map(([slug, position]) =>
    `UPDATE fixture SET position = ${position} WHERE id IN (
       SELECT r.fixture_id FROM placement_rule r
         JOIN rule_condition c ON c.rule_id = r.id
        WHERE c.value = '${slug}' AND r.fixture_id IS NOT NULL)`),
  "UPDATE area SET starts_at = '' WHERE starts_at <> ''",
  "UPDATE fixture SET name = '' WHERE name <> ''",
  "UPDATE area SET name = '' WHERE name <> ''",
]

/**
 * Turn the connection Aspire produced into one node-postgres understands.
 *
 * A copy of the reasoning in web/server/db.pg.ts, not a copy of the code: this
 * package is a separate npm tree with its own dependencies, and importing
 * across the two to save fifteen lines would give the suite a build dependency
 * on the thing it is testing. Aspire hands over ADO.NET keywords, because it
 * produces connection strings for the .NET clients it was built around, and
 * node-postgres reads only the URL form and would take the whole keyword string
 * as a hostname.
 */
export function connectionConfig(value: string): pg.ClientConfig {
  const trimmed = value.trim()
  if (/^postgres(ql)?:\/\//i.test(trimmed)) return { connectionString: trimmed }

  const fields = new Map<string, string>()
  for (const pair of trimmed.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1) continue
    fields.set(pair.slice(0, at).trim().toLowerCase().replace(/\s+/g, ''), pair.slice(at + 1))
  }

  const port = fields.get('port')
  return {
    host: fields.get('host') ?? fields.get('server'),
    port: port ? Number(port) : undefined,
    user: fields.get('username') ?? fields.get('userid') ?? fields.get('user'),
    password: fields.get('password') ?? fields.get('pwd'),
    database: fields.get('database') ?? fields.get('initialcatalog'),
  }
}

/** Host, port and database. Never the credentials: this reaches the console. */
export function describeConnection(value: string): string {
  const config = connectionConfig(value)
  if (config.connectionString) {
    const url = new URL(config.connectionString)
    return `postgres ${url.hostname}:${url.port || '5432'}${url.pathname}`
  }
  return `postgres ${config.host ?? '?'}:${config.port ?? 5432}/${config.database ?? '?'}`
}

export class Catalogue {
  private readonly pool: pg.Pool

  /**
   * @param connection what the api resource was given as
   *   `ConnectionStrings__bookscan`
   * @param coverDir where the app writes photographs, which is still a
   *   directory on disk: cover storage is explicitly out of scope for this
   *   migration and the database holds bare filenames, not paths.
   */
  constructor(connection: string, readonly coverDir: string) {
    this.pool = new pg.Pool({ ...connectionConfig(connection), max: 2 })
    // node-postgres emits `error` on the pool when an idle client fails, and an
    // `error` event with no listener is one EventEmitter throws. Without this a
    // Postgres blip takes the test runner down rather than one scenario.
    this.pool.on('error', () => {})
  }

  private async all<Row>(sql: string, values: unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(sql, values)
    return result.rows as Row[]
  }

  /**
   * Back to nothing catalogued.
   *
   * One statement where there were five deletes, because CASCADE handles the
   * order the deletes were spelling out by hand. RESTART IDENTITY so a scenario
   * that reads an id back sees the same numbers a fresh catalogue gives.
   *
   * The furniture is deliberately not truncated: the fixtures, the areas and
   * the two rules are seeded when the schema is created, and emptying them
   * would leave the app with nowhere to file. It is put back instead, by
   * `RESTORE_FURNITURE`, because a boundary is an area since #232 and a
   * scenario that split a plank would otherwise leave that plank standing for
   * the next scenario to find.
   *
   * Photographs on disk are left alone. They are named after the moment they
   * were taken so they cannot collide, and no assertion counts them.
   *
   * `captures` has dropped off the list since #183. The table is still there
   * with its rows in it, but nothing reads or writes it, and naming a table this
   * suite has no opinion about would be asserting that it still matters. It is
   * emptied anyway: it holds a foreign key into `books`, so CASCADE reaches it.
   */
  async reset(): Promise<void> {
    /*
     * `tag` is on the list since #372, and it is the vocabulary rather than what
     * any book carries. CASCADE from `books` already takes `book_tag`, so an
     * emptied catalogue had no tagged books and still knew every word anybody
     * had ever typed. A scenario about naming a tag that does not exist yet
     * would then pass once and be offered the tag it made on every run
     * afterwards, which is the kind of green nobody reads twice.
     *
     * Nothing is lost by it. The two genre slugs are written by `define` on the
     * first save that states one, and the labels it gives them are the labels
     * the migration gave them.
     */
    await this.pool.query(
      'TRUNCATE book_authors, books, author_filing, ' +
      'author, author_alias, tag RESTART IDENTITY CASCADE',
    )
    for (const statement of RESTORE_FURNITURE) await this.pool.query(statement)
  }

  /**
   * The catalogue, in shelf order.
   *
   * `catalogued_books`, not `books`, since #183 put the queue in the same
   * table. A book waiting to be identified has no sort key, so it would sort to
   * the front of this list as a row with no title in it, and the first scenario
   * that left a book in the queue and then asserted the order would fail for a
   * reason that had nothing to do with what it was testing. That view holds
   * exactly the rows `books` held before the queue moved in.
   */
  async books(): Promise<BookRow[]> {
    return this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        ORDER BY b.sort_key ASC`,
    )
  }

  /*
   * `catalogued_books` rather than `books` for both of these, because
   * `author_filing` is a column on the views since #227: what a book files under
   * is a fact about its first credit's alias, joined back on. A scenario asks
   * about a book it has just saved onto a shelf, which is a catalogued book.
   */
  async bookByIsbn(isbn13: string): Promise<BookRow | undefined> {
    return (await this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        WHERE b.isbn13 = $1`,
      [isbn13],
    ))[0]
  }

  async bookByTitle(title: string): Promise<BookRow | undefined> {
    return (await this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        WHERE b.title = $1`,
      [title],
    ))[0]
  }

  /**
   * The boundaries of one run, in the order somebody walking it meets them.
   *
   * A range is a band of bookcase numbers rather than a column: fiction starts
   * on bookcase 1 and non-fiction on bookcase 4, so everything from 4 up is
   * non-fiction and everything below it is fiction. That is what the two
   * placement rules seeded by `0013` say, read off the floor plan instead of
   * off a `shelf_range` string that no longer exists.
   *
   * The first area is dropped because it is where the run begins rather than a
   * boundary: it is anchored at the empty string, which is not a book anybody
   * carried anywhere. Areas at a negative position are dropped by the query
   * for the same reason in reverse: a retired area is off the face of the
   * fixture, kept only so a placement can still name it.
   */
  async boundaries(range: 'fiction' | 'nonfiction' = 'fiction'): Promise<BoundaryRow[]> {
    const band = range === 'fiction' ? 'f.position >= 1 AND f.position < 4' : 'f.position >= 4'
    const areas = await this.all<AreaRow>(
      `SELECT a.id, f.position AS fixture_position, a.position, a.starts_at
         FROM area a JOIN fixture f ON f.id = a.fixture_id
        WHERE a.position >= 0 AND ${band}
        ORDER BY f.position, f.id, a.position`,
    )

    // `areas[index]` is the row before this one, because the slice shifted
    // everything down by the run's opening area.
    return areas.slice(1).map((area, index): BoundaryRow => ({
      id: area.id,
      kind: area.fixture_position > areas[index]!.fixture_position ? 'shelf' : 'area',
      starts_at: area.starts_at,
    }))
  }

  /**
   * Every plank on the floor, retired ones included.
   *
   * No `position >= 0` filter, unlike `boundaries` above, and deliberately: this
   * answers "what is the area this book names called", and a book still pointing
   * at an area that has been taken off the face of its fixture is a finding
   * rather than a row to hide. The app's own read joins the same way.
   */
  async areas(): Promise<PlankRow[]> {
    return this.all<PlankRow>(
      `SELECT a.id, f.position AS fixture_position, a.position,
              f.name AS fixture_name, a.name
         FROM area a JOIN fixture f ON f.id = a.fixture_id`,
    )
  }

  /**
   * Give a bookcase a name, which is what the furniture screens are for.
   *
   * Written straight in rather than driven through those screens, for the reason
   * the books are: this is a scenario's setup, and what it is about is what
   * happens to every other screen afterwards. Naming a piece moves nothing and
   * changes no id; every label on it reads differently, and #356 is what that
   * cost the day it was first done.
   */
  async nameFixture(fixturePosition: number, name: string): Promise<void> {
    await this.pool.query(
      'UPDATE fixture SET name = $1 WHERE position = $2',
      [name, fixturePosition],
    )
  }

  /**
   * Stand a bare plank up, out past the end of every run.
   *
   * For a scenario that needs the catalogue to have recorded a book somewhere
   * the shelves do not put it. Before #232 that was any label at all, because
   * `books.location` was a string; a placement names an area now, so the route
   * refuses a label naming furniture nobody owns, and the scenario has to own
   * some. That refusal is the point of the cut-over rather than something to
   * work around, so the furniture is made here instead of being invented by the
   * app.
   *
   * **Anchored at `'~'`, which is why the layout does not move.** A sort key is
   * normalised to letters, digits and spaces joined with the unit separator, so
   * a tilde is above every key this catalogue can hold, and a plank anchored
   * there is one no book ever reaches. `END_OF_RUN` in web/shared/layout.ts is
   * the same character for the same reason. Every book stays on the plank it was
   * on; all that changes is that the plank exists to be recorded on.
   */
  /**
   * The plank an address like `1A` names, which is what the shelving routes take.
   *
   * They took the address itself until #359, and an address is a rendering: it
   * is built out of two ordinals, and the moment a piece has a name every other
   * screen calls the same plank something else. So a step that wants to say "1A
   * filled up" resolves the plank here, exactly as a screen resolves it from the
   * answer it is acting on, and sends the area.
   *
   * The first fixture at a position, matching `runAreasOf`: a run is the
   * furniture that was there first, and a scenario that stands a second piece up
   * at the same position is saying something about that, not about this.
   */
  async plankId(label: string): Promise<number> {
    const match = /^(\d+)([A-Z]+)$/.exec(label)
    if (!match) throw new Error(`${label} is not a plank address`)

    let areaPosition = 0
    for (const letter of match[2]!) areaPosition = areaPosition * 26 + (letter.charCodeAt(0) - 64)
    areaPosition -= 1

    const [found] = await this.all<{ id: number }>(
      `SELECT a.id FROM area a JOIN fixture f ON f.id = a.fixture_id
        WHERE f.position = $1 AND a.position = $2
        ORDER BY f.id LIMIT 1`,
      [Number(match[1]), areaPosition],
    )
    if (!found) throw new Error(`the shelves have no plank ${label}`)
    return found.id
  }

  async standUpPlank(fixturePosition: number, areaPosition = 0): Promise<void> {
    const [collection] = await this.all<{ id: number }>(
      'SELECT id FROM collection ORDER BY id LIMIT 1',
    )
    if (!collection) throw new Error('no collection to hang a fixture off')

    const [existing] = await this.all<{ id: number }>(
      "SELECT id FROM fixture WHERE position = $1 AND name = '' ORDER BY id LIMIT 1",
      [fixturePosition],
    )
    const [fixture] = existing ? [existing] : await this.all<{ id: number }>(
      `INSERT INTO fixture (collection_id, kind, name, position, sort_strategy, note)
       VALUES ($1, 'bookshelf', '', $2, 'inherit', '') RETURNING id`,
      [collection.id, fixturePosition],
    )

    await this.pool.query(
      `INSERT INTO area (fixture_id, position, name, starts_at, sort_strategy, note)
       VALUES ($1, $2, '', '~', 'inherit', '')
       ON CONFLICT (fixture_id, position) DO NOTHING`,
      [fixture!.id, areaPosition],
    )
  }

  /**
   * The work queue itself. Read because #65 is a claim about what reaches the
   * database while a book is still in it, which no screen assertion can make.
   *
   * `queued_books` is the queue now, and it is the right relation rather than
   * merely the working one: the steps that read this all ask about a book
   * somebody has photographed and not yet shelved, and `books` would hand them
   * every book in the catalogue as well. Two of the projected columns are
   * therefore constant here, `status` never reading `done` and `book_id` always
   * reading null, which is exactly what a capture waiting in the queue always
   * was.
   */
  async captures(): Promise<CaptureRow[]> {
    return this.all<CaptureRow>(
      `SELECT ${QUEUE_ROW}, ${PHOTOGRAPHS} FROM queued_books b
       ${PHOTOGRAPH_JOINS} ORDER BY b.id ASC`,
    )
  }

  async captureCount(): Promise<number> {
    // CAST for the reason the stores carry one: COUNT is a bigint and
    // node-postgres hands a bigint back as a string rather than lose precision,
    // so `toBe(1)` would fail against "1" and say nothing about why.
    //
    // Counted over the queue and not over `books`, because "the queue holds one
    // book" is a claim about what is still waiting. A book that has been shelved
    // has left the queue without leaving the table, so counting the table would
    // make every scenario that shelves anything count it twice.
    const [row] = await this.all<{ n: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM queued_books',
    )
    return row!.n
  }

  /**
   * What one book is under, and who said each one.
   *
   * Read from `books` rather than from a view, because a scenario asks this of a
   * book that is still in the queue as readily as of one on a shelf: a tag is
   * written the moment somebody says it, and a capture has been a row in `books`
   * since #183.
   *
   * The source travels with it, and that is most of why this exists. "The book
   * carries a comic book tag" is a weaker claim than the one #372 has to make,
   * which is that a *person's* tag survives a save that states a genre. Those
   * are different rows and only one of them is a person's.
   */
  async tagsOf(title: string): Promise<{ slug: string; label: string; source: string }[]> {
    return this.all(
      `SELECT t.slug, t.label, bt.source
         FROM books b
         JOIN book_tag bt ON bt.book_id = b.id
         JOIN tag t ON t.id = bt.tag_id
        WHERE b.title = $1
        ORDER BY t.slug, bt.source`,
      [title],
    )
  }

  /** Every tag the collection keeps, whether or not a book carries it. */
  async vocabulary(): Promise<{ slug: string; label: string }[]> {
    return this.all('SELECT slug, label FROM tag ORDER BY slug')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
