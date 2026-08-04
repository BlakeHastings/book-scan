/**
 * The books this suite knows about.
 *
 * One of them, THE BOOK IN HAND, is what the fake camera is pointed at for
 * every scenario. Its ISBN is baked into the barcode on the generated cover
 * and into the stubbed catalogue reply, which is the whole trick: the test
 * knows what the camera is about to read before the browser starts.
 *
 * The rest are shelf furniture. They are seeded through the real API so a
 * placement has something to be placed between.
 */

export interface StubBook {
  isbn13: string
  isbn10: string
  title: string
  authors: string[]
  /** What the app should file it under, once the heuristic has had it. */
  filing: string
  publisher: string
  published: string
  pages: string
  /** Google Books categories. The first one decides fiction or not. */
  categories: string[]
  /** Open Library subjects. */
  subjects: string[]
}

/**
 * The book held up to the camera.
 *
 * Dune, with a real ISBN-13 whose check digit is valid, because bwip-js
 * refuses to draw an EAN-13 that is not.
 */
export const BOOK_IN_HAND: StubBook = {
  isbn13: '9780441013593',
  isbn10: '0441013597',
  title: 'Dune',
  authors: ['Frank Herbert'],
  filing: 'Herbert, Frank',
  publisher: 'Ace Books',
  published: '2005',
  pages: '604',
  categories: ['Fiction / Science Fiction / Space Opera'],
  subjects: ['Science fiction', 'Fiction'],
}

/**
 * Books that already sit on the shelves, chosen so the book in hand files
 * between them: Clarke, then Gibson, then Herbert, then Le Guin.
 *
 * Le Guin is not decoration either. "Le Guin, Ursula K." is the case the
 * filing heuristic has to get right, and a test that only ever files "Smith,
 * John" would not notice if it stopped.
 *
 * Gibson earns his place by sitting immediately before the book in hand, which
 * is what lets a scenario put the new book at the END of a plank with another
 * book still on it. Without him the only arrangements available are the book
 * in hand in the middle, or alone with nothing to its left.
 */
export const SHELVED_BOOKS: StubBook[] = [
  {
    isbn13: '9780553287899',
    isbn10: '0553287893',
    title: 'Rendezvous with Rama',
    authors: ['Arthur C. Clarke'],
    filing: 'Clarke, Arthur C.',
    publisher: 'Bantam',
    published: '1990',
    pages: '243',
    categories: ['Fiction / Science Fiction / General'],
    subjects: ['Science fiction', 'Fiction'],
  },
  {
    isbn13: '9780441569595',
    isbn10: '0441569595',
    title: 'Neuromancer',
    authors: ['William Gibson'],
    filing: 'Gibson, William',
    publisher: 'Ace Books',
    published: '1984',
    pages: '271',
    categories: ['Fiction / Science Fiction / General'],
    subjects: ['Science fiction', 'Fiction'],
  },
  {
    isbn13: '9780060512750',
    isbn10: '0060512755',
    title: 'The Dispossessed',
    authors: ['Ursula K. Le Guin'],
    filing: 'Le Guin, Ursula K.',
    publisher: 'Harper Voyager',
    published: '2003',
    pages: '387',
    categories: ['Fiction / Science Fiction / General'],
    subjects: ['Science fiction', 'Fiction'],
  },
]

export const ALL_STUB_BOOKS = [BOOK_IN_HAND, ...SHELVED_BOOKS]

export function stubBookByTitle(title: string): StubBook {
  const found = ALL_STUB_BOOKS.find((book) => book.title === title)
  if (!found) {
    throw new Error(
      `No stub book called "${title}". Known: ` +
      ALL_STUB_BOOKS.map((book) => book.title).join(', '),
    )
  }
  return found
}
