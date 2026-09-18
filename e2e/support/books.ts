/**
 * THE BOOK IN HAND's ISBN is baked into the barcode on the generated cover
 * and into the stubbed catalogue reply, so the test knows what the camera
 * will read before the browser starts. The rest are seeded through the real
 * API as shelf furniture to place it between.
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

/** Dune, with a real ISBN-13 whose check digit is valid: bwip-js refuses to draw an EAN-13 that is not. */
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
 * Chosen so the book in hand files between them, in order: Clarke, Gibson,
 * Herbert, Le Guin. Le Guin exercises the filing heuristic on "Le Guin, Ursula
 * K.", and Gibson sits immediately before the book in hand so a scenario can
 * place it at the end of a plank that already has a book on it.
 *
 * Stephenson, Strugatsky and Zusak file after the book in hand and give a
 * cascade enough planks, several deep, to be asked to descend twice.
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
  {
    isbn13: '9780553380958',
    isbn10: '0553380958',
    title: 'Snow Crash',
    authors: ['Neal Stephenson'],
    filing: 'Stephenson, Neal',
    publisher: 'Bantam',
    published: '2000',
    pages: '440',
    categories: ['Fiction / Science Fiction / General'],
    subjects: ['Science fiction', 'Fiction'],
  },
  {
    isbn13: '9781613743416',
    isbn10: '1613743416',
    title: 'Roadside Picnic',
    authors: ['Arkady Strugatsky'],
    filing: 'Strugatsky, Arkady',
    publisher: 'Chicago Review Press',
    published: '2012',
    pages: '224',
    categories: ['Fiction / Science Fiction / General'],
    subjects: ['Science fiction', 'Fiction'],
  },
  {
    isbn13: '9780375842207',
    isbn10: '0375842209',
    title: 'The Book Thief',
    authors: ['Markus Zusak'],
    filing: 'Zusak, Markus',
    publisher: 'Knopf',
    published: '2006',
    pages: '552',
    categories: ['Fiction / General'],
    subjects: ['Fiction'],
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
