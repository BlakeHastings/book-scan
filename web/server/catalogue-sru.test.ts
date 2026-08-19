/**
 * Reading a MARC record, and asking two catalogues for one without being rude
 * to them (#305).
 *
 * Two halves, and they are separate on purpose. `readMarc` and `pagesFromExtent`
 * are given the XML a national catalogue actually sends, because the failures
 * worth catching are a namespace prefix, an entity and a house style for
 * writing "535 pages", none of which a hand-written fixture would have if the
 * fixture were invented rather than copied. `askSupplementaryCatalogues` is run
 * against two real HTTP servers, for the reason `lookup-sources.test.ts` gives:
 * what is under test is what this file makes of a status code, a dropped socket
 * and a body that is not a record, and a stubbed `fetch` would be this file
 * asserting against its own idea of those.
 *
 * `BOOKSCAN_SRU_PACE_MS` is set to 0 before the module is imported, so the rate
 * limiter does not make the suite spend real seconds proving a rule about
 * seconds. The one test that is about the limiter sets its own interval and is
 * the only place a real wait happens.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSourceStandings, sourceStandings } from './source-watch'
import { forgetPacing, reserveSlot } from './source-pace'
import type { SupplementaryRecord } from '../domain/books/catalogue-reconciliation'

const ISBN = '9780441013593'

type Behaviour = 'a record' | 'no records' | 'a diagnostic' | 'down' | 'hangs' | 'drops'

let locDoes: Behaviour = 'a record'
let k10Does: Behaviour = 'a record'

let loc: Server
let k10: Server
let askSupplementaryCatalogues:
  (isbn: string, budgetMs: number) => Promise<SupplementaryRecord[]>
let readMarc: (marc: string) => Omit<SupplementaryRecord, 'source'> | null
let pagesFromExtent: (raw: string) => number | null

/** Every query string each stub was sent, so what was asked is provable. */
const locAsked: string[] = []
const k10Asked: string[] = []

/**
 * A Library of Congress record, in the shape `lx2.loc.gov` answers.
 *
 * The 100 and the 700 are here on purpose and are the point of one of the tests
 * below: this is what a real record carries, and nothing in this application
 * reads either of them.
 */
const LOC_MARC = `<?xml version="1.0" encoding="UTF-8"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/">
  <zs:version>1.1</zs:version>
  <zs:numberOfRecords>1</zs:numberOfRecords>
  <zs:records><zs:record>
    <zs:recordSchema>marcxml</zs:recordSchema>
    <zs:recordData>
      <record xmlns="http://www.loc.gov/MARC21/slim">
        <leader>01142cam a2200301 a 4500</leader>
        <controlfield tag="001">12345678</controlfield>
        <datafield tag="050" ind1="0" ind2="0">
          <subfield code="a">PS3558.E63</subfield>
          <subfield code="b">D8 1990</subfield>
        </datafield>
        <datafield tag="082" ind1="0" ind2="0">
          <subfield code="a">813/.54</subfield>
          <subfield code="2">20</subfield>
        </datafield>
        <datafield tag="100" ind1="1" ind2=" ">
          <subfield code="a">Herbert, Frank.</subfield>
        </datafield>
        <datafield tag="245" ind1="1" ind2="0">
          <subfield code="a">Dune /</subfield>
          <subfield code="c">Frank Herbert ; illustrated by John Schoenherr.</subfield>
        </datafield>
        <datafield tag="300" ind1=" " ind2=" ">
          <subfield code="a">xii, 535 p. ;</subfield>
          <subfield code="c">24 cm.</subfield>
        </datafield>
        <datafield tag="650" ind1=" " ind2="0">
          <subfield code="a">Life on other planets</subfield>
          <subfield code="v">Fiction.</subfield>
        </datafield>
        <datafield tag="655" ind1=" " ind2="7">
          <subfield code="a">Science fiction.</subfield>
          <subfield code="2">lcgft</subfield>
        </datafield>
        <datafield tag="700" ind1="1" ind2=" ">
          <subfield code="a">Schoenherr, John,</subfield>
          <subfield code="e">illustrator.</subfield>
        </datafield>
      </record>
    </zs:recordData>
  </zs:record></zs:records>
</zs:searchRetrieveResponse>`

/**
 * A K10plus record: the same schema, a German house style, and a namespace
 * prefix on the MARC elements rather than on the SRU ones.
 */
const K10_MARC = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/">
  <numberOfRecords>1</numberOfRecords>
  <records><record><recordData>
    <marc:record xmlns:marc="http://www.loc.gov/MARC21/slim">
      <marc:datafield tag="245" ind1="1" ind2="0">
        <marc:subfield code="a">Dune</marc:subfield>
      </marc:datafield>
      <marc:datafield tag="300" ind1=" " ind2=" ">
        <marc:subfield code="a">XII, 604 Seiten</marc:subfield>
      </marc:datafield>
      <marc:datafield tag="650" ind1=" " ind2="7">
        <marc:subfield code="a">Science-Fiction &amp; Fantasy</marc:subfield>
      </marc:datafield>
    </marc:record>
  </recordData></record></records>
</searchRetrieveResponse>`

const NO_RECORDS = '<?xml version="1.0"?><searchRetrieveResponse ' +
  'xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>0</numberOfRecords>' +
  '</searchRetrieveResponse>'

const DIAGNOSTIC = '<?xml version="1.0"?><searchRetrieveResponse ' +
  'xmlns="http://www.loc.gov/zing/srw/"><numberOfRecords>0</numberOfRecords>' +
  '<diagnostics><diagnostic><uri>info:srw/diagnostic/1/16</uri>' +
  '<details>bath.isbn</details></diagnostic></diagnostics></searchRetrieveResponse>'

/** How long each stub sits on its answer. Set by the one test that cares. */
let locDelayMs = 0

function behave(
  does: Behaviour,
  marc: string,
  req: IncomingMessage,
  res: ServerResponse,
  delayMs = 0,
): void {
  if (does === 'hangs') return
  if (does === 'drops') { req.socket.destroy(); return }

  const send = () => {
    if (does === 'down') {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('unavailable')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/xml' })
    res.end(does === 'a record' ? marc : does === 'a diagnostic' ? DIAGNOSTIC : NO_RECORDS)
  }

  if (delayMs > 0) setTimeout(send, delayMs)
  else send()
}

async function listening(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeAll(async () => {
  loc = createServer((req, res) => {
    locAsked.push(req.url ?? '')
    behave(locDoes, LOC_MARC, req, res, locDelayMs)
  })
  k10 = createServer((req, res) => {
    k10Asked.push(req.url ?? '')
    behave(k10Does, K10_MARC, req, res)
  })

  process.env.BOOKSCAN_LOC_SRU_URL = await listening(loc)
  process.env.BOOKSCAN_K10PLUS_SRU_URL = await listening(k10)
  process.env.BOOKSCAN_SRU_PACE_MS = '0'

  const module = await import('./catalogue-sru')
  askSupplementaryCatalogues = module.askSupplementaryCatalogues
  readMarc = module.readMarc
  pagesFromExtent = module.pagesFromExtent
})

afterAll(async () => {
  for (const server of [loc, k10]) {
    server.closeAllConnections?.()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  delete process.env.BOOKSCAN_LOC_SRU_URL
  delete process.env.BOOKSCAN_K10PLUS_SRU_URL
  delete process.env.BOOKSCAN_SRU_PACE_MS
})

beforeEach(() => {
  locDoes = 'a record'
  k10Does = 'a record'
  locDelayMs = 0
  locAsked.length = 0
  k10Asked.length = 0
  forgetSourceStandings()
  forgetPacing()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

const standingFor = (source: string) => sourceStandings().find((one) => one.source === source)!

describe('reading a MARC record', () => {
  it('takes the title, the extent, the headings, the Dewey and the LC class', () => {
    const record = readMarc(LOC_MARC)!

    expect(record.title).toBe('Dune')
    expect(record.pages).toBe(535)
    // 655 before 650, which is the genre or form heading before the topical one,
    // and `$v` kept because that is where "Fiction" lives on a heading like
    // "Life on other planets -- Fiction".
    expect(record.subjects).toEqual(['Science fiction', 'Life on other planets', 'Fiction'])
    expect(record.dewey).toEqual(['813/.54'])
    expect(record.lc).toEqual(['PS3558.E63'])
  })

  it('reads no name out of a record that carries two', () => {
    /*
     * The refusal, checked rather than promised. This record has an author in
     * 100 and an illustrator in 700, and it is the shape that produced the
     * measurement's finding: of 34 apparent author gains, 5 were a translator or
     * an illustrator correctly recorded in 700, 18 were the same person under a
     * different spelling, 10 were the wrong person, and 1 was real.
     */
    const record = readMarc(LOC_MARC)!

    expect(JSON.stringify(record)).not.toContain('Herbert')
    expect(JSON.stringify(record)).not.toContain('Schoenherr')
    expect(Object.keys(record).sort()).toEqual(['dewey', 'lc', 'pages', 'subjects', 'title'])
  })

  it('reads a namespace prefix on the MARC elements and decodes an entity', () => {
    const record = readMarc(K10_MARC)!

    expect(record.title).toBe('Dune')
    expect(record.pages).toBe(604)
    expect(record.subjects).toEqual(['Science-Fiction & Fantasy'])
  })

  it('is nothing at all for a record with no title', () => {
    // Nothing could be verified against our own title, so there is nothing
    // usable here whatever else the record says.
    expect(readMarc('<record><datafield tag="300"><subfield code="a">535 p.</subfield>' +
      '</datafield></record>')).toBeNull()
  })
})

describe('a page count out of an extent statement', () => {
  it('reads the house styles both catalogues write', () => {
    expect(pagesFromExtent('535 p.')).toBe(535)
    expect(pagesFromExtent('xii, 535 p. ;')).toBe(535)
    expect(pagesFromExtent('vii, 250 pages : illustrations')).toBe(250)
    expect(pagesFromExtent('XII, 604 Seiten')).toBe(604)
    expect(pagesFromExtent('1 online resource (535 pages)')).toBe(535)
  })

  it('does not add roman front matter to the number a spine is as thick as', () => {
    // `xii, 535 p.` is a 535-page book with twelve pages of preface. 535 is what
    // the publisher prints and what the catalogue records.
    expect(pagesFromExtent('xii, 535 p.')).toBe(535)
  })

  it('has nothing to say about an extent that is not a page count', () => {
    expect(pagesFromExtent('1 v. (various pagings)')).toBeNull()
    expect(pagesFromExtent('3 volumes')).toBeNull()
    expect(pagesFromExtent('')).toBeNull()
  })
})

describe('asking both catalogues', () => {
  it('asks each by its own ISBN index and answers in rank order', async () => {
    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['Library of Congress', 'K10plus'])
    expect(records[0]!.pages).toBe(535)
    expect(records[1]!.pages).toBe(604)

    // Each catalogue publishes ISBNs under its own CQL index, and asking one
    // with the other's answers nothing at all.
    expect(locAsked[0]).toContain(`bath.isbn%3D${ISBN}`)
    expect(k10Asked[0]).toContain(`pica.isb%3D${ISBN}`)
  })

  it('is rank order even when the ranked-first catalogue is the slower one', async () => {
    /*
     * Both are asked at once, so which of them replies first is a fact about an
     * afternoon. If it decided anything, a book saved twice could get two
     * different page counts, so it decides nothing: Library of Congress leads
     * because the measurement verified 34 of 34 of its records as the right
     * book, not because it is quick.
     */
    locDelayMs = 150

    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['Library of Congress', 'K10plus'])
  })

  it('records a reply with no record as having answered, not as a failure', async () => {
    // The ordinary case and the reason #305 exists. Library of Congress holds
    // 131 of the 238 books in the real catalogue, so it has nothing to say about
    // rather more of them than it does.
    locDoes = 'no records'

    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['K10plus'])
    expect(standingFor('Library of Congress'))
      .toMatchObject({ asked: 1, answered: 1, silent: 0, skipped: 0 })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('treats an SRU diagnostic as the catalogue replying with nothing', async () => {
    // A diagnostic is the catalogue understanding the question and having no
    // answer to it. It replied, so it is not silence, and it named no book, so
    // there is nothing to take.
    locDoes = 'a diagnostic'

    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['K10plus'])
    expect(standingFor('Library of Congress')).toMatchObject({ asked: 1, answered: 1, silent: 0 })
  })

  it('lets the other one answer when a catalogue is down', async () => {
    locDoes = 'down'

    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['K10plus'])
    expect(standingFor('Library of Congress'))
      .toMatchObject({ asked: 1, answered: 0, silent: 1, lastSilence: 'HTTP 503' })
  })

  it('gives up on a catalogue that never replies, inside the budget', async () => {
    /*
     * #299 bounded the one reader this app had because an unbounded one is a
     * dependency that can hang, and #305 adds two more things that can. Nothing
     * here reaches `fetch` without an `AbortController` behind it, and this is
     * that proved rather than asserted: the server is told to answer nothing at
     * all and the call still returns.
     */
    locDoes = 'hangs'
    const started = Date.now()

    const records = await askSupplementaryCatalogues(ISBN, 400)

    expect(Date.now() - started).toBeLessThan(3000)
    expect(records.map((one) => one.source)).toEqual(['K10plus'])
    expect(standingFor('Library of Congress'))
      .toMatchObject({ asked: 1, answered: 0, silent: 1, lastSilence: 'timed out' })
  })

  it('survives a dropped socket', async () => {
    k10Does = 'drops'

    const records = await askSupplementaryCatalogues(ISBN, 3000)

    expect(records.map((one) => one.source)).toEqual(['Library of Congress'])
    expect(standingFor('K10plus'))
      .toMatchObject({ asked: 1, answered: 0, silent: 1, lastSilence: 'unreachable' })
  })

  it('asks nobody about an empty ISBN', async () => {
    expect(await askSupplementaryCatalogues('', 3000)).toEqual([])
    expect(locAsked).toEqual([])
    expect(k10Asked).toEqual([])
  })
})

describe('the rate limiter', () => {
  // The override the rest of this file runs under is what these tests are
  // about, so they take it off and put it back. The intervals they use are
  // their own and small, so nothing here waits for a real catalogue's rate.
  beforeEach(() => { delete process.env.BOOKSCAN_SRU_PACE_MS })
  afterEach(() => { process.env.BOOKSCAN_SRU_PACE_MS = '0' })

  it('leaves the interval between two requests to the same source', async () => {
    const started = Date.now()
    expect(await reserveSlot('a catalogue', 120, 5000)).toBe(true)
    expect(await reserveSlot('a catalogue', 120, 5000)).toBe(true)

    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('declines rather than queueing past the caller\'s deadline', async () => {
    /*
     * The promise that makes a limiter safe to put in front of somebody holding
     * a book. A rate limiter normally turns a burst into a queue, and a queue in
     * front of a person photographing books is the "work behind other work" #294
     * is the cautionary tale about. Here the queue has a hard end: the worst it
     * can do to a scan is cost it one source for one book.
     */
    const started = Date.now()
    expect(await reserveSlot('a busy catalogue', 60_000, 5000)).toBe(true)
    expect(await reserveSlot('a busy catalogue', 60_000, 5000)).toBe(false)

    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('costs the next caller nothing when it declines', async () => {
    // A declined caller reserves no slot, so it cannot push the queue further
    // out for whoever asks next.
    expect(await reserveSlot('another catalogue', 300, 5000)).toBe(true)
    expect(await reserveSlot('another catalogue', 300, 10)).toBe(false)
    expect(await reserveSlot('another catalogue', 300, 5000)).toBe(true)
  })

  it('counts a source it declined as skipped, which is neither asked nor silent', async () => {
    /*
     * Nothing was sent, so the catalogue did nothing and owes no explanation;
     * the decision was this application's. Folded into `silent` it would read as
     * a library being down, and folded into `asked` it would read as a request
     * that was made.
     */
    process.env.BOOKSCAN_SRU_PACE_MS = '60000'
    try {
      await askSupplementaryCatalogues(ISBN, 3000)
      locAsked.length = 0
      k10Asked.length = 0

      const records = await askSupplementaryCatalogues(ISBN, 200)

      expect(records).toEqual([])
      expect(locAsked).toEqual([])
      expect(k10Asked).toEqual([])
      expect(standingFor('Library of Congress'))
        .toMatchObject({ asked: 1, answered: 1, silent: 0, skipped: 1 })
      expect(standingFor('K10plus'))
        .toMatchObject({ asked: 1, answered: 1, silent: 0, skipped: 1 })
    } finally {
      process.env.BOOKSCAN_SRU_PACE_MS = '0'
    }
  })
})
