/**
 * The two national catalogues #305 adds, and the MARC records they answer with.
 *
 * `docs/catalogue-sources.md` asked five candidate sources about all 238 books
 * in the real catalogue and recommended exactly these two. Between them Library
 * of Congress and K10plus reach **all 15 of the genres and 33 of the 55 page
 * counts** the catalogue does not hold, both without a key, and every one of the
 * 65 records they returned for a claimed gain was verified as the same book.
 * Three other candidates were measured and are not here on purpose:
 *
 * - **Deutsche Nationalbibliothek** answered for 14 books and most of those
 *   answers were a different book entirely. Its apparent contribution of nine
 *   authors was nine mistakes. Measured, refused on accuracy rather than terms.
 * - **Wikidata** needs a hyphenation-tolerant SPARQL query and a traversal from
 *   edition to work, for three genres and seven page counts.
 * - **Open Library `search.json`** offers 35 page counts and no new dependency,
 *   but 13 of them exist only as `number_of_pages_median`, which is the average
 *   of every edition of the work rather than the copy on the shelf. Spine width
 *   is what a page count is for here, so an average is a different thing wearing
 *   the same name. `searchTitle` already uses that endpoint for books with no
 *   readable barcode, where it is the only answer going.
 *
 * ## What this file will read out of a MARC record, and what it will not
 *
 * It reads 245 for the title, 300 for the extent, 650 and 655 for the subject
 * headings, 082 for the Dewey number and 050 for the LC class.
 *
 * **It does not read 100 or 700, so no name in a MARC record can reach this
 * application.** That is a measured decision and not a simplification. Of 34
 * apparent author gains the measurement read one at a time, 18 were the same
 * person under a different spelling, 5 were a translator or an illustrator
 * correctly recorded in 700 and correctly not the author, 10 were plainly the
 * wrong person, and 1 was real. Applying the first group would credit two people
 * where the collection has one, which is what `author_alias` exists to prevent.
 * The refusal is written as a missing branch in `readMarc` rather than as a note
 * asking the next person not to add one.
 *
 * ## Terms, keys and rate
 *
 * Neither source needs a key, which is the reason both are reachable at all:
 * `AGENTS.md` is explicit that a key does not belong in a file or on a command
 * line, and the only mechanism this machine has for one is the DPAPI-encrypted
 * file the launcher is handed the path to.
 *
 * | | Library of Congress | K10plus |
 * | --- | --- | --- |
 * | Endpoint | SRU 1.1 at `lx2.loc.gov:210/lcdb` | SRU 1.1 at `sru.k10plus.de/opac-de-627` |
 * | Key | None | None |
 * | Documented rate | 20 requests a minute on the `loc.gov` JSON API, with an hour's block past it. None documented for SRU | None documented |
 * | Asked here at | 1 per 3 s, the stricter of the two published figures | 1 per 1.1 s, the rate the measurement swept at |
 * | Terms | "Free to use and reuse" is stated per collection and is not confirmed for the MARC catalogue, so nothing is redistributed and only a page count and a subject heading are kept | CC0, per K10plus Open Data |
 *
 * `source-pace.ts` enforces both rates, and its central promise is that waiting
 * for a slot never outlasts the caller's deadline: a source that cannot be asked
 * politely in time is not asked at all.
 */

import { fetchBounded } from './bounded-fetch'
import {
  K10PLUS_NAME, LIBRARY_OF_CONGRESS_NAME, noteSourceAnswer, noteSourceSkipped,
} from './source-watch'
import { reserveSlot } from './source-pace'
import type { SupplementaryRecord } from '../domain/books/catalogue-reconciliation'

/**
 * One SRU catalogue, and everything that differs between the two of them.
 *
 * The origins are read from the environment so a test run can point them at a
 * local stub, for exactly the reason `lookup.ts` reads the other two that way:
 * the requests happen in this process rather than the browser, so an end to end
 * run cannot intercept them from the page, and a suite that really talks to the
 * Library of Congress fails whenever the Library of Congress is slow. Nothing
 * sets them in normal use.
 */
export interface SruCatalogue {
  /** The catalogue, spelled as `lookup_source` spells it. */
  name: string
  endpoint: string
  /** The CQL index this catalogue publishes ISBNs under. */
  isbnIndex: string
  /** The shortest gap this app will leave between two requests to it. */
  minIntervalMs: number
}

const LIBRARY_OF_CONGRESS: SruCatalogue = {
  name: LIBRARY_OF_CONGRESS_NAME,
  endpoint: process.env.BOOKSCAN_LOC_SRU_URL || 'https://lx2.loc.gov:210/lcdb',
  isbnIndex: 'bath.isbn',
  minIntervalMs: 3000,
}

const K10PLUS: SruCatalogue = {
  name: K10PLUS_NAME,
  endpoint: process.env.BOOKSCAN_K10PLUS_SRU_URL || 'https://sru.k10plus.de/opac-de-627',
  isbnIndex: 'pica.isb',
  minIntervalMs: 1100,
}

/**
 * Both of them, **in rank order, and the order is the rank**.
 *
 * `domain/books/catalogue-reconciliation.ts` settles a disagreement by position
 * in this array and holds no opinion about either name, so this is the one place
 * that says which catalogue is believed first. Library of Congress leads because
 * the measurement verified 34 of 34 of its records as the right book, against 29
 * of 31 for K10plus.
 */
export const SRU_CATALOGUES: readonly SruCatalogue[] = [LIBRARY_OF_CONGRESS, K10PLUS]

// ---------------------------------------------------------------------------
// MARCXML
// ---------------------------------------------------------------------------

/**
 * Why there is no XML library here.
 *
 * MARCXML is a flat list of `datafield` elements each holding a flat list of
 * `subfield` elements, with no mixed content, no attributes that matter beyond
 * `tag` and `code`, and no nesting to speak of. Six fields are wanted out of it.
 * A parser dependency to read that would be a dependency on the critical path of
 * a lookup, and `web/package.json` has none today.
 *
 * The two things a hand-rolled reader has to get right are both handled below:
 * the namespace prefix, because some responses write `<marc:datafield>`, and the
 * five XML entities, because a title with an ampersand in it is common and
 * comparing `Bell &amp; Sons` against `Bell & Sons` would refuse the record.
 */
const DATAFIELD = /<(?:[\w.-]+:)?datafield\b[^>]*\btag="(\d{3})"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?datafield>/g
const SUBFIELD = /<(?:[\w.-]+:)?subfield\b[^>]*\bcode="([^"])"[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?subfield>/g
const RECORD_DATA = /<(?:[\w.-]+:)?recordData\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?recordData>/

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

/**
 * MARC punctuation is data, and none of it is wanted here.
 *
 * A subfield is written with the punctuation that would introduce the next one,
 * so a title proper arrives as `Dune /` and a subject heading as
 * `Science fiction.` Left on, every heading in the catalogue would carry a stop
 * and every comparison would be against a string nobody else writes.
 */
function tidy(raw: string): string {
  return decodeEntities(raw).replace(/[\s/:;,.=]+$/, '').replace(/^[\s/:;,.=]+/, '').trim()
}

/** Every `code` subfield of every `tag` field, in the order the record wrote them. */
function subfieldsOf(marc: string, tag: string, codes: string): string[] {
  const found: string[] = []
  for (const field of marc.matchAll(DATAFIELD)) {
    if (field[1] !== tag) continue
    for (const sub of (field[2] ?? '').matchAll(SUBFIELD)) {
      if (!codes.includes(sub[1] ?? '')) continue
      const value = tidy(sub[2] ?? '')
      if (value) found.push(value)
    }
  }
  return found
}

/**
 * A number of pages out of a MARC 300 extent statement.
 *
 * The extent is free text with a house style rather than a number: `535 p.`,
 * `xii, 535 p. ;`, `1 online resource (535 pages)`, `XII, 523 Seiten`. Every
 * arabic number that is followed by a word meaning "pages" is a candidate and
 * the largest wins, which is what picks 535 out of `xii, 535 p.` and 1200 out of
 * `2 v. (1200 p.)`.
 *
 * **Roman front matter is deliberately not added on.** `xii, 535 p.` is a
 * 535-page book with twelve pages of preface, and it is the 535 that a publisher
 * prints, a catalogue records, and a spine is as thick as.
 *
 * Nothing is returned for `1 v. (various pagings)` or `3 volumes`, which state
 * an extent that is not a page count. The bound at 20000 refuses a year, a
 * shelfmark or a price that has wandered into the field.
 */
export function pagesFromExtent(raw: string): number | null {
  let best: number | null = null
  const pattern = /(\d{1,5})\s*(?:pages?\b|pp?\.|p\b|seiten\b|s\.|leaves\b|bl\.)/gi
  for (const match of raw.matchAll(pattern)) {
    const value = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isFinite(value) || value < 1 || value > 20000) continue
    if (best === null || value > best) best = value
  }
  return best
}

/**
 * One MARC record, as the fields this application is willing to take.
 *
 * Exported for its test. `source` is filled in by the caller because a record
 * does not know which catalogue sent it.
 */
export function readMarc(marc: string): Omit<SupplementaryRecord, 'source'> | null {
  const title = subfieldsOf(marc, '245', 'a')[0] ?? ''
  if (!title) return null

  const extent = subfieldsOf(marc, '300', 'a')
  const pages = extent.map(pagesFromExtent).find((value) => value !== null) ?? null

  /*
   * 650 is a topical heading and 655 is a genre or form heading, which is the
   * one that says "Science fiction" outright. `$a` is the heading and `$v` is
   * its form subdivision, which is where `Fiction` lives on a heading like
   * `Mars (Planet) -- Fiction`. Both are kept and each is kept as its own
   * heading: `domain/tagging/catalogue-claims.ts` turns each into a slug, and a
   * heading joined to its subdivision would slug into one tag that nothing else
   * in the catalogue ever produces.
   *
   * `$x`, `$y` and `$z` are left out. They are topical, chronological and
   * geographic subdivisions, they say nothing about fiction or not, and they
   * would put a tag on the book for every century and country a cataloguer
   * mentioned.
   *
   * 100 and 700 are not read. See the header.
   */
  const subjects = [...subfieldsOf(marc, '655', 'av'), ...subfieldsOf(marc, '650', 'av')]

  return {
    title,
    pages,
    subjects: [...new Set(subjects)],
    dewey: subfieldsOf(marc, '082', 'a'),
    lc: subfieldsOf(marc, '050', 'a'),
  }
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/**
 * Ask one SRU catalogue about one ISBN.
 *
 * Answers null in three different situations, all of which are ordinary and none
 * of which is an error: the rate limiter declined the slot, the catalogue
 * replied and has no such book, or it did not reply at all. Which of the three
 * happened is recorded in `source-watch.ts` and reaches `/api/health`; the
 * caller is not told, because a caller that behaved differently when a source
 * was quiet is a lookup that fails when a catalogue is down.
 */
async function askOne(
  catalogue: SruCatalogue,
  isbn: string,
  budgetMs: number,
): Promise<SupplementaryRecord | null> {
  const started = Date.now()
  if (!(await reserveSlot(catalogue.name, catalogue.minIntervalMs, budgetMs))) {
    noteSourceSkipped(catalogue.name)
    return null
  }

  // Whatever the limiter spent is gone. The deadline is the caller's, not each
  // step's, so a source that waited for a slot gets the remainder and not a
  // fresh budget: the promise made to the person holding the book is about the
  // whole round.
  const left = budgetMs - (Date.now() - started)
  if (left <= 0) {
    noteSourceSkipped(catalogue.name)
    return null
  }

  const answer = await fetchBounded(
    catalogue.endpoint,
    {
      version: '1.1',
      operation: 'searchRetrieve',
      query: `${catalogue.isbnIndex}=${isbn}`,
      maximumRecords: '1',
      recordSchema: 'marcxml',
    },
    left,
    'text',
  )
  noteSourceAnswer(catalogue.name, answer.answered, answer.why)

  const body = typeof answer.data === 'string' ? answer.data : ''
  if (!body) return null

  /*
   * SRU wraps each hit in its own `record`, so the document holds two elements
   * called `record` nested one inside the other and only the inner one is MARC.
   * Cutting at `recordData` sidesteps that entirely. A response with no
   * `recordData` is the ordinary "no such book": `numberOfRecords` is 0 and
   * there is no `records` element at all. A response carrying an SRU
   * `diagnostics` block reaches the same place, and correctly: the catalogue
   * replied, and it has nothing for us.
   */
  const inner = RECORD_DATA.exec(body)?.[1]
  if (!inner) return null

  const record = readMarc(inner)
  return record ? { source: catalogue.name, ...record } : null
}

/**
 * Ask both, at once, inside one deadline.
 *
 * Concurrent rather than in sequence, so the round costs the slower of the two
 * and not the sum, and returned **in rank order rather than in the order they
 * answered**, so what the reconciliation decides does not depend on which
 * catalogue happened to be quicker that afternoon. A book saved twice gets the
 * same answer twice.
 *
 * Nothing here throws. A catalogue that is down, unreachable, slow or rate
 * limited contributes nothing and the round returns whatever the other one said,
 * which is the ordinary case rather than a failure.
 */
export async function askSupplementaryCatalogues(
  isbn: string,
  budgetMs: number,
): Promise<SupplementaryRecord[]> {
  if (!isbn) return []
  const answers = await Promise.all(
    SRU_CATALOGUES.map((catalogue) =>
      askOne(catalogue, isbn, budgetMs).catch(() => null)),
  )
  return answers.filter((one): one is SupplementaryRecord => one !== null)
}
