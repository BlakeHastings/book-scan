/**
 * Seed a realistic, throwaway world for an agent to catalogue books against:
 * a shelved library across several bookcases and areas, and a queue of
 * captures at various stages, some deliberately awkward. See
 * docs/process/agent-hunting-pass.md for how to run a pass against it.
 *
 * Everything here is synthetic. Titles and authors are real so the world
 * reads like a library rather than "Book 7", but every ISBN is generated
 * with a valid check digit and answers to no real catalogue entry, and
 * every cover, spine and back photo is rendered by server/fixtures.ts, the
 * same generator the test suite uses. Nothing here calls Open Library,
 * Google Books or any other network origin.
 *
 * The photographs go only to this checkout's own web/data, never to whatever
 * BOOKSCAN_DATA happens to be set to. AGENTS.md is explicit that agents
 * must never set that variable because it is the one thing standing between
 * a dev server and the real catalogue; this script goes a step further and
 * does not even read it, so a shell that has it set for some other reason
 * cannot redirect a seed run anywhere else.
 *
 * **The rows go to a Postgres named on the command line, and to nothing
 * else.** It deliberately does not read `ConnectionStrings__bookscan`, for
 * the same reason `backup-catalogue.ts` does not: this script writes, and a
 * connection string that happens to be in a shell should not be able to
 * decide what gets written to. `BOOKSCAN_SEED_TARGET` is accepted instead of
 * `--target` if you would rather not put a password in shell history.
 *
 * Usage (from web/):
 *
 *     aspire start --non-interactive      # from the repo root, once
 *     aspire describe                     # read the api's connection string
 *     npx tsx scripts/seed-world.ts --reset --target '<connection>'
 *
 * Stage I changed the order here. The catalogue used to be a file this could
 * create before anything was running; it is a database the AppHost
 * provisions, so the AppHost starts first and hands out the connection.
 *
 *   --reset   Empty the catalogue and delete web/data first, so a pass always
 *             starts from the same synthetic world rather than piling more of
 *             it onto whatever was already there. Without it, the script
 *             refuses to run against a target that already holds books.
 *             That is the queue as well as the shelves since #183, which
 *             dissolved the captures table into early states on `books`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { describeConnection, openPostgres } from '../server/db.pg'
import type { Db } from '../server/driver'
import { Store, type DraftBook } from '../server/store'
import { DrizzleAuthorRepository } from '../infrastructure/authorship/author-repository'
import { Shelves } from '../server/shelves'
import { photographsTaken } from '../server/photographs'
import type { ShelfRange } from '../shared/shelving'
import { backCover, frontCover, spine } from '../server/fixtures'
import { STATE_OF_QUEUE_STATUS } from '../domain/books/state'
import {
  FICTION_SLUG, NON_FICTION_SLUG, type GenreSlug,
} from '../domain/tagging/catalogue-claims'
/*
 * The same two steps every real save takes beyond writing the row (#234): a
 * genre tag settled and author credits recorded. Reused from
 * `server/book-save.ts` rather than restated here, which is what kept a
 * seeded shelved book from carrying either until this existed, building a
 * world the current model, since #223 and #227, cannot place. See
 * `shelveBook` below.
 */
import { recordCredits, settleGenre } from '../server/book-save'
import { RestateTagsHandler } from '../application/tagging/restate-tags'
import { DrizzleTagRepository } from '../infrastructure/tagging/tag-repository'
import { DbBookTransactions } from '../infrastructure/tagging/transactions'
import { CreditBookHandler } from '../application/authorship/credit-book'
import { FileAliasHandler } from '../application/authorship/curate-authors'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(HERE, '..')

// Deliberately not process.env.BOOKSCAN_DATA. That variable exists so a test
// run or an Aspire run can point the *server* somewhere other than its
// default, and reading it here would make this script capable of the one
// thing AGENTS.md says never to do: writing generated data over a path
// somebody else chose, which could be the production catalogue. This always
// writes to this checkout's own web/data, exactly what a plain
// `aspire start` (outside an e2e run) uses.
const DATA_DIR = join(WEB_DIR, 'data')
const COVER_DIR = join(DATA_DIR, 'covers')

const USAGE = "Usage: npx tsx scripts/seed-world.ts [--reset] --target '<connection>'"

// Belt and braces: refuse outright if the resolved path is anywhere near the
// real catalogue's directory name, however that happened.
if (/book-scan-production-data/i.test(DATA_DIR)) {
  throw new Error(`Refusing to seed "${DATA_DIR}": that looks like the production data path.`)
}

const args = process.argv.slice(2)
const reset = args.includes('--reset')
const targetAt = args.indexOf('--target')
const unknown = args.filter((a, index) =>
  a !== '--reset' && a !== '--target' && args[index - 1] !== '--target')
if (unknown.length) {
  console.error(`Unrecognised argument: ${unknown.join(' ')}\n${USAGE}`)
  process.exit(2)
}

const TARGET = (targetAt >= 0 ? args[targetAt + 1] : process.env.BOOKSCAN_SEED_TARGET) ?? ''
if (!TARGET) {
  console.error(
    'No target. This writes rows, so it will not take one from the environment ' +
    'the app is running in.\n' +
    'Start the AppHost, read the api resource\'s connection out of `aspire describe`, ' +
    `and pass it.\n${USAGE}`,
  )
  process.exit(2)
}

// The same belt and braces the data directory gets. AGENTS.md names the live
// catalogue as 127.0.0.1:5433, and a synthetic world written over it is the
// one mistake this script must not be able to make.
if (/(?::|Port\s*=\s*)5433\b/i.test(TARGET)) {
  console.error(
    'Refusing that target: port 5433 is the live catalogue (see AGENTS.md). ' +
    'Seed the Postgres the AppHost started for this checkout.',
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// The book pool
// ---------------------------------------------------------------------------

interface BookSeed {
  title: string
  subtitle?: string
  authors: string[]
  genre: GenreSlug
  publisher: string
  published: string
  pages: string
  seriesName?: string
  seriesIndex?: number
  /** No spine photo, as if the scan was interrupted before the third shot. */
  noSpine?: boolean
  /** No publisher cover, as if the backfill asked and came up empty. */
  noCover?: boolean
}

/**
 * How much of the fiction list is shelved. Everything past it is the queue.
 *
 * Named because the boundary is load-bearing: a seed added after it is a
 * capture, not a book on a shelf, so nothing that orders books ever sees it.
 */
const SHELVED_FICTION = 19

const FICTION: BookSeed[] = [
  { title: 'The Left Hand of Darkness', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG, publisher: 'Ace Books', published: '1969', pages: '304' },
  { title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG, publisher: 'Harper & Row', published: '1974', pages: '341' },
  { title: 'A Wizard of Earthsea', authors: ['Ursula K. Le Guin'], genre: FICTION_SLUG, publisher: 'Parnassus Press', published: '1968', pages: '183', seriesName: 'Earthsea', seriesIndex: 1 },
  { title: 'Neuromancer', authors: ['William Gibson'], genre: FICTION_SLUG, publisher: 'Ace Books', published: '1984', pages: '271', noCover: true },
  { title: 'Snow Crash', authors: ['Neal Stephenson'], genre: FICTION_SLUG, publisher: 'Bantam Books', published: '1992', pages: '470' },
  { title: 'The Player of Games', authors: ['Iain M. Banks'], genre: FICTION_SLUG, publisher: 'Macmillan', published: '1988', pages: '325', seriesName: 'Culture', seriesIndex: 2 },
  { title: 'Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, publisher: 'Chilton Books', published: '1965', pages: '412', seriesName: 'Dune', seriesIndex: 1 },
  { title: 'Dune Messiah', authors: ['Frank Herbert'], genre: FICTION_SLUG, publisher: 'Putnam', published: '1969', pages: '256', seriesName: 'Dune', seriesIndex: 2 },
  { title: 'Children of Dune', authors: ['Frank Herbert'], genre: FICTION_SLUG, publisher: 'Putnam', published: '1976', pages: '444', seriesName: 'Dune', seriesIndex: 3, noSpine: true },
  { title: 'Mary Barton', authors: ['Elizabeth Gaskell'], genre: FICTION_SLUG, publisher: 'Chapman and Hall', published: '1848', pages: '480' },
  { title: 'Cranford', authors: ['Elizabeth Gaskell'], genre: FICTION_SLUG, publisher: 'Chapman and Hall', published: '1853', pages: '256', noCover: true },
  { title: 'Pride and Prejudice', authors: ['Jane Austen'], genre: FICTION_SLUG, publisher: 'T. Egerton', published: '1813', pages: '279' },
  { title: 'Persuasion', authors: ['Jane Austen'], genre: FICTION_SLUG, publisher: 'John Murray', published: '1818', pages: '264' },
  { title: 'One Hundred Years of Solitude', authors: ['Gabriel García Márquez'], genre: FICTION_SLUG, publisher: 'Harper & Row', published: '1967', pages: '417' },
  // Translated classics, with the author written the way Open Library actually
  // answers for these editions: in the script the book was written in. Three
  // scripts and one half-transliterated name, because they behave differently
  // and the mixed one is the surprising one. #195 was found by a pass over this
  // world, and a world with none of these in it cannot find it again.
  //
  // They are here rather than at the end of the list because everything past
  // SHELVED_FICTION goes to the queue, and a book in the queue has no sort key
  // and no shelf to be filed wrongly on.
  { title: 'Crime and Punishment', authors: ['Фёдор Достоевский'], genre: FICTION_SLUG, publisher: 'Penguin Classics', published: '1866', pages: '671' },
  { title: 'The Brothers Karamazov', authors: ['Фёдор Достоевский'], genre: FICTION_SLUG, publisher: 'Penguin Classics', published: '1880', pages: '985', noCover: true },
  { title: 'Norwegian Wood', authors: ['村上春樹'], genre: FICTION_SLUG, publisher: 'Vintage', published: '1987', pages: '389' },
  { title: 'Zorba the Greek', authors: ['Νίκος Καζαντζάκης'], genre: FICTION_SLUG, publisher: 'Faber and Faber', published: '1946', pages: '320', noSpine: true },
  { title: 'The Master and Margarita', authors: ['Mikhail Булгаков'], genre: FICTION_SLUG, publisher: 'Penguin Classics', published: '1967', pages: '412' },
  { title: 'Love in the Time of Cholera', authors: ['Gabriel García Márquez'], genre: FICTION_SLUG, publisher: 'Knopf', published: '1985', pages: '348' },
  { title: 'American Gods', authors: ['Neil Gaiman'], genre: FICTION_SLUG, publisher: 'William Morrow', published: '2001', pages: '465' },
  { title: 'Good Omens', authors: ['Neil Gaiman', 'Terry Pratchett'], genre: FICTION_SLUG, publisher: 'Gollancz', published: '1990', pages: '412' },
  { title: 'Small Gods', authors: ['Terry Pratchett'], genre: FICTION_SLUG, publisher: 'Gollancz', published: '1992', pages: '373', seriesName: 'Discworld', seriesIndex: 13 },
  { title: 'Guards! Guards!', authors: ['Terry Pratchett'], genre: FICTION_SLUG, publisher: 'Gollancz', published: '1989', pages: '350', seriesName: 'Discworld', seriesIndex: 8, noSpine: true },
  { title: 'The Hobbit', authors: ['J. R. R. Tolkien'], genre: FICTION_SLUG, publisher: 'George Allen & Unwin', published: '1937', pages: '310' },
  { title: 'The Fellowship of the Ring', authors: ['J. R. R. Tolkien'], genre: FICTION_SLUG, publisher: 'George Allen & Unwin', published: '1954', pages: '423', seriesName: 'The Lord of the Rings', seriesIndex: 1 },
  { title: 'The Two Towers', authors: ['J. R. R. Tolkien'], genre: FICTION_SLUG, publisher: 'George Allen & Unwin', published: '1954', pages: '352', seriesName: 'The Lord of the Rings', seriesIndex: 2 },
  { title: 'The Return of the King', authors: ['J. R. R. Tolkien'], genre: FICTION_SLUG, publisher: 'George Allen & Unwin', published: '1955', pages: '416', seriesName: 'The Lord of the Rings', seriesIndex: 3 },
  { title: 'Kindred', authors: ['Octavia E. Butler'], genre: FICTION_SLUG, publisher: 'Doubleday', published: '1979', pages: '287' },
  { title: 'Parable of the Sower', authors: ['Octavia E. Butler'], genre: FICTION_SLUG, publisher: 'Four Walls Eight Windows', published: '1993', pages: '299', noCover: true },
  { title: 'The Remains of the Day', authors: ['Kazuo Ishiguro'], genre: FICTION_SLUG, publisher: 'Faber and Faber', published: '1989', pages: '245' },
  { title: 'Never Let Me Go', authors: ['Kazuo Ishiguro'], genre: FICTION_SLUG, publisher: 'Faber and Faber', published: '2005', pages: '288' },
  { title: 'Beloved', authors: ['Toni Morrison'], genre: FICTION_SLUG, publisher: 'Alfred A. Knopf', published: '1987', pages: '324' },
  { title: 'Song of Solomon', authors: ['Toni Morrison'], genre: FICTION_SLUG, publisher: 'Alfred A. Knopf', published: '1977', pages: '337' },
  { title: 'Slaughterhouse-Five', authors: ['Kurt Vonnegut'], genre: FICTION_SLUG, publisher: 'Delacorte Press', published: '1969', pages: '275' },
  { title: "Cat's Cradle", authors: ['Kurt Vonnegut'], genre: FICTION_SLUG, publisher: 'Holt, Rinehart and Winston', published: '1963', pages: '287' },
]

const NONFICTION: BookSeed[] = [
  { title: 'Sapiens', subtitle: 'A Brief History of Humankind', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG, publisher: 'Harvill Secker', published: '2011', pages: '443' },
  { title: 'Homo Deus', subtitle: 'A Brief History of Tomorrow', authors: ['Yuval Noah Harari'], genre: NON_FICTION_SLUG, publisher: 'Harvill Secker', published: '2015', pages: '450' },
  { title: 'The Selfish Gene', authors: ['Richard Dawkins'], genre: NON_FICTION_SLUG, publisher: 'Oxford University Press', published: '1976', pages: '224' },
  { title: 'A Brief History of Time', authors: ['Stephen Hawking'], genre: NON_FICTION_SLUG, publisher: 'Bantam Books', published: '1988', pages: '212', noCover: true },
  { title: 'Cosmos', authors: ['Carl Sagan'], genre: NON_FICTION_SLUG, publisher: 'Random House', published: '1980', pages: '365' },
  { title: 'The Demon-Haunted World', subtitle: 'Science as a Candle in the Dark', authors: ['Carl Sagan'], genre: NON_FICTION_SLUG, publisher: 'Random House', published: '1995', pages: '457', noSpine: true },
  { title: 'Silent Spring', authors: ['Rachel Carson'], genre: NON_FICTION_SLUG, publisher: 'Houghton Mifflin', published: '1962', pages: '368' },
  { title: 'The Sixth Extinction', subtitle: 'An Unnatural History', authors: ['Elizabeth Kolbert'], genre: NON_FICTION_SLUG, publisher: 'Henry Holt', published: '2014', pages: '319' },
  { title: 'Braiding Sweetgrass', authors: ['Robin Wall Kimmerer'], genre: NON_FICTION_SLUG, publisher: 'Milkweed Editions', published: '2013', pages: '408' },
  { title: 'The Immortal Life of Henrietta Lacks', authors: ['Rebecca Skloot'], genre: NON_FICTION_SLUG, publisher: 'Crown', published: '2010', pages: '381' },
  { title: 'Educated', authors: ['Tara Westover'], genre: NON_FICTION_SLUG, publisher: 'Random House', published: '2018', pages: '334' },
  { title: 'Born a Crime', authors: ['Trevor Noah'], genre: NON_FICTION_SLUG, publisher: 'Spiegel & Grau', published: '2016', pages: '304', noCover: true },
  { title: 'On Writing', subtitle: 'A Memoir of the Craft', authors: ['Stephen King'], genre: NON_FICTION_SLUG, publisher: 'Scribner', published: '2000', pages: '288' },
  { title: 'Bird by Bird', subtitle: 'Some Instructions on Writing and Life', authors: ['Anne Lamott'], genre: NON_FICTION_SLUG, publisher: 'Anchor Books', published: '1994', pages: '237' },
  { title: 'The Elements of Style', authors: ['William Strunk Jr.', 'E. B. White'], genre: NON_FICTION_SLUG, publisher: 'Macmillan', published: '1959', pages: '105' },
]

// ---------------------------------------------------------------------------
// Synthetic ISBNs
// ---------------------------------------------------------------------------

function checkDigit13(twelve: string): string {
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3)
  return String((10 - (sum % 10)) % 10)
}

let isbnCounter = 0
function nextIsbn13(): string {
  isbnCounter += 1
  const middle = String(3_000_000 + isbnCounter).padStart(9, '0')
  const twelve = `978${middle}`
  return `${twelve}${checkDigit13(twelve)}`
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

let imageCounter = 0

async function toJpeg(png: Buffer): Promise<Buffer> {
  return sharp(png).jpeg({ quality: 90 }).toBuffer()
}

function saveImage(buffer: Buffer, isbn: string, slot: 'front' | 'back' | 'edge'): string {
  imageCounter += 1
  const name = `seed_${String(imageCounter).padStart(4, '0')}_${isbn || 'noisbn'}_${slot}.jpg`
  writeFileSync(join(COVER_DIR, name), buffer)
  return name
}

interface Photos {
  front: string
  back: string
  edge: string
  cover: string
}

/**
 * Render and save the photos for one book: a front cover, a back with the
 * barcode, a spine unless `noSpine`, and a publisher-style cover unless
 * `noCover`. All from server/fixtures.ts, the same generator the unit tests
 * decode barcodes out of.
 */
async function photograph(book: BookSeed, isbn13: string): Promise<Photos> {
  const authorLine = book.authors.join(', ')

  const front = saveImage(await toJpeg(await frontCover(book.title, authorLine)), isbn13, 'front')
  const back = saveImage(await toJpeg(await backCover(isbn13)), isbn13, 'back')
  const edge = book.noSpine
    ? ''
    : saveImage(await toJpeg(await spine(book.title, authorLine)), isbn13, 'edge')
  const cover = book.noCover
    ? ''
    : saveImage(await toJpeg(await frontCover(book.title, authorLine)), isbn13, 'front')

  return { front, back, edge, cover }
}

// ---------------------------------------------------------------------------
// Shelving
// ---------------------------------------------------------------------------

function draftFor(book: BookSeed, isbn13: string, photos: Photos): DraftBook {
  return {
    isbn13,
    title: book.title,
    subtitle: book.subtitle ?? '',
    authors: book.authors,
    publisher: book.publisher,
    published: book.published,
    pages: book.pages,
    genre: book.genre,
    classificationSource: 'manual',
    classificationConfidence: 'high',
    seriesName: book.seriesName ?? '',
    seriesIndex: book.seriesIndex ?? null,
    lookupSource: 'seed',
    frontImage: photos.front,
    backImage: photos.back,
    edgeImage: photos.edge,
    isbnSource: 'barcode',
  }
}

/** What `settleGenre` and `recordCredits` need, built once in `main` and passed through. */
interface SaveDeps {
  restateTags: RestateTagsHandler
  tags: DrizzleTagRepository
  creditBook: CreditBookHandler
  authors: DrizzleAuthorRepository
  fileAlias: FileAliasHandler
}

/**
 * Shelve one book: save it, settle its genre tag, record its author credits,
 * then record where it landed, in that order, exactly as `POST /api/books`
 * does when nobody sends an explicit location. Returns the new row's id.
 *
 * The middle two steps are what this function was missing until #234: without
 * them a seeded shelved book carried no genre tag and no author credit row,
 * which is a shape `POST /api/books` itself can never produce, since #223 and
 * #227 made those the facts a book's shelf range and filing name are derived
 * from.
 */
async function shelveBook(
  store: Store, shelves: Shelves, deps: SaveDeps, draft: DraftBook,
): Promise<number> {
  const { id, placement } = await store.addBook(draft)
  await settleGenre(deps.restateTags, deps.tags, id, draft)
  await recordCredits(deps.creditBook, deps.authors, deps.fileAlias, id, draft)
  // The plank, exactly as the save route records one (#359).
  const landed = placement && await shelves.areaOf(placement.range, id)
  if (landed !== null && landed !== undefined) await store.setLocationIn(id, landed)
  return id
}

/**
 * Simulate somebody at the shelf saying "this one's full": bounce the last
 * book of the current final area onto a fresh plank, or a fresh bookcase.
 * Confirms the displaced book's new location too, the way the shelving step
 * would once that book was actually carried over, so this never leaves a
 * misfile behind by accident.
 *
 * A no-op (and no error) when the last shelf holds fewer than two books:
 * either it is already the "alone in an area" case this is sometimes called
 * to create, or there simply is not enough there yet to split.
 */
async function progressShelf(store: Store, shelves: Shelves, range: ShelfRange, kind: 'area' | 'shelf'): Promise<void> {
  const groups = await shelves.groups(range)
  const last = groups.at(-1)
  if (!last) return

  const result = await shelves.overflow(range, { shelf: last.shelf, area: last.area }, kind)
  // Recorded on the plank, not on what the plank is called. The step names its
  // destination in ordinals and the run may stand on a piece somebody has named,
  // in which case those two strings are different and only the id is the place.
  if (result.ok && result.step && result.planks?.to.areaId !== null) {
    await store.setLocationIn(result.step.moved.id, result.planks!.to.areaId!)
  }
}

/**
 * Guarantee the last area of a range holds exactly one book: the "alone in
 * an area" case the seeded world is asked to contain. Call this once, after
 * every other book in the range has already been shelved.
 */
async function isolateTail(store: Store, shelves: Shelves, range: ShelfRange): Promise<void> {
  await progressShelf(store, shelves, range, 'area')
}

// ---------------------------------------------------------------------------
// Captures
// ---------------------------------------------------------------------------

interface CaptureFields {
  /**
   * The wire vocabulary, not the state, and the same three words every call
   * site below already passes.
   *
   * `done` has gone from the union because a seeded row can never be one. It
   * meant "this capture became a book", which since #183 is a book that has
   * been shelved, and the shelved half of this world is seeded through `Store`
   * where it belongs rather than by writing a row that claims to have been
   * through a queue it never entered.
   */
  status: keyof typeof STATE_OF_QUEUE_STATUS
  front_image?: string
  back_image?: string
  edge_image?: string
  isbn13?: string
  isbn10?: string
  isbn_source?: string
  title_guess?: string
  cover_text?: string
  analysed?: string
  draft_json?: string
  edit_json?: string
  edited_by?: string
  edited_at?: string | null
  note?: string
  claimed_by?: string
  claimed_at?: string | null
}

/**
 * One book in the queue, which is a book in an early state (#183).
 *
 * Empty `title`, `shelf_range` and `sort_key`, exactly as `CaptureQueue.insert`
 * writes them and for the same reason: nobody has read this book yet, so it has
 * no title and belongs nowhere. The state keeps it out of `shelved_books` and
 * the empty shelf range keeps it out of every range there is, which is two
 * independent protections against a nameless row turning up on a seeded shelf.
 *
 * The fields this takes are still the queue's, because that is what a seeded
 * stage is described in and what the queue pane will show. The translation to
 * columns happens here, in one place, the way `queue.ts` does it at its own
 * edge.
 */
async function insertCapture(
  db: Db,
  fields: CaptureFields,
): Promise<void> {
  const now = new Date().toISOString()
  const created = await db.get<{ id: number }>(
    `INSERT INTO books (
       title, shelf_range, sort_key,
       state, isbn13, isbn10,
       isbn_source, title_guess, cover_text, analysed, draft_json, edit_json,
       edited_by, edited_at, scan_note, claimed_by, claimed_at, scanned_at
     ) VALUES (
       '', '', '',
       @status, @isbn13, @isbn10,
       @isbn_source, @title_guess, @cover_text, @analysed, @draft_json, @edit_json,
       @edited_by, @edited_at, @note, @claimed_by, @claimed_at, @created_at
     )
     RETURNING id`,
    {
      status: STATE_OF_QUEUE_STATUS[fields.status],
      isbn13: fields.isbn13 ?? '',
      isbn10: fields.isbn10 ?? '',
      isbn_source: fields.isbn_source ?? '',
      title_guess: fields.title_guess ?? '',
      cover_text: fields.cover_text ?? '',
      analysed: fields.analysed ?? '',
      draft_json: fields.draft_json ?? '',
      edit_json: fields.edit_json ?? '',
      edited_by: fields.edited_by ?? '',
      edited_at: fields.edited_at ?? null,
      note: fields.note ?? '',
      claimed_by: fields.claimed_by ?? '',
      claimed_at: fields.claimed_at ?? null,
      created_at: now,
    },
  )

  // The photographs are rows in `capture` (#228), written the same way the
  // shutter writes them, so a seeded queue is a queue rather than a set of
  // columns nothing reads.
  await photographsTaken(db, Number(created!.id), {
    front: fields.front_image,
    back: fields.back_image,
    edge: fields.edge_image,
  }, now)
}

/** The shape queue.ts stores under draft_json: a LookupResult. */
function lookupJson(book: BookSeed, isbn13: string): string {
  return JSON.stringify({
    found: true,
    title: book.title,
    subtitle: book.subtitle ?? '',
    authors: book.authors,
    publisher: book.publisher,
    published: book.published,
    pages: book.pages,
    isbn13,
    isbn10: '',
    seriesName: book.seriesName ?? '',
    seriesIndex: book.seriesIndex ?? null,
    coverUrl: '',
    source: 'seed',
    classification: {
      genre: book.genre,
      confidence: 'high',
      reason: 'Seeded for a hunting pass.',
    },
    notes: [],
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * The furniture back to what migration `0013` leaves on a fresh database: one
 * area at position 0 on each of the two fixtures a placement rule points at,
 * anchored at the empty string. Everything else standing on the floor was put
 * there by a run of this script.
 */
const RESTORE_FURNITURE = [
  'DELETE FROM area WHERE position <> 0 OR fixture_id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  'DELETE FROM fixture WHERE id NOT IN ' +
  '(SELECT fixture_id FROM placement_rule WHERE fixture_id IS NOT NULL)',
  "UPDATE area SET starts_at = '' WHERE starts_at <> ''",
]

async function main(): Promise<void> {
  if (reset) {
    rmSync(DATA_DIR, { recursive: true, force: true })
  }
  mkdirSync(COVER_DIR, { recursive: true })

  const db = await openPostgres(TARGET)

  // The same refusal `--reset` used to get from a books.db already being
  // there, moved to the thing it is now about. A world seeded on top of a
  // world is two worlds, and neither of them is the one this script describes.
  //
  // One table asked once, where it used to be books plus captures. The queue is
  // rows in `books` since #183, so the shelved half and the waiting half are
  // counted by the same COUNT and adding a second one would count the queue
  // twice.
  const existing = await db.get<{ count: string }>(
    'SELECT COUNT(*) AS count FROM books',
  )
  if (Number(existing?.count ?? 0) > 0) {
    if (!reset) {
      await db.close()
      console.error(
        `${describeConnection(TARGET)} already holds books.\n` +
        'Pass --reset to empty it and seed a fresh world, or point --target ' +
        'at an empty database.',
      )
      process.exitCode = 1
      return
    }
    // `captures` is no longer named. The table and its rows are still there and
    // nothing reads or writes them, so a script that emptied it would be
    // claiming an interest it does not have. It is emptied regardless: it holds
    // a foreign key into `books`, which CASCADE follows.
    await db.run(
      'TRUNCATE books, book_authors, author_filing, ' +
      'author, author_alias RESTART IDENTITY CASCADE',
    )
    // The furniture is not truncated and cannot be: the fixtures, the areas and
    // the two rules that file into them are seeded by migration `0013`, and the
    // seeding below expects to find the two runs standing, exactly as the app
    // does. It is put back to what that migration leaves instead, because a
    // boundary is an area since #232: without this, a `--reset` over a world
    // that had already been seeded would start the next one on the bookcases
    // and planks the last one grew. The truncate cascades to `book_placement`,
    // so nothing names an area by now, including a retired one, which is an
    // area at a negative position kept only because a placement named it.
    for (const statement of RESTORE_FURNITURE) await db.run(statement)
  }

  // Named rather than inlined into `Store`'s constructor, so the same instance
  // is what `deps` below hands to `recordCredits`: one author repository per
  // book, the way `createApp` builds one for the whole server (`server/index.ts`).
  const authorsRepo = new DrizzleAuthorRepository(db)
  const store = new Store(db, authorsRepo)
  const shelves = new Shelves(db)

  // The composition `createApp` builds for `settleGenre` and `recordCredits`
  // (server/index.ts), rebuilt here rather than imported from there: this
  // script writes rows before any app exists to have built it for. See
  // `shelveBook` and #234.
  const tagsRepo = new DrizzleTagRepository(db)
  const deps: SaveDeps = {
    restateTags: new RestateTagsHandler(tagsRepo, new DbBookTransactions(db)),
    tags: tagsRepo,
    creditBook: new CreditBookHandler(authorsRepo),
    authors: authorsRepo,
    fileAlias: new FileAliasHandler(authorsRepo),
  }

  console.log('')
  console.log('  Seeding a throwaway world')
  console.log('  ' + '-'.repeat(60))
  console.log(`  catalogue       ${describeConnection(TARGET)}`)
  console.log(`  data directory  ${DATA_DIR}`)
  console.log('  ' + '-'.repeat(60))
  console.log('')

  // -------------------------------------------------------------------------
  // Shelved library: 19 fiction across two bookcases, 8 non-fiction on one,
  // several areas each, one book left alone in the last area of each range,
  // a couple checked out.
  // -------------------------------------------------------------------------

  const shelvedFiction = FICTION.slice(0, SHELVED_FICTION)
  const shelvedNonfiction = NONFICTION.slice(0, 8)

  const fictionIds: number[] = []
  for (const book of shelvedFiction) {
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    const draft = draftFor(book, isbn13, photos)
    const id = await shelveBook(store, shelves, deps, draft)
    if (!book.noCover) await store.setCoverImage(id, photos.cover)
    else await store.setCoverImage(id, '') // looked for, found nothing: matches a real backfill result
    fictionIds.push(id)

    if (fictionIds.length === 4) await progressShelf(store, shelves, 'fiction', 'area')
    if (fictionIds.length === 8) await progressShelf(store, shelves, 'fiction', 'shelf') // second bookcase
    if (fictionIds.length === 11) await progressShelf(store, shelves, 'fiction', 'area')
  }
  await isolateTail(store, shelves, 'fiction')

  const nonfictionIds: number[] = []
  for (const book of shelvedNonfiction) {
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    const draft = draftFor(book, isbn13, photos)
    const id = await shelveBook(store, shelves, deps, draft)
    if (!book.noCover) await store.setCoverImage(id, photos.cover)
    else await store.setCoverImage(id, '')
    nonfictionIds.push(id)

    if (nonfictionIds.length === 3) await progressShelf(store, shelves, 'nonfiction', 'area')
    if (nonfictionIds.length === 6) await progressShelf(store, shelves, 'nonfiction', 'area')
  }
  await isolateTail(store, shelves, 'nonfiction')

  // A couple of books off the shelf entirely: catalogued, photographed, but
  // not currently on a plank.
  const checkedOut = [fictionIds[2], nonfictionIds[1]].filter((id): id is number => id !== undefined)
  for (const id of checkedOut) await store.setCheckedOut(id, true)

  // -------------------------------------------------------------------------
  // Capture queue: 18 captures at various stages, drawn from the books not
  // used on the shelves so the queue and the library never name the same
  // copy twice.
  // -------------------------------------------------------------------------

  const queueFiction = FICTION.slice(SHELVED_FICTION)
  const queueNonfiction = NONFICTION.slice(8)
  const queuePool = [...queueFiction, ...queueNonfiction]
  let poolIndex = 0
  const nextBook = (): BookSeed => {
    const book = queuePool[poolIndex % queuePool.length]!
    poolIndex += 1
    return book
  }

  let captureCount = 0

  // Fully resolved, ready to shelve in one tap. This is the common case: the
  // worker read the barcode, the catalogue answered, nobody has looked yet.
  for (let i = 0; i < 6; i += 1) {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    await insertCapture(db, {
      status: 'ready',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
      isbn13,
      isbn_source: 'barcode',
      title_guess: book.title,
      analysed: photos.edge ? 'back,front,edge' : 'back,front',
      draft_json: lookupJson(book, isbn13),
    })
    captureCount += 1
  }

  // Resolved, and a person has already corrected one field and left a note,
  // the way "resolving and shelving can be two people" is meant to work: the
  // next person to open this capture should see the correction already
  // applied, not the worker's original guess.
  {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    const correctedPages = String(Number(book.pages) + 4)
    await insertCapture(db, {
      status: 'ready',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
      isbn13,
      isbn_source: 'barcode',
      title_guess: book.title,
      analysed: photos.edge ? 'back,front,edge' : 'back,front',
      draft_json: lookupJson(book, isbn13),
      edit_json: JSON.stringify({ pages: correctedPages, notes: 'Page count on the copyright page, not the back cover.' }),
      edited_by: 'sam',
      edited_at: new Date().toISOString(),
    })
    captureCount += 1
  }

  // Currently claimed by somebody mid-review. Opening this in a second tab
  // should be refused.
  {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    await insertCapture(db, {
      status: 'ready',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
      isbn13,
      isbn_source: 'barcode',
      title_guess: book.title,
      analysed: photos.edge ? 'back,front,edge' : 'back,front',
      draft_json: lookupJson(book, isbn13),
      claimed_by: 'alex',
      claimed_at: new Date().toISOString(),
    })
    captureCount += 1
  }

  // Genuinely pending: all three photos present, nothing read yet. Once the
  // server starts, the background worker drains these for real: real
  // barcode decoding, and a real (network) catalogue lookup that these
  // synthetic ISBNs will not be found by, which is what turns most of them
  // into a realistic 'failed' a few seconds after the app comes up rather
  // than a book that was simply never looked at.
  for (let i = 0; i < 3; i += 1) {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    await insertCapture(db, {
      status: 'pending',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
    })
    captureCount += 1
  }

  // Pending with only the barcode shot so far, as if the scan was
  // interrupted before the front and spine.
  for (let i = 0; i < 3; i += 1) {
    const isbn13 = nextIsbn13()
    const back = saveImage(await toJpeg(await backCover(isbn13)), isbn13, 'back')
    await insertCapture(db, { status: 'pending', back_image: back })
    captureCount += 1
  }

  // Pending with only the front cover: no barcode at all yet, which is the
  // shape that forces the OCR path rather than the fast barcode one.
  for (let i = 0; i < 2; i += 1) {
    const book = nextBook()
    const front = saveImage(await toJpeg(await frontCover(book.title, book.authors.join(', '))), '', 'front')
    await insertCapture(db, { status: 'pending', front_image: front })
    captureCount += 1
  }

  // Already failed: read, but nothing usable came of it. The kind of row
  // that needs "Change ISBN" or a manual entry, not a re-scan.
  for (let i = 0; i < 2; i += 1) {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    await insertCapture(db, {
      status: 'failed',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
      analysed: 'back,front,edge',
      note: 'No ISBN could be read from these photos.',
      cover_text: book.title,
      // What the worker actually writes beside cover_text: its first line.
      // Without it these rows seeded a capture that cannot happen, one the
      // OCR read a cover for and drew no name from, and the queue drew them
      // as "Book #12" when the real thing carries a guess (#156).
      title_guess: book.title,
    })
    captureCount += 1
  }

  await db.close()

  console.log(`  Shelved:  ${fictionIds.length} fiction, ${nonfictionIds.length} non-fiction (${checkedOut.length} checked out)`)
  console.log(`  Queue:    ${captureCount} captures`)
  console.log('')
  console.log('  Next: aspire start --non-interactive, then aspire wait api && aspire wait web')
  console.log('')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
