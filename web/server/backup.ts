/**
 * Backing up the Postgres catalogue, and proving the backup restores.
 *
 * The library half. `backup-catalogue.ts` is the command line front end and the
 * thing the scheduled task runs; everything decidable without a database or a
 * subprocess lives here so it can be tested without either.
 *
 * The shape of this follows one idea: **a dump nobody has restored is a
 * hypothesis.** So a run produces two artefacts, not one. The dump itself, and
 * a manifest holding the digest of the catalogue *as of the instant the dump
 * was taken*. Verification restores the dump into a scratch database and
 * compares it against that manifest.
 *
 * Comparing against the manifest rather than against the live catalogue is
 * deliberate and it is not laziness. The catalogue is added to most days, often
 * while a background job is running. Comparing a restore against a source that
 * has moved on since the dump was taken produces a failure every time somebody
 * scans a book during the backup window, and an alarm that cries wolf is an
 * alarm nobody reads. The manifest and the dump are pinned to the same snapshot
 * by `pg_export_snapshot`, so the comparison is between two views of one
 * instant and any difference is a real one.
 */

import { connectionConfig } from './db.pg'

/**
 * The Postgres client image used when no `pg_dump` is on PATH, which is the
 * situation on the owner's machine: the server runs in a container and the
 * client tools were never installed.
 *
 * **This must be at least the major version of the server being dumped.**
 * `pg_dump` refuses a server newer than itself, and a `pg_restore` older than
 * the archive refuses the archive. The live catalogue runs `postgres:18.3`, so
 * this does too. Changing it is a decision rather than a refresh, for the same
 * reason POSTGRES_IMAGE in pgcontainer.ts is pinned.
 */
export const DEFAULT_IMAGE = 'postgres:18.3'

/**
 * How many dumps are kept. Fourteen daily dumps is two weeks, which is long
 * enough to notice that something has been quietly wrong for a while and short
 * enough to bound.
 */
export const DEFAULT_KEEP = 14

/**
 * The other bound, and the one that matters on this machine. Disk here has
 * twice dropped under 2 GB in a day, and a backup scheme that fills a disk
 * turns one problem into two. Retention is whichever of the two limits bites
 * first: never more than `keep` dumps, and never more than this many bytes of
 * them.
 */
export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024

/**
 * A dump is not attempted when the volume has less than this free. Refusing to
 * start is a better outcome than a half-written dump beside a full disk, and a
 * half-written dump is exactly what an interrupted `pg_dump` leaves.
 */
export const DEFAULT_MIN_FREE_BYTES = 1024 * 1024 * 1024

/**
 * Every table the catalogue lives in, asked of the catalogue rather than
 * written down here.
 *
 * **This used to be a list of six names and that is the defect it is fixing.**
 * The list was written when the schema had six tables. The remodel has since
 * added thirteen more, and every one of them was dumped by `pg_dump`, which
 * does not read this file, and then not checked by the verification, which did.
 * A restore that lost `book_tag` entirely still printed `RESTORED AND VERIFIED`.
 * Nothing read those tables yet so nothing broke; at the cut-over that inverts,
 * and the verification would be checking the legacy columns while the
 * authoritative data went unchecked.
 *
 * So the coverage is derived, and **a table added tomorrow is covered by
 * existing**. There is nothing here for the next person to remember to update,
 * which is the only property that would have prevented this.
 *
 * Three exclusions, each of which is the query rather than a filter applied
 * afterwards:
 *
 * - **`nspname = 'public'`** keeps `drizzle.__drizzle_migrations` out. That is
 *   the migrator's bookkeeping about which files it has run, not the owner's
 *   catalogue, and it lives in its own schema precisely so it can be told
 *   apart. See `infrastructure/db/migrate.ts`.
 * - **`relkind = 'r'`** keeps `shelved_books`, `catalogued_books` and
 *   `queued_books` out. They are views over `books`, so digesting one would
 *   count rows a second time and report a difference in four places whenever
 *   `books` moved in one. It also excludes sequences and indexes, which are
 *   not rows anybody owns.
 * - Partitioned tables (`relkind = 'p'`) are deliberately not matched either.
 *   This schema has none, and if it grows one its partitions are `'r'` and
 *   would be digested individually; matching both would count every row twice.
 */
export const CATALOGUE_TABLES_SQL =
  `select c.relname as name, quote_ident(c.relname) as sql_name
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by c.relname`

/**
 * The shelf order, hashed.
 *
 * This is the check that catches what a row count cannot. A count does not move
 * when a collation or an encoding difference does, and the failure a collation
 * difference produces is not an error: it is the same books in a different
 * order, which is to say the app telling somebody to put a book in the wrong
 * place. `books.sort_key` is declared `COLLATE "C"` for that reason (see
 * SORT_KEY_COLUMNS in db.pg.ts) and this is how the declaration is proved to
 * have survived the round trip rather than assumed to have.
 */
export const SHELF_ORDER_SQL =
  "select md5(string_agg(id::text, ',' order by sort_key, id)) as hash from books"

/**
 * The same idea for the dividers. `separators.starts_at` is the other
 * `COLLATE "C"` column, it is compared against `books.sort_key` to find where a
 * shelf begins, and an ordering difference too small to change the book list
 * can still be large enough to move one book past a divider.
 */
export const SEPARATOR_ORDER_SQL =
  "select md5(string_agg(id::text, ',' order by starts_at, id)) as hash from separators"

/**
 * Count and content digest for one table, in one statement.
 *
 * The content digest is a digest of the *set* of rows: each row cast to text
 * and hashed, then those hashes concatenated in order of themselves. Two
 * properties follow, and both are on purpose.
 *
 * It is independent of collation and of physical row order, so it does not
 * produce a spurious difference just because `pg_restore` inserted rows in a
 * different sequence, and it does not double up on the check SHELF_ORDER_SQL
 * already makes.
 *
 * It is sensitive to type as well as to value, because `row::text` renders an
 * integer and the string of the same digits differently. That is the failure
 * the stage H verification was built to catch and it is worth catching here
 * too: a value that arrives as the wrong type reads correctly on a page and
 * sorts wrongly.
 */
function tableDigestSql(table: string): string {
  return `select count(*)::text as count,
                 coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as digest
          from ${table} t`
}

/** What a catalogue looked like at one instant. */
export interface CatalogueDigest {
  /**
   * Every table the digest covers, in name order, as the catalogue listed them.
   *
   * Compared in its own right, and not redundant with `counts`: a table that is
   * empty on both sides and *missing* on one has the same count and the same
   * content digest either way, so this line is the only thing that would say a
   * whole table did not come back.
   *
   * **Optional only because a manifest on disk may predate it.** `readDigest`
   * always fills it in. A manifest written when the six table names were
   * hard-coded has no such field, and `tablesIn` says what to do about that.
   */
  tables?: string[]
  /** Row count per table, keyed by table name. */
  counts: Record<string, number>
  /** Content digest per table, keyed by table name. */
  digests: Record<string, string>
  /** The shelf order hash. Null when there are no books. */
  shelfOrder: string | null
  /** The divider order hash. Null when there are no separators. */
  separatorOrder: string | null
  /** `datcollate` of the database. Reproduced on the scratch side, and compared. */
  collation: string
  /** `datctype` of the database. */
  ctype: string
  /** `UTF8` and nothing else is expected, but it is read rather than assumed. */
  encoding: string
  /** `server_version_num`, e.g. 180003. Recorded, not compared: a restore onto a newer server is legitimate. */
  serverVersionNum: number
}

/** The little of node-postgres this file needs, so a Pool or a Client both fit. */
export interface Queryable {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>
}

/**
 * Read a catalogue's digest.
 *
 * **Every statement here reads.** This runs against the live catalogue on the
 * dump side, so it may not write, and there is nothing in it that could: two
 * catalogue lookups, then a count and a digest per table, then two aggregates.
 *
 * The table list is read first and everything else follows from it, so a table
 * that arrived in a migration this file has never heard of is digested anyway.
 * Read inside the caller's transaction like the rest, so the list describes the
 * same instant the rows do.
 *
 * Pass the client that holds the repeatable-read transaction the dump's
 * snapshot was exported from, and the digest describes the same instant the
 * dump does.
 */
export async function readDigest(client: Queryable): Promise<CatalogueDigest> {
  const counts: Record<string, number> = {}
  const digests: Record<string, string> = {}

  const listing = await client.query(CATALOGUE_TABLES_SQL)
  const tables = listing.rows.map((row) => ({
    name: String(row.name),
    // Quoted by the server, so a table name that needs quoting is spelled the
    // way Postgres would spell it rather than the way this file guesses.
    sql: String(row.sql_name),
  }))

  for (const table of tables) {
    const { rows } = await client.query(tableDigestSql(table.sql))
    const row = rows[0] ?? {}
    counts[table.name] = Number(row.count ?? 0)
    digests[table.name] = String(row.digest ?? '')
  }

  const shelf = await client.query(SHELF_ORDER_SQL)
  const separator = await client.query(SEPARATOR_ORDER_SQL)
  const meta = await client.query(
    `select datcollate, datctype, pg_encoding_to_char(encoding) as encoding,
            current_setting('server_version_num') as version
     from pg_database where datname = current_database()`,
  )
  const metaRow = meta.rows[0] ?? {}

  return {
    tables: tables.map((table) => table.name),
    counts,
    digests,
    shelfOrder: (shelf.rows[0]?.hash as string | null) ?? null,
    separatorOrder: (separator.rows[0]?.hash as string | null) ?? null,
    collation: String(metaRow.datcollate ?? ''),
    ctype: String(metaRow.datctype ?? ''),
    encoding: String(metaRow.encoding ?? ''),
    serverVersionNum: Number(metaRow.version ?? 0),
  }
}

/** One thing that differs between the manifest and the restore. */
export interface Difference {
  what: string
  expected: string
  actual: string
}

/**
 * The tables a digest describes.
 *
 * A manifest written before the coverage was derived has no `tables` and names
 * its six tables only as the keys of `counts`. There is nothing in such a
 * manifest to compare the other thirteen against, so those are left out and
 * `manifestPredatesDerivedTables` is what makes the run say so. Reporting them
 * as missing instead would print thirteen failures for a dump that has every
 * one of them, on a day somebody is already reading this log because something
 * else went wrong.
 */
export function tablesIn(digest: CatalogueDigest): string[] {
  return digest.tables ?? Object.keys(digest.counts).sort()
}

/** Whether a manifest was written before the table list came from the catalogue. */
export function manifestPredatesDerivedTables(digest: CatalogueDigest): boolean {
  return digest.tables === undefined
}

/**
 * Which tables a comparison is about.
 *
 * The union of the two sides, so a table on one alone is compared rather than
 * skipped, except against an older manifest, which can only speak for the
 * tables it named. Exported so the report prints the same set the comparison
 * used: a row in that table the comparison never looked at is worse than no row
 * at all.
 */
export function tablesCompared(expected: CatalogueDigest, actual: CatalogueDigest): string[] {
  if (manifestPredatesDerivedTables(expected)) return tablesIn(expected)
  return [...new Set([...tablesIn(expected), ...tablesIn(actual)])].sort()
}

/**
 * Compare a restored catalogue against the manifest taken when it was dumped.
 *
 * An empty array is the only result that means the backup restored. Everything
 * here is a hard difference: `serverVersionNum` is deliberately not compared,
 * because restoring onto a newer server is a legitimate thing to do and is what
 * a real recovery may well have to do.
 *
 * The collation *is* compared. A database restored under a different collation
 * is not the same database, and the whole reason `COLLATE "C"` exists on four
 * columns is that the difference is silent everywhere else.
 *
 * **Which tables are compared comes from the two digests**, not from a list
 * here, and it is the union of them so that a table on either side alone is a
 * difference rather than a table nobody looked at.
 */
export function compareDigests(expected: CatalogueDigest, actual: CatalogueDigest): Difference[] {
  const differences: Difference[] = []
  const note = (what: string, a: unknown, b: unknown): void => {
    if (String(a) !== String(b)) differences.push({ what, expected: String(a), actual: String(b) })
  }

  if (!manifestPredatesDerivedTables(expected)) {
    note('tables', tablesIn(expected).join(', '), tablesIn(actual).join(', '))
  }

  for (const table of tablesCompared(expected, actual)) {
    note(`${table} rows`, expected.counts[table] ?? 0, actual.counts[table] ?? 0)
    note(`${table} content`, expected.digests[table] ?? '', actual.digests[table] ?? '')
  }
  note('shelf order', expected.shelfOrder, actual.shelfOrder)
  note('divider order', expected.separatorOrder, actual.separatorOrder)
  note('collation', expected.collation, actual.collation)
  note('ctype', expected.ctype, actual.ctype)
  note('encoding', expected.encoding, actual.encoding)

  return differences
}

/** What a run writes beside its dump. */
export interface Manifest {
  /** The dump this describes, as a bare filename in the same directory. */
  dump: string
  /** When the snapshot was taken, ISO-8601 UTC. */
  takenAt: string
  /** Host, port and database of the source. Never the credentials. */
  source: string
  /** The digest of the source, as of the snapshot the dump was taken from. */
  digest: CatalogueDigest
  /** Size of the dump in bytes, so retention can be planned without stat-ing every file. */
  bytes: number
  /** How the client tools were run, for when a version question comes up later. */
  client: string
  /** Filled in by a verification run, so the last known state of a dump is on disk. */
  verified?: {
    at: string
    ok: boolean
    /** The scratch database the restore went into, and which was then dropped. */
    scratch: string
    differences: Difference[]
  }
}

const NAME_PATTERN = /^bookscan-(\d{8}T\d{6})Z\.dump$/

/**
 * The name of the dump taken at `at`.
 *
 * Sortable, unambiguous, and UTC. Local time would collide with itself for an
 * hour every autumn, which is precisely the sort of detail that turns a
 * retention sweep into a lost backup.
 */
export function dumpFileName(at: Date): string {
  const iso = at.toISOString()
  return `bookscan-${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T` +
    `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z.dump`
}

/** The manifest that belongs beside a dump. */
export function manifestFileName(dump: string): string {
  return `${dump.replace(/\.dump$/, '')}.json`
}

/**
 * When a dump was taken, read back out of its name, or undefined if the name is
 * not one of ours.
 *
 * Retention sorts on this rather than on a filesystem timestamp, because a
 * copied or restored-from-elsewhere directory has mtimes that say when the
 * files were copied and nothing about when the catalogue was read.
 */
export function dumpTimestamp(name: string): Date | undefined {
  const match = NAME_PATTERN.exec(name)
  if (!match) return undefined
  const [, stamp = ''] = match
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T` +
    `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? undefined : at
}

/** A dump on disk, as retention sees it. */
export interface DumpFile {
  name: string
  bytes: number
  takenAt: Date
}

export interface RetentionLimits {
  keep: number
  maxBytes: number
}

export interface RetentionPlan {
  kept: DumpFile[]
  /** Oldest first, each with the limit that removed it. */
  removed: Array<DumpFile & { because: 'count' | 'size' }>
}

/**
 * Decide which dumps stay.
 *
 * Two bounds, applied in that order: at most `keep` dumps, then at most
 * `maxBytes` of them. Both are hard. The newest dump is never removed even if
 * it alone exceeds the byte limit, because deleting the only copy of the
 * catalogue to satisfy a disk budget is a worse outcome than every outcome the
 * disk budget exists to prevent. A dump that big is reported instead.
 */
export function planRetention(files: readonly DumpFile[], limits: RetentionLimits): RetentionPlan {
  const newestFirst = [...files].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
  const kept = newestFirst.slice(0, Math.max(1, limits.keep))
  const removed: Array<DumpFile & { because: 'count' | 'size' }> = newestFirst
    .slice(Math.max(1, limits.keep))
    .map((file) => ({ ...file, because: 'count' as const }))

  let total = kept.reduce((sum, file) => sum + file.bytes, 0)
  while (kept.length > 1 && total > limits.maxBytes) {
    const oldest = kept.pop()
    if (!oldest) break
    total -= oldest.bytes
    removed.push({ ...oldest, because: 'size' })
  }

  removed.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
  return { kept, removed }
}

/**
 * The connection as seen from inside a container, and the password kept out of
 * it.
 *
 * `pg_dump` runs in a `postgres:` container here because the client tools are
 * not installed on the machine. A container cannot reach `127.0.0.1` on the
 * host, so a loopback host has to become `host.docker.internal`, which Docker
 * Desktop provides and which `--add-host` supplies elsewhere.
 *
 * The password comes back separately rather than in the URL because the URL
 * goes in the `docker run` argument list, where anything with a process listing
 * can read it. It is passed through the environment instead, by name only
 * (`docker run -e PGPASSWORD`), so it never appears in an argument vector.
 */
export function containerConnection(value: string): { url: string; password: string } {
  const config = connectionConfig(value)

  let host: string
  let port: string
  let user: string
  let password: string
  let database: string

  if (config.connectionString) {
    const url = new URL(config.connectionString)
    host = decodeURIComponent(url.hostname)
    port = url.port || '5432'
    user = decodeURIComponent(url.username)
    password = decodeURIComponent(url.password)
    database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  } else {
    host = config.host ?? 'localhost'
    port = String(config.port ?? 5432)
    user = config.user ?? ''
    password = typeof config.password === 'string' ? config.password : ''
    database = config.database ?? ''
  }

  const loopback = ['localhost', '127.0.0.1', '::1', '0.0.0.0']
  const reachable = loopback.includes(host.toLowerCase()) ? 'host.docker.internal' : host

  const credentials = user ? `${encodeURIComponent(user)}@` : ''
  return {
    url: `postgres://${credentials}${reachable}:${port}/${encodeURIComponent(database)}`,
    password,
  }
}

/** Host, port and database of a connection, with no credentials in it. Safe to log. */
export function describeSource(value: string): string {
  const config = connectionConfig(value)
  if (config.connectionString) {
    const url = new URL(config.connectionString)
    return `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`
  }
  return `${config.host ?? '?'}:${config.port ?? 5432}/${config.database ?? '?'}`
}

/**
 * The major version an image tag names, or undefined if it does not name one.
 *
 * Used to refuse a client older than the server before a dump is attempted
 * rather than after. `pg_dump` does report this itself, but it reports it as
 * `aborting because of server version mismatch` after the scheduled task has
 * already been running for a week, and the point of this check is that the
 * refusal names the fix.
 */
export function imageMajor(image: string): number | undefined {
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : ''
  const match = /^(\d+)/.exec(tag)
  if (!match) return undefined
  return Number(match[1])
}

/** The server's major version, from `server_version_num`. 180003 is 18. */
export function serverMajor(versionNum: number): number {
  return Math.floor(versionNum / 10000)
}

/** Bytes, for a human, in the report. */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/**
 * A scratch database name that nothing else will pick.
 *
 * Named so it is obvious in a `\l` what it is and that it is disposable, and
 * random so two verifications on one server cannot collide. The verification
 * drops it; the name is what tells an operator who finds one left behind after
 * a crash that dropping it is safe.
 */
export function scratchDatabaseName(suffix: string): string {
  return `bookscan_verify_${suffix}`
}
