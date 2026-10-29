/**
 * `MatchCoverHandler`: the words through the app's own `MatchCoverTextHandler`
 * over a real Postgres, so `pg_trgm` decides how much of a title a reading
 * holds, and the picture and the hash stood in for, so each test can say
 * exactly what they ranked.
 *
 * How well the fusion does on photographs is the harness's question
 * (`server/cover-matching/`); these are the rules one photograph is held to,
 * above all the one #669 exists for: a series sibling that is not catalogued
 * must not open the one that is, even when the picture agrees with it.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/driver'
import { closeTestDatabase, openTestDatabase } from '../../server/testdb'
import { testBooks } from '../../server/testbooks'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { MatchCoverTextHandler } from '../../application/books/queries/match-cover-text'
import { BAR, fuse, MatchCoverHandler } from '../../application/books/queries/match-cover'
import type { CoverHashes, CoverPictures, HashMatch, PictureMatch } from '../../application/books/read-models'
import { DrizzleCoverTextReadModel } from './cover-text-read-model'

let db: Db
const ids: Record<string, number> = {}

async function shelve(title: string, ...authors: string[]): Promise<void> {
  ids[title] = (await testBooks(db).catalogue({ title, authors, genre: FICTION_SLUG })).id
}

const PHOTO = new Uint8Array([1, 2, 3])

/** A picture model that ranks these titles, best first, at these cosines; or null for one that is off. */
function pictures(ranked: [string, number][] | null): CoverPictures {
  return {
    nearest: async (_photo, limit) => ranked === null
      ? null
      : ranked.slice(0, limit).map(([title, similarity]): PictureMatch => ({ id: ids[title]!, similarity })),
  }
}

function hashes(ranked: [string, number][] = []): CoverHashes {
  return {
    near: async (_photo, within, limit) => ranked
      .filter(([, distance]) => distance <= within)
      .slice(0, limit)
      .map(([title, distance]): HashMatch => ({ id: ids[title]!, distance })),
  }
}

function matcher(picture: CoverPictures, hash: CoverHashes = hashes()): MatchCoverHandler {
  const text = new MatchCoverTextHandler(new DrizzleCoverTextReadModel(db))
  return new MatchCoverHandler(picture, { near: (reading, limit) => text.handle({ text: reading, limit }) }, hash)
}

const titleOf = (id: number | null) => Object.entries(ids).find(([, value]) => value === id)?.[0] ?? null

/** Everything the image model would say about a Barsoom cover: the series is one design. */
const BARSOOM_PICTURE: [string, number][] = [
  ['A Princess of Mars', 0.91],
  ['The Gods of Mars', 0.62],
  ['Dune', 0.41],
  ['Perdido Street Station', 0.39],
]

beforeEach(async () => {
  db = await openTestDatabase()
  await shelve('A Princess of Mars', 'Edgar Rice Burroughs')
  await shelve('The Gods of Mars', 'Edgar Rice Burroughs')
  await shelve('Dune', 'Frank Herbert')
  await shelve('Perdido Street Station', 'China Miéville')
  await shelve('The Left Hand of Darkness', 'Ursula K. Le Guin')
})

afterAll(closeTestDatabase)

describe('a series sibling the catalogue does not hold (#664\'s "The Warlord of Mars")', () => {
  it('does not open "A Princess of Mars", even when the picture ranks it first by a mile', async () => {
    const answer = await matcher(pictures(BARSOOM_PICTURE), hashes([['A Princess of Mars', 6]]))
      .handle({ photo: PHOTO, reading: 'THE WARLORD OF MARS\nEDGAR RICE BURROUGHS' })

    expect(answer.confident).toBeNull()
    // Still offered, which is right: it is a likely book to be confused with,
    // and a person can say it is not this one.
    expect(answer.candidates.map((candidate) => titleOf(candidate.id))).toContain('A Princess of Mars')
    const princess = answer.candidates.find((candidate) => titleOf(candidate.id) === 'A Princess of Mars')!
    expect(princess.titlePrinted, 'the words that make the sibling look printed').toBeLessThan(BAR.agreement.titlePrinted)
  })

  it('does not open it when the photograph shows only the author, as the real one did', async () => {
    // What Paddle read off the real photograph in #664's set.
    const answer = await matcher(pictures(BARSOOM_PICTURE)).handle({ photo: PHOTO, reading: 'BURROUGNS EDGARIRICE' })
    expect(answer.confident).toBeNull()
  })

  it('does not open it with the image model off either', async () => {
    const answer = await matcher(pictures(null), hashes([['A Princess of Mars', 6]]))
      .handle({ photo: PHOTO, reading: 'THE WARLORD OF MARS\nEDGAR RICE BURROUGHS' })
    expect(answer.confident).toBeNull()
  })
})

describe('a sibling with no other volume on the shelf', () => {
  // The hardest shape: no second volume catalogued for the words' lead to
  // stop on, so only how much of the title is printed holds it back.
  beforeEach(async () => {
    db = await openTestDatabase()
    for (const title of Object.keys(ids)) delete ids[title]
    await shelve('The Gods of Mars', 'Edgar Rice Burroughs')
    await shelve('Dune', 'Frank Herbert')
    await shelve('Perdido Street Station', 'China Miéville')
  })

  it('does not open "The Gods of Mars" for "The Warlord of Mars", picture and words both ranking it first', async () => {
    const answer = await matcher(pictures([['The Gods of Mars', 0.93], ['Dune', 0.4]]))
      .handle({ photo: PHOTO, reading: 'THE WARLORD OF MARS\nEDGAR RICE BURROUGHS' })

    expect(titleOf(answer.candidates[0]!.id)).toBe('The Gods of Mars')
    expect(answer.confident).toBeNull()
  })
})

/**
 * A reading as Paddle answers it: the text, and each line with the height of
 * its box, so a title in large type can be told from a tagline in small.
 */
function cover(...lines: [string, number][]) {
  return {
    reading: lines.map(([text]) => text).join('\n'),
    lines: lines.map(([text, height]) => ({ text, height })),
  }
}

const DUNE_MESSIAH_COVER = cover(['NEW YORK TIMES BESTSELLER', 14], ['Dune Messiah', 42], ['Frank Herbert', 28], ['A NOVEL', 14])
const DUNE_COVER = cover(['NEW YORK TIMES BESTSELLER', 14], ['Dune', 42], ['Frank Herbert', 28], ['A NOVEL', 14])

describe('a title that sits inside a sibling\'s ("Dune" and "Dune Messiah")', () => {
  /** One series design, so the picture puts the catalogued volume first whichever is held. */
  async function shelfOf(...titles: string[]): Promise<void> {
    db = await openTestDatabase()
    for (const title of Object.keys(ids)) delete ids[title]
    for (const title of titles) await shelve(title, 'Frank Herbert')
    await shelve('Perdido Street Station', 'China Miéville')
    await shelve('The Left Hand of Darkness', 'Ursula K. Le Guin')
  }

  it('does not open "Dune" for a photograph of an uncatalogued "Dune Messiah"', async () => {
    await shelfOf('Dune')
    const answer = await matcher(pictures([['Dune', 0.94], ['Perdido Street Station', 0.4]]))
      .handle({ photo: PHOTO, ...DUNE_MESSIAH_COVER })
    expect(titleOf(answer.candidates[0]!.id)).toBe('Dune')
    expect(answer.confident).toBeNull()
  })

  it('does not open "Dune" for it with the image model off either', async () => {
    await shelfOf('Dune')
    const answer = await matcher(pictures(null)).handle({ photo: PHOTO, ...DUNE_MESSIAH_COVER })
    expect(answer.confident).toBeNull()
  })

  it('does not open "Dune" when OCR breaks the title over two lines', async () => {
    await shelfOf('Dune')
    const answer = await matcher(pictures([['Dune', 0.94]]))
      .handle({ photo: PHOTO, ...cover(['DUNE', 44], ['MESSIAH', 44], ['FRANK HERBERT', 26]) })
    expect(answer.confident).toBeNull()
  })

  it('does not open "Dune Messiah" for a photograph of an uncatalogued "Dune"', async () => {
    await shelfOf('Dune Messiah')
    const answer = await matcher(pictures([['Dune Messiah', 0.94], ['Perdido Street Station', 0.4]]))
      .handle({ photo: PHOTO, ...DUNE_COVER })
    expect(titleOf(answer.candidates[0]!.id)).toBe('Dune Messiah')
    expect(answer.confident).toBeNull()
  })

  it('with both catalogued, opens "Dune Messiah" for its cover and asks about "Dune", with "Dune" first', async () => {
    await shelfOf('Dune', 'Dune Messiah')
    const messiah = await matcher(pictures([['Dune Messiah', 0.94], ['Dune', 0.9]]))
      .handle({ photo: PHOTO, ...DUNE_MESSIAH_COVER })
    expect(titleOf(messiah.confident)).toBe('Dune Messiah')

    // On a "Dune" cover the two volumes score close together on the words,
    // and the bar does not open on a close call: it asks, which is the safe
    // way to be unsure. Nothing else differs between these two photographs.
    const dune = await matcher(pictures([['Dune', 0.94], ['Dune Messiah', 0.9]])).handle({ photo: PHOTO, ...DUNE_COVER })
    expect(dune.confident).toBeNull()
    expect(titleOf(dune.candidates[0]!.id)).toBe('Dune')
  })

  it('still opens a book whose cover carries a tagline in small type', async () => {
    await shelfOf('Dune')
    const answer = await matcher(pictures([['Dune', 0.94]]))
      .handle({ photo: PHOTO, ...cover(['WINNER OF THE HUGO AWARD', 14], ['Dune', 42], ['Frank Herbert', 28]) })
    expect(titleOf(answer.confident)).toBe('Dune')
  })
})

describe('when it opens a book', () => {
  it('opens the book when the picture and its printed title agree', async () => {
    const answer = await matcher(pictures(BARSOOM_PICTURE))
      .handle({ photo: PHOTO, reading: 'EDGAR RICE BURROUGHS\nA PRINCESS OF MARS' })
    expect(titleOf(answer.confident)).toBe('A Princess of Mars')
    expect(titleOf(answer.candidates[0]!.id)).toBe('A Princess of Mars')
  })

  it('opens a book whose title is printed when the picture has it on its shortlist, not only first', async () => {
    const answer = await matcher(pictures([['Perdido Street Station', 0.7], ['Dune', 0.66], ['A Princess of Mars', 0.6]]))
      .handle({ photo: PHOTO, reading: 'FRANK HERBERT DUNE' })
    expect(titleOf(answer.confident)).toBe('Dune')
    // Confident goes first, whatever the fusion made of the picture's opinion.
    expect(titleOf(answer.candidates[0]!.id)).toBe('Dune')
  })

  it('does not open a printed title the picture does not recognise at all', async () => {
    // A cover with the right words on the wrong picture, such as a photograph
    // of a list, a spine label or another edition's back, is not the agreement
    // this bar asks for.
    const answer = await matcher(pictures(BARSOOM_PICTURE.filter(([title]) => title !== 'Dune')))
      .handle({ photo: PHOTO, reading: 'FRANK HERBERT DUNE' })
    expect(answer.confident).toBeNull()
    expect(answer.candidates.map((candidate) => titleOf(candidate.id))).toContain('Dune')
  })

  it('never opens on the hash, however close', async () => {
    const answer = await matcher(pictures(null), hashes([['The Left Hand of Darkness', 0]]))
      .handle({ photo: PHOTO, reading: '' })
    expect(answer.confident).toBeNull()
    expect(titleOf(answer.candidates[0]!.id)).toBe('The Left Hand of Darkness')
    expect(answer.candidates[0]!.distance).toBe(0)
  })
})

describe('with the image model off ("[covers] similarity is off")', () => {
  it('still ranks by the words and the hash, and says the picture was not asked', async () => {
    const answer = await matcher(pictures(null), hashes([['Perdido Street Station', 12], ['Dune', 20]]))
      .handle({ photo: PHOTO, reading: 'URSULA K.LE GUIN THE LEFT HAND 0F DARKNES5' })

    expect(answer.pictures).toBe(false)
    expect(answer.candidates.every((candidate) => candidate.similarity === null)).toBe(true)
    const titles = answer.candidates.map((candidate) => titleOf(candidate.id))
    expect(titles).toContain('The Left Hand of Darkness')
    // The hash takes part inside its similar band and not past it.
    expect(answer.candidates.find((candidate) => titleOf(candidate.id) === 'Perdido Street Station')?.distance).toBe(12)
    expect(answer.candidates.every((candidate) => candidate.distance === null || candidate.distance <= 16)).toBe(true)
  })

  it('opens a book on its printed title alone', async () => {
    const answer = await matcher(pictures(null)).handle({ photo: PHOTO, reading: 'FRANK HERBERT DUNE' })
    expect(titleOf(answer.confident)).toBe('Dune')
  })

  it('answers nothing for a photograph with no words and no hash', async () => {
    const answer = await matcher(pictures(null)).handle({ photo: PHOTO, reading: '' })
    expect(answer).toEqual({ candidates: [], confident: null, pictures: false })
  })
})

describe('reciprocal rank fusion', () => {
  it('puts a book two strategies rank second above a book one strategy ranks first', () => {
    const fused = fuse([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 2 }]])
    expect([...fused.entries()].sort((a, b) => b[1] - a[1])[0]![0]).toBe(2)
    expect(fused.get(1)).toBeCloseTo(1 / 61)
    expect(fused.get(2)).toBeCloseTo(2 / 62)
  })
})
