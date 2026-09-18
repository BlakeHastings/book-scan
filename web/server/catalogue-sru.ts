/**
 * The two national catalogues, and the MARC records they answer with. See
 * `docs/catalogue-sources.md`.
 *
 * This file reads 245 for the title, 300 for the extent, 650 and 655 for the
 * subject headings, 082 for the Dewey number and 050 for the LC class. It does
 * not read 100 or 700, so no name in a MARC record can reach this application:
 * catalogue names are often the same person under a different spelling, and
 * applying them would credit two people where the collection has one. The refusal
 * is written as a missing branch in `readMarc` rather than as a note asking the
 * next person not to add one.
 *
 * Neither source needs a key. `source-pace.ts` enforces both rates, and waiting
 * for a slot never outlasts the caller's deadline.
 */

import { fetchBounded } from './bounded-fetch'
import {
  K10PLUS_NAME, LIBRARY_OF_CONGRESS_NAME, noteSourceAnswer, noteSourceSkipped, outcomeOf,
} from './source-watch'
import { reserveSlot } from './source-pace'
import type { SupplementaryRecord } from '../domain/books/catalogue-reconciliation'

/**
 * One SRU catalogue, and everything that differs between the two of them. The
 * origins are read from the environment so a test run can point them at a local
 * stub, since the requests happen in this process rather than the browser and an
 * end to end run cannot intercept them from the page. Nothing sets them in normal
 * use.
 */
export interface SruCatalogue {
  /** The catalogue, spelled as `lookup_source` spells it. */
  name: string
  endpoint: string
  /** The CQL index this catalogue publishes ISBNs under. */
  isbnIndex: string
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
 * Both of them, in rank order, and the order is the rank:
 * `domain/books/catalogue-reconciliation.ts` settles a disagreement by position
 * in this array and holds no opinion about either name.
 */
export const SRU_CATALOGUES: readonly SruCatalogue[] = [LIBRARY_OF_CONGRESS, K10PLUS]

/**
 * The two things a hand-rolled MARCXML reader has to get right, both handled
 * below: the namespace prefix, because some responses write `<marc:datafield>`,
 * and the five XML entities, because comparing `Bell &amp; Sons` against
 * `Bell & Sons` would refuse the record.
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
 * MARC punctuation is data, and none of it is wanted here. A subfield is written
 * with the punctuation that would introduce the next one, so a title proper
 * arrives as `Dune /` and a subject heading as `Science fiction.`
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
 * the largest wins. Roman front matter is deliberately not added on: `xii, 535
 * p.` is a 535-page book with twelve pages of preface. The bound at 20000
 * refuses a year, a shelfmark or a price that has wandered into the field.
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
 * One MARC record, as the fields this application is willing to take. `source` is
 * filled in by the caller because a record does not know which catalogue sent it.
 */
export function readMarc(marc: string): Omit<SupplementaryRecord, 'source'> | null {
  const title = subfieldsOf(marc, '245', 'a')[0] ?? ''
  if (!title) return null

  const extent = subfieldsOf(marc, '300', 'a')
  const pages = extent.map(pagesFromExtent).find((value) => value !== null) ?? null

  /*
   * 650 is a topical heading and 655 is a genre or form heading. `$a` is the
   * heading and `$v` is its form subdivision, which is where `Fiction` lives on
   * a heading like `Mars (Planet) -- Fiction`. Each is kept as its own heading,
   * because `domain/tagging/catalogue-claims.ts` turns each into a slug and a
   * heading joined to its subdivision would slug into one tag that nothing else
   * in the catalogue ever produces.
   *
   * `$x`, `$y` and `$z` are left out. They are topical, chronological and
   * geographic subdivisions, and they would put a tag on the book for every
   * century and country a cataloguer mentioned.
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

/**
 * Ask one SRU catalogue about one ISBN.
 *
 * Answers null in three different situations, all of which are ordinary and none
 * of which is an error: the rate limiter declined the slot, the catalogue
 * replied and has no such book, or it did not reply at all. Which of the three
 * happened is recorded in `source-watch.ts` and reaches `/api/health`; the caller
 * is not told.
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

  // The deadline is the caller's, not each step's, so a source that waited for a
  // slot gets the remainder and not a fresh budget.
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
  const body = typeof answer.data === 'string' ? answer.data : ''
  const record = body ? readSruRecord(catalogue, body) : null

  /*
   * Noted once the record has been read, because "it replied" and "it had the
   * book" are two facts. A reply this application could not parse counts as no
   * record rather than as silence, deliberately: the catalogue did its part.
   */
  noteSourceAnswer(catalogue.name, outcomeOf(answer.answered, record !== null), answer.why)
  return record
}

function readSruRecord(catalogue: SruCatalogue, body: string): SupplementaryRecord | null {
  /*
   * SRU wraps each hit in its own `record`, so the document holds two elements
   * called `record` nested one inside the other and only the inner one is MARC.
   * Cutting at `recordData` sidesteps that entirely. A response with no
   * `recordData` is the ordinary "no such book", and one carrying an SRU
   * `diagnostics` block reaches the same place.
   */
  const inner = RECORD_DATA.exec(body)?.[1]
  if (!inner) return null

  const record = readMarc(inner)
  return record ? { source: catalogue.name, ...record } : null
}

/**
 * Ask both, at once, inside one deadline.
 *
 * The answers come back in rank order rather than in the order they answered, so
 * what the reconciliation decides does not depend on which catalogue happened to
 * be quicker. Nothing here throws: a catalogue that is down, slow or rate limited
 * contributes nothing and the round returns whatever the other one said.
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
