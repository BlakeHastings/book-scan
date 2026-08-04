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
 * Writes only to this checkout's own web/data, never to whatever
 * BOOKSCAN_DATA happens to be set to. AGENTS.md is explicit that agents
 * must never set that variable because it is the one thing standing between
 * a dev server and the real catalogue; this script goes a step further and
 * does not even read it, so a shell that has it set for some other reason
 * cannot redirect a seed run anywhere else.
 *
 * Usage (from web/):
 *
 *     npx tsx scripts/seed-world.ts --reset
 *
 * Run it before starting Aspire. This opens its own connection to books.db
 * and closes it when done; it does not coordinate with a server that
 * already has the file open.
 *
 *   --reset   Delete web/data first, so a pass always starts from the same
 *             synthetic catalogue rather than piling more of it onto
 *             whatever was already there. Without it, the script refuses to
 *             run if web/data/books.db already exists.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { openDatabase } from '../server/db'
import { Store, type DraftBook } from '../server/store'
import { Shelves } from '../server/shelves'
import type { ShelfRange } from '../shared/shelving'
import { backCover, frontCover, spine } from '../server/fixtures'

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
const DB_PATH = join(DATA_DIR, 'books.db')
const COVER_DIR = join(DATA_DIR, 'covers')

// Belt and braces: refuse outright if the resolved path is anywhere near the
// real catalogue's directory name, however that happened.
if (/book-scan-production-data/i.test(DATA_DIR)) {
  throw new Error(`Refusing to seed "${DATA_DIR}": that looks like the production data path.`)
}

const args = process.argv.slice(2)
const reset = args.includes('--reset')
const unknown = args.filter((a) => a !== '--reset')
if (unknown.length) {
  console.error(`Unrecognised argument: ${unknown.join(' ')}\nUsage: npx tsx scripts/seed-world.ts [--reset]`)
  process.exit(2)
}

if (existsSync(DB_PATH) && !reset) {
  console.error(
    `${DB_PATH} already exists.\n` +
    'Pass --reset to delete web/data and seed a fresh world, or remove it yourself first.',
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
  isFiction: boolean
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

const FICTION: BookSeed[] = [
  { title: 'The Left Hand of Darkness', authors: ['Ursula K. Le Guin'], isFiction: true, publisher: 'Ace Books', published: '1969', pages: '304' },
  { title: 'The Dispossessed', authors: ['Ursula K. Le Guin'], isFiction: true, publisher: 'Harper & Row', published: '1974', pages: '341' },
  { title: 'A Wizard of Earthsea', authors: ['Ursula K. Le Guin'], isFiction: true, publisher: 'Parnassus Press', published: '1968', pages: '183', seriesName: 'Earthsea', seriesIndex: 1 },
  { title: 'Neuromancer', authors: ['William Gibson'], isFiction: true, publisher: 'Ace Books', published: '1984', pages: '271', noCover: true },
  { title: 'Snow Crash', authors: ['Neal Stephenson'], isFiction: true, publisher: 'Bantam Books', published: '1992', pages: '470' },
  { title: 'The Player of Games', authors: ['Iain M. Banks'], isFiction: true, publisher: 'Macmillan', published: '1988', pages: '325', seriesName: 'Culture', seriesIndex: 2 },
  { title: 'Dune', authors: ['Frank Herbert'], isFiction: true, publisher: 'Chilton Books', published: '1965', pages: '412', seriesName: 'Dune', seriesIndex: 1 },
  { title: 'Dune Messiah', authors: ['Frank Herbert'], isFiction: true, publisher: 'Putnam', published: '1969', pages: '256', seriesName: 'Dune', seriesIndex: 2 },
  { title: 'Children of Dune', authors: ['Frank Herbert'], isFiction: true, publisher: 'Putnam', published: '1976', pages: '444', seriesName: 'Dune', seriesIndex: 3, noSpine: true },
  { title: 'Mary Barton', authors: ['Elizabeth Gaskell'], isFiction: true, publisher: 'Chapman and Hall', published: '1848', pages: '480' },
  { title: 'Cranford', authors: ['Elizabeth Gaskell'], isFiction: true, publisher: 'Chapman and Hall', published: '1853', pages: '256', noCover: true },
  { title: 'Pride and Prejudice', authors: ['Jane Austen'], isFiction: true, publisher: 'T. Egerton', published: '1813', pages: '279' },
  { title: 'Persuasion', authors: ['Jane Austen'], isFiction: true, publisher: 'John Murray', published: '1818', pages: '264' },
  { title: 'One Hundred Years of Solitude', authors: ['Gabriel García Márquez'], isFiction: true, publisher: 'Harper & Row', published: '1967', pages: '417' },
  { title: 'Love in the Time of Cholera', authors: ['Gabriel García Márquez'], isFiction: true, publisher: 'Knopf', published: '1985', pages: '348' },
  { title: 'American Gods', authors: ['Neil Gaiman'], isFiction: true, publisher: 'William Morrow', published: '2001', pages: '465' },
  { title: 'Good Omens', authors: ['Neil Gaiman', 'Terry Pratchett'], isFiction: true, publisher: 'Gollancz', published: '1990', pages: '412' },
  { title: 'Small Gods', authors: ['Terry Pratchett'], isFiction: true, publisher: 'Gollancz', published: '1992', pages: '373', seriesName: 'Discworld', seriesIndex: 13 },
  { title: 'Guards! Guards!', authors: ['Terry Pratchett'], isFiction: true, publisher: 'Gollancz', published: '1989', pages: '350', seriesName: 'Discworld', seriesIndex: 8, noSpine: true },
  { title: 'The Hobbit', authors: ['J. R. R. Tolkien'], isFiction: true, publisher: 'George Allen & Unwin', published: '1937', pages: '310' },
  { title: 'The Fellowship of the Ring', authors: ['J. R. R. Tolkien'], isFiction: true, publisher: 'George Allen & Unwin', published: '1954', pages: '423', seriesName: 'The Lord of the Rings', seriesIndex: 1 },
  { title: 'The Two Towers', authors: ['J. R. R. Tolkien'], isFiction: true, publisher: 'George Allen & Unwin', published: '1954', pages: '352', seriesName: 'The Lord of the Rings', seriesIndex: 2 },
  { title: 'The Return of the King', authors: ['J. R. R. Tolkien'], isFiction: true, publisher: 'George Allen & Unwin', published: '1955', pages: '416', seriesName: 'The Lord of the Rings', seriesIndex: 3 },
  { title: 'Kindred', authors: ['Octavia E. Butler'], isFiction: true, publisher: 'Doubleday', published: '1979', pages: '287' },
  { title: 'Parable of the Sower', authors: ['Octavia E. Butler'], isFiction: true, publisher: 'Four Walls Eight Windows', published: '1993', pages: '299', noCover: true },
  { title: 'The Remains of the Day', authors: ['Kazuo Ishiguro'], isFiction: true, publisher: 'Faber and Faber', published: '1989', pages: '245' },
  { title: 'Never Let Me Go', authors: ['Kazuo Ishiguro'], isFiction: true, publisher: 'Faber and Faber', published: '2005', pages: '288' },
  { title: 'Beloved', authors: ['Toni Morrison'], isFiction: true, publisher: 'Alfred A. Knopf', published: '1987', pages: '324' },
  { title: 'Song of Solomon', authors: ['Toni Morrison'], isFiction: true, publisher: 'Alfred A. Knopf', published: '1977', pages: '337' },
  { title: 'Slaughterhouse-Five', authors: ['Kurt Vonnegut'], isFiction: true, publisher: 'Delacorte Press', published: '1969', pages: '275' },
  { title: "Cat's Cradle", authors: ['Kurt Vonnegut'], isFiction: true, publisher: 'Holt, Rinehart and Winston', published: '1963', pages: '287' },
]

const NONFICTION: BookSeed[] = [
  { title: 'Sapiens', subtitle: 'A Brief History of Humankind', authors: ['Yuval Noah Harari'], isFiction: false, publisher: 'Harvill Secker', published: '2011', pages: '443' },
  { title: 'Homo Deus', subtitle: 'A Brief History of Tomorrow', authors: ['Yuval Noah Harari'], isFiction: false, publisher: 'Harvill Secker', published: '2015', pages: '450' },
  { title: 'The Selfish Gene', authors: ['Richard Dawkins'], isFiction: false, publisher: 'Oxford University Press', published: '1976', pages: '224' },
  { title: 'A Brief History of Time', authors: ['Stephen Hawking'], isFiction: false, publisher: 'Bantam Books', published: '1988', pages: '212', noCover: true },
  { title: 'Cosmos', authors: ['Carl Sagan'], isFiction: false, publisher: 'Random House', published: '1980', pages: '365' },
  { title: 'The Demon-Haunted World', subtitle: 'Science as a Candle in the Dark', authors: ['Carl Sagan'], isFiction: false, publisher: 'Random House', published: '1995', pages: '457', noSpine: true },
  { title: 'Silent Spring', authors: ['Rachel Carson'], isFiction: false, publisher: 'Houghton Mifflin', published: '1962', pages: '368' },
  { title: 'The Sixth Extinction', subtitle: 'An Unnatural History', authors: ['Elizabeth Kolbert'], isFiction: false, publisher: 'Henry Holt', published: '2014', pages: '319' },
  { title: 'Braiding Sweetgrass', authors: ['Robin Wall Kimmerer'], isFiction: false, publisher: 'Milkweed Editions', published: '2013', pages: '408' },
  { title: 'The Immortal Life of Henrietta Lacks', authors: ['Rebecca Skloot'], isFiction: false, publisher: 'Crown', published: '2010', pages: '381' },
  { title: 'Educated', authors: ['Tara Westover'], isFiction: false, publisher: 'Random House', published: '2018', pages: '334' },
  { title: 'Born a Crime', authors: ['Trevor Noah'], isFiction: false, publisher: 'Spiegel & Grau', published: '2016', pages: '304', noCover: true },
  { title: 'On Writing', subtitle: 'A Memoir of the Craft', authors: ['Stephen King'], isFiction: false, publisher: 'Scribner', published: '2000', pages: '288' },
  { title: 'Bird by Bird', subtitle: 'Some Instructions on Writing and Life', authors: ['Anne Lamott'], isFiction: false, publisher: 'Anchor Books', published: '1994', pages: '237' },
  { title: 'The Elements of Style', authors: ['William Strunk Jr.', 'E. B. White'], isFiction: false, publisher: 'Macmillan', published: '1959', pages: '105' },
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
    isFiction: book.isFiction,
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

/**
 * Shelve one book: save it, then record where it landed, exactly as
 * POST /api/books does when nobody sends an explicit location. Returns the
 * new row's id.
 */
async function shelveBook(store: Store, shelves: Shelves, draft: DraftBook): Promise<number> {
  const { id, placement } = await store.addBook(draft)
  const landed = await shelves.labelFor(placement.range, id)
  if (landed) await store.setLocation(id, landed)
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

  const result = await shelves.overflow(range, last.label, kind)
  if (result.ok && result.step) {
    await store.setLocation(result.step.moved.id, result.step.to)
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
  status: 'pending' | 'ready' | 'failed' | 'done'
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

function insertCapture(db: ReturnType<typeof openDatabase>, fields: CaptureFields): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO captures (
       status, front_image, back_image, edge_image, isbn13, isbn10,
       isbn_source, title_guess, cover_text, analysed, draft_json, edit_json,
       edited_by, edited_at, note, claimed_by, claimed_at, created_at
     ) VALUES (
       @status, @front_image, @back_image, @edge_image, @isbn13, @isbn10,
       @isbn_source, @title_guess, @cover_text, @analysed, @draft_json, @edit_json,
       @edited_by, @edited_at, @note, @claimed_by, @claimed_at, @created_at
     )`,
  ).run({
    status: fields.status,
    front_image: fields.front_image ?? '',
    back_image: fields.back_image ?? '',
    edge_image: fields.edge_image ?? '',
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
  })
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
      isFiction: book.isFiction,
      confidence: 'high',
      reason: 'Seeded for a hunting pass.',
    },
    notes: [],
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (reset) {
    rmSync(DATA_DIR, { recursive: true, force: true })
  }
  mkdirSync(COVER_DIR, { recursive: true })

  const db = openDatabase(DB_PATH)
  const store = new Store(db)
  const shelves = new Shelves(db)

  console.log('')
  console.log('  Seeding a throwaway world')
  console.log('  ' + '-'.repeat(60))
  console.log(`  data directory  ${DATA_DIR}`)
  console.log('  ' + '-'.repeat(60))
  console.log('')

  // -------------------------------------------------------------------------
  // Shelved library: 14 fiction across two bookcases, 8 non-fiction on one,
  // several areas each, one book left alone in the last area of each range,
  // a couple checked out.
  // -------------------------------------------------------------------------

  const shelvedFiction = FICTION.slice(0, 14)
  const shelvedNonfiction = NONFICTION.slice(0, 8)

  const fictionIds: number[] = []
  for (const book of shelvedFiction) {
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    const draft = draftFor(book, isbn13, photos)
    const id = await shelveBook(store, shelves, draft)
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
    const id = await shelveBook(store, shelves, draft)
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

  const queueFiction = FICTION.slice(14)
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
    insertCapture(db, {
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
    insertCapture(db, {
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
    insertCapture(db, {
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
    insertCapture(db, {
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
    insertCapture(db, { status: 'pending', back_image: back })
    captureCount += 1
  }

  // Pending with only the front cover: no barcode at all yet, which is the
  // shape that forces the OCR path rather than the fast barcode one.
  for (let i = 0; i < 2; i += 1) {
    const book = nextBook()
    const front = saveImage(await toJpeg(await frontCover(book.title, book.authors.join(', '))), '', 'front')
    insertCapture(db, { status: 'pending', front_image: front })
    captureCount += 1
  }

  // Already failed: read, but nothing usable came of it. The kind of row
  // that needs "Change ISBN" or a manual entry, not a re-scan.
  for (let i = 0; i < 2; i += 1) {
    const book = nextBook()
    const isbn13 = nextIsbn13()
    const photos = await photograph(book, isbn13)
    insertCapture(db, {
      status: 'failed',
      front_image: photos.front,
      back_image: photos.back,
      edge_image: photos.edge,
      analysed: 'back,front,edge',
      note: 'No ISBN could be read from these photos.',
      cover_text: book.title,
    })
    captureCount += 1
  }

  db.close()

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
