/**
 * Reading, and resetting, the database the app under test writes to. The
 * connection is read out of the api resource's own environment by
 * global-setup rather than reconstructed here, so this opens the exact
 * database the AppHost gave the app.
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
  /** Which of its photographs have been read, comma separated. Stays with the book after it is shelved. */
  analysed: string
  /** Which of the seven states the book is in. `checked_out` is one in somebody's bag; `shelved` is one on the bookcase. */
  state: string
  /**
   * The area the book was last placed in, or null for one nobody has placed.
   * `areas()` below turns this row id back into the label a screen shows.
   */
  current_area_id: number | null
}

/**
 * A book photographed but not yet filed, read back through the projection
 * below: there is no queue table any more, only books in one of the three
 * early states.
 */
export interface CaptureRow {
  id: number
  status: string
  isbn13: string
  isbn10: string
  isbn_source: string
  title_guess: string
  /** Which of its photographs the background worker has read, comma separated. */
  analysed: string
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
   * Written by the background pass after reading the front photograph. Empty
   * until then, and empty for good if the hash refused the frame as
   * featureless.
   */
  front_hash: string
}

/** A mirror of `QUEUE_ROW` in web/server/queue.ts, copied rather than imported since this package is a separate npm tree. */
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

/** Joined on `current_photograph`, the app's own relation for the newest photograph of each kind, rather than reproducing that tie-break here. */
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

/** A boundary is an `area` row; `kind` is derived from the furniture, not stored. */
export interface BoundaryRow {
  id: number
  /** 'shelf' when a new bookcase starts here, 'area' when a new plank does. */
  kind: 'shelf' | 'area'
  starts_at: string
}

/**
 * One plank with the bookcase it hangs on. The label itself (like `1A`) is
 * built in `catalogue.steps.ts`; this only hands back rows.
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
 * The furniture back to what migration `0013` leaves on a fresh database.
 * Not truncated: the runs, fixtures and areas are seeded by that migration,
 * so only what a scenario added or changed is put back.
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

/** Aspire hands over ADO.NET-style keywords, but node-postgres only reads the URL form and would otherwise take the whole keyword string as a hostname. */
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
   * @param coverDir where the app writes photographs: the database holds bare
   *   filenames, not paths.
   */
  constructor(connection: string, readonly coverDir: string) {
    this.pool = new pg.Pool({ ...connectionConfig(connection), max: 2 })
    // node-postgres emits `error` on the pool when an idle client fails, and an
    // `error` event with no listener throws. Without this a Postgres blip takes
    // down the whole test runner rather than one scenario.
    this.pool.on('error', () => {})
  }

  private async all<Row>(sql: string, values: unknown[] = []): Promise<Row[]> {
    const result = await this.pool.query(sql, values)
    return result.rows as Row[]
  }

  /**
   * RESTART IDENTITY so a scenario that reads an id back sees the same
   * numbers a fresh catalogue gives. Photographs on disk are left alone: they
   * are named after the moment they were taken, so they cannot collide.
   */
  async reset(): Promise<void> {
    /* `tag` is explicit here since it is vocabulary, not something CASCADE from `books` reaches. */
    await this.pool.query(
      'TRUNCATE book_authors, books, author_filing, ' +
      'author, author_alias, tag RESTART IDENTITY CASCADE',
    )
    for (const statement of RESTORE_FURNITURE) await this.pool.query(statement)
  }

  /**
   * Reads from `catalogued_books`, not `books`: a book still in the queue has
   * no sort key, and would sort to the front with no title.
   */
  async books(): Promise<BookRow[]> {
    return this.all<BookRow>(
      `SELECT b.*, ${PHOTOGRAPHS} FROM catalogued_books b ${PHOTOGRAPH_JOINS}
        ORDER BY b.sort_key ASC`,
    )
  }

  // Same view as `books()` above: `author_filing` lives on it, not on the table.
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
   * A range is a band of bookcase numbers, read off the placement rules `0013` seeds rather than a stored column.
   * The first area (the run's start, anchored at the empty string) and areas at a negative position (retired, kept only so a placement can still name them) are dropped.
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
   * Every plank on the floor, retired ones included: unlike `boundaries`
   * above, there is no `position >= 0` filter, because a book still pointing
   * at a retired area is a finding rather than a row to hide.
   */
  async areas(): Promise<PlankRow[]> {
    return this.all<PlankRow>(
      `SELECT a.id, f.position AS fixture_position, a.position,
              f.name AS fixture_name, a.name
         FROM area a JOIN fixture f ON f.id = a.fixture_id`,
    )
  }

  /** Written straight into the database rather than through the furniture screens: this is a scenario's setup, not what it is testing. */
  async nameFixture(fixturePosition: number, name: string): Promise<void> {
    await this.pool.query(
      'UPDATE fixture SET name = $1 WHERE position = $2',
      [name, fixturePosition],
    )
  }

  /** Anchored at `'~'`, since a sort key is normalised to letters, digits and spaces joined with the unit separator and a tilde sorts after every key this catalogue can hold. `END_OF_RUN` in web/shared/layout.ts uses the same character for the same reason. */
  /** The plank an address like `1A` names. Resolves to the first fixture at that position, matching `runAreasOf`, since a run is the furniture that was there first. */
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
   * The work queue: `queued_books`, not `books`, since a step here asks about
   * a photographed, not yet shelved, book only.
   */
  async captures(): Promise<CaptureRow[]> {
    return this.all<CaptureRow>(
      `SELECT ${QUEUE_ROW}, ${PHOTOGRAPHS} FROM queued_books b
       ${PHOTOGRAPH_JOINS} ORDER BY b.id ASC`,
    )
  }

  /** Counted from `capture`: taking a photograph again does not replace the one it improves on, so this is a reliable count to wait on after a shutter fires. */
  async photographCount(): Promise<number> {
    // CAST because COUNT is a bigint and node-postgres returns it as a string.
    const [row] = await this.all<{ n: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM capture',
    )
    return row!.n
  }

  async captureCount(): Promise<number> {
    // CAST for the same reason as `photographCount`. Counted over the queue,
    // not over `books`: a book that has been shelved has left the queue
    // without leaving the table, so counting the table would count it twice.
    const [row] = await this.all<{ n: number }>(
      'SELECT CAST(COUNT(*) AS INTEGER) AS n FROM queued_books',
    )
    return row!.n
  }

  /**
   * Read from `books`, not a view: a scenario may ask this of a book still in
   * the queue. `source` says who stated each tag; a person's tag is a
   * different row from one stated while saving a genre.
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
