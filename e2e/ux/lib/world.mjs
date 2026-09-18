/**
 * The seeded world, read directly rather than through the screens.
 *
 * The fingerprint (below) is one cheap query, taken before and after every
 * press, that says whether that press changed anything at all. The completion
 * checks decide whether a task was actually done from rows, not from the
 * driver's own account of itself. `drawnFurniture` at the bottom asks the app
 * what it draws, which rows alone cannot answer.
 *
 * The connection comes from the AppHost, via `aspire describe`, and from
 * nowhere else. This file never reads a connection string from the
 * environment, and it refuses port 5433 outright: that is the owner's live
 * catalogue.
 */

import pg from 'pg'

/** The live catalogue. Nothing in this repository may connect to it. */
const FORBIDDEN_PORT = 5433

/**
 * Turn the connection Aspire produced into one node-postgres understands.
 *
 * The same translation `e2e/support/database.ts` makes, and a copy for the same
 * reason it is a copy of the app's: Aspire hands over ADO.NET keywords, because
 * it produces connection strings for the .NET clients it was built around, and
 * node-postgres reads only the URL form and would take the whole keyword string
 * as a hostname.
 */
export function connectionConfig(connection) {
  const trimmed = connection.trim()
  const config = /^postgres(ql)?:\/\//i.test(trimmed)
    ? urlConfig(trimmed)
    : keywordConfig(trimmed)
  if (Number(config.port) === FORBIDDEN_PORT) {
    throw new Error(
      `Refusing to connect to port ${FORBIDDEN_PORT}. That is the live catalogue. ` +
      'See AGENTS.md.',
    )
  }
  return config
}

function urlConfig(connection) {
  const url = new URL(connection)
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '') || 'bookscan',
  }
}

function keywordConfig(connection) {
  const fields = new Map()
  for (const pair of connection.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1) continue
    fields.set(pair.slice(0, at).trim().toLowerCase().replace(/\s+/g, ''), pair.slice(at + 1))
  }
  return {
    host: fields.get('host') ?? fields.get('server'),
    port: Number(fields.get('port') ?? 5432),
    user: fields.get('username') ?? fields.get('userid') ?? fields.get('user'),
    password: fields.get('password') ?? fields.get('pwd'),
    database: fields.get('database') ?? fields.get('initialcatalog'),
  }
}

export async function withClient(connection, fn) {
  const client = new pg.Client(connectionConfig(connection))
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * One string that changes whenever the arranging did.
 *
 * Digested by content, not counted, so a book moving between planks changes it
 * even though counts do not. Restricted to shelved and checked-out books: a
 * background worker draining the capture queue also writes rows in `books`,
 * and without the restriction that would look like a press changed the world
 * when nothing was pressed.
 */
const FINGERPRINT_SQL = `
  SELECT
    (SELECT COALESCE(md5(string_agg(f.id || ':' || f.name || ':' || f.position || ':' || f.kind, ',' ORDER BY f.id)), '-') FROM fixture f) AS fixtures,
    (SELECT COALESCE(md5(string_agg(a.id || ':' || a.fixture_id || ':' || a.position || ':' || a.name || ':' || a.starts_at, ',' ORDER BY a.id)), '-') FROM area a) AS areas,
    (SELECT COALESCE(md5(string_agg(b.id || ':' || COALESCE(b.current_area_id::text, '-') || ':' || b.state || ':' || b.shelf_range || ':' || b.sort_key, ',' ORDER BY b.id)), '-')
       FROM books b WHERE b.state IN ('shelved', 'checked_out')) AS books,
    (SELECT COUNT(*) FROM book_placement) AS placements,
    (SELECT COALESCE(md5(string_agg(r.id || ':' || COALESCE(r.area_id::text, '-') || ':' || COALESCE(r.fixture_id::text, '-') || ':' || r.priority || ':' || r.name || ':' || r.enabled, ',' ORDER BY r.id)), '-') FROM placement_rule r) AS rules,
    (SELECT COALESCE(md5(string_agg(c.id || ':' || c.rule_id || ':' || c.field || ':' || c.operator || ':' || c.value, ',' ORDER BY c.id)), '-') FROM rule_condition c) AS conditions,
    (SELECT COALESCE(md5(string_agg(t.book_id || ':' || t.tag_id || ':' || t.source, ',' ORDER BY t.book_id, t.tag_id)), '-') FROM book_tag t) AS booktags,
    (SELECT COUNT(*) FROM outstanding_move) AS outstanding
`

export async function fingerprint(client) {
  const { rows } = await client.query(FINGERPRINT_SQL)
  const r = rows[0]
  return [r.fixtures, r.areas, r.books, r.placements, r.rules, r.conditions, r.booktags, r.outstanding].join('/')
}

/** The furniture, as rows, for the baseline record and the completion checks. */
export async function furniture(client) {
  const { rows } = await client.query(`
    SELECT f.id AS fixture_id, f.name AS fixture_name, f.position AS fixture_position, f.kind,
           a.id AS area_id, a.position AS area_position, a.name AS area_name, a.starts_at,
           (SELECT COUNT(*) FROM books b WHERE b.current_area_id = a.id) AS books
      FROM fixture f
      LEFT JOIN area a ON a.fixture_id = f.id
     ORDER BY f.position, f.id, a.position
  `)
  return rows
}

/** Every shelved or checked-out book, with where it stands and what claims it. */
export async function shelvedBooks(client) {
  const { rows } = await client.query(`
    SELECT b.id, b.title, b.state, b.shelf_range, b.current_area_id,
           a.position AS area_position, a.name AS area_name,
           f.id AS fixture_id, f.position AS fixture_position, f.name AS fixture_name,
           COALESCE(string_agg(t.slug, ',' ORDER BY t.slug), '') AS tags
      FROM books b
      LEFT JOIN area a ON a.id = b.current_area_id
      LEFT JOIN fixture f ON f.id = a.fixture_id
      LEFT JOIN book_tag bt ON bt.book_id = b.id
      LEFT JOIN tag t ON t.id = bt.tag_id
     WHERE b.state IN ('shelved', 'checked_out')
     GROUP BY b.id, b.title, b.state, b.shelf_range, b.current_area_id,
              a.position, a.name, f.id, f.position, f.name
     ORDER BY f.position, a.position, b.sort_key
  `)
  return rows
}

/** The placement rules with their conditions spelled out. */
export async function rules(client) {
  const { rows } = await client.query(`
    SELECT r.id, r.name, r.priority, r.enabled, r.area_id, r.fixture_id,
           COALESCE(string_agg(c.field || ' ' || c.operator || ' ' || c.value, ' AND ' ORDER BY c.id), '') AS conditions
      FROM placement_rule r
      LEFT JOIN rule_condition c ON c.rule_id = r.id
     GROUP BY r.id
     ORDER BY r.priority, r.id
  `)
  return rows
}

/** Moves the app has worked out and nobody has said they carried yet. */
export async function outstandingMoves(client) {
  const { rows } = await client.query(`
    SELECT m.book_id, b.title, m.shelf_range, m.from_label, m.to_label, m.made_at
      FROM outstanding_move m JOIN books b ON b.id = m.book_id
     ORDER BY m.made_at, m.book_id
  `)
  return rows
}

/**
 * The furniture the app draws, asked of the app rather than of the rows.
 *
 * Reachability is not computed here as a predicate over positions, which would
 * be a second opinion about what the app shows: it asks `GET /api/fixtures`,
 * the same endpoint the screens are drawn from.
 *
 * `areas` is a piece's face; `gone` is planks taken out of it that still carry
 * books, which the app draws on the piece's own page. A plank in neither is
 * one nobody can reach.
 */
export async function drawnFurniture(api) {
  const response = await fetch(`${api}/api/fixtures`)
  if (!response.ok) {
    throw new Error(`GET ${api}/api/fixtures answered ${response.status}`)
  }
  const body = await response.json()

  return (body.fixtures ?? []).map((piece) => ({
    fixture_id: piece.id,
    fixture_name: piece.name,
    fixture_position: piece.position,
    fixture_label: piece.label,
    books: piece.books,
    shelves: [
      ...(piece.areas ?? []).map((area) => ({ ...describeShelf(area), gone: false })),
      ...(piece.gone ?? []).map((area) => ({ ...describeShelf(area), gone: true })),
    ],
  }))
}

const describeShelf = (area) => ({
  area_id: area.id,
  area_name: area.name,
  label: area.label,
  books: area.books,
})

/**
 * Everything the three completion checks read.
 *
 * `api` is optional only so a caller with no app to ask fails the reachability
 * checks rather than passing them silently: see `tasks.mjs`, where an absent
 * drawing is a failed part, never a quiet ok.
 */
export async function worldState(connection, api = null) {
  const drawn = api ? await drawnFurniture(api) : null

  return withClient(connection, async (client) => ({
    furniture: await furniture(client),
    books: await shelvedBooks(client),
    rules: await rules(client),
    outstanding: await outstandingMoves(client),
    fingerprint: await fingerprint(client),
    drawn,
  }))
}
