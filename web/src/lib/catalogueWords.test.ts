/**
 * What the app says about a catalogue that has been quiet (#348).
 *
 * The server's half of this is tested in `server/source-watch.test.ts` and
 * `server/lookup-sources.test.ts`, where five real behaviours produce five
 * different reports. This is the other half of the same claim: that the five
 * survive being turned into sentences, and that the two facts a person can act
 * on are the two that reach the screen he is actually looking at.
 *
 * The one that would be easy to lose is the negative: a catalogue merely having
 * a bad afternoon must draw nothing on the first screen. A card drawn for
 * weather is a card somebody learns to scroll past, and this screen carries two
 * others that must not be scrolled past.
 */

import { describe, expect, it } from 'vitest'
import { catalogueRoll, catalogueTrouble } from './catalogueWords'
import type { LookupStandings, SourceStanding } from './api'

/** A catalogue at nought, which is what a server that has looked nothing up reports. */
function standing(over: Partial<SourceStanding> & { source: string }): SourceStanding {
  return {
    asked: 0,
    answered: 0,
    silent: 0,
    held: 0,
    noRecord: 0,
    declined: 0,
    failed: 0,
    skipped: 0,
    lastSilentAt: '',
    lastSilence: '',
    ...over,
  }
}

/** The four catalogues, each in whatever state a test puts it in. */
function report(
  over: Partial<Record<string, Partial<SourceStanding>>> = {},
  googleBooksKeyConfigured = false,
): LookupStandings {
  const names = ['Open Library', 'Google Books', 'Library of Congress', 'K10plus']
  return {
    googleBooksKeyConfigured,
    sources: names.map((source) => standing({ source, ...(over[source] ?? {}) })),
  }
}

/** A catalogue asked about twelve books, all of them refused. */
const refused = { asked: 12, silent: 12, declined: 12 }

/** A catalogue asked about twelve books, all of them timing out. */
const brokenDown = { asked: 12, silent: 12, failed: 12 }

/** A catalogue doing its job: twelve books, ten of which it had. */
const working = { asked: 12, answered: 12, held: 10, noRecord: 2 }

describe('the card on the first screen', () => {
  it('says nothing at all while the read has not answered', () => {
    // The same silence `backupWords.ts` keeps, and for the same reason: a
    // sentence written from a request that never came back is worth less than
    // no sentence.
    expect(catalogueTrouble(null)).toBeNull()
  })

  it('says nothing on a day when every catalogue is answering', () => {
    // There is no reassuring card in here. A line saying the catalogues are
    // fine is a line a bug can print over a lookup that never happened.
    expect(catalogueTrouble(report({
      'Open Library': working,
      'Google Books': working,
    }))).toBeNull()
  })

  it('says nothing about a catalogue nobody has asked', () => {
    // The two supplementary catalogues are asked only about a book the first
    // pair left a gap in, so nought is an ordinary state and not news.
    expect(catalogueTrouble(report({ 'Open Library': working }))).toBeNull()
  })

  it('says nothing about a catalogue that is merely failing', () => {
    /*
     * The deliberate omission, and the reason the server had to learn the
     * difference between a refusal and a failure before this file could exist.
     * A timeout ends on its own, often before the shelf is finished. Putting it
     * on the first screen would be putting weather next to a backup that has
     * stopped.
     */
    expect(catalogueTrouble(report({
      'Open Library': working,
      'Google Books': brokenDown,
    }))).toBeNull()
  })

  it('says nothing about a catalogue that is refusing but still answering', () => {
    // Contributing and also having a bad morning. The counters have it and
    // Settings shows it; the first screen is for what will still be true
    // tomorrow.
    expect(catalogueTrouble(report({
      'Google Books': { asked: 12, answered: 8, held: 8, silent: 4, declined: 4 },
    }))).toBeNull()
  })

  it('says which catalogue, and how many books it described nothing of', () => {
    const said = catalogueTrouble(report({
      'Open Library': working,
      'Google Books': refused,
    }))!

    expect(said.title).toBe(
      'Google Books has described none of the 12 books you have looked up',
    )
    // The reassurance is the point of the second half: a person holding a book
    // has done nothing wrong and nothing they catalogued is wrong.
    expect(said.said).toContain('Nothing you have catalogued is wrong')
    expect(said.said).toContain('Where your books are described from')
  })

  it('names every refusing catalogue rather than the first one', () => {
    /*
     * A report that reads as complete and is not is the whole defect being
     * fixed, so a card mentioning one of two would rebuild it one storey up.
     */
    const said = catalogueTrouble(report({
      'Google Books': refused,
      K10plus: { asked: 3, silent: 3, declined: 3 },
    }))!

    expect(said.said).toContain('K10plus')
  })

  it('says that there is no key when that is why it is being refused', () => {
    const said = catalogueTrouble(report({ 'Google Books': refused }, false))!

    expect(said.said).toContain('without a key')
    expect(said.said).toContain('pool everybody shares')
  })

  it('does not blame a missing key when there is one', () => {
    const said = catalogueTrouble(report({ 'Google Books': refused }, true))!

    expect(said.said).not.toContain('without a key')
    expect(said.said).toContain('turning the request away')
  })

  it('never says anything about a key beyond whether there is one', () => {
    for (const keyed of [true, false]) {
      const said = catalogueTrouble(report({ 'Google Books': refused }, keyed))!
      // No length, no prefix, no masked form. The boolean is the whole of what
      // the wire carries and the whole of what may be said.
      expect(said.said).not.toMatch(/[A-Za-z0-9_-]{20,}/)
    }
  })
})

describe('the card in Settings', () => {
  it('says nothing while the read has not answered', () => {
    // A card of noughts drawn from a failed request would say every catalogue
    // has been asked nothing, which is a claim and not a silence.
    expect(catalogueRoll(null)).toBeNull()
  })

  it('names every catalogue, including the ones that have done nothing', () => {
    const roll = catalogueRoll(report({ 'Open Library': working }))!

    expect(roll.rows.map((one) => one.source)).toEqual([
      'Open Library', 'Google Books', 'Library of Congress', 'K10plus',
    ])
  })

  it('tells a catalogue nobody asked from a catalogue that had no record', () => {
    /*
     * The two that look identical from outside, side by side. Library of
     * Congress was never consulted; Google Books was consulted twelve times and
     * has never heard of any of those books. Both contributed nothing.
     */
    const roll = catalogueRoll(report({
      'Google Books': { asked: 12, answered: 12, held: 0, noRecord: 12 },
    }))!
    const said = (source: string) => roll.rows.find((one) => one.source === source)!.said

    expect(said('Library of Congress')).toBe('Not asked yet.')
    expect(said('Google Books')).toContain('had no record of 12')
    expect(said('Google Books')).not.toBe(said('Library of Congress'))
  })

  it('tells a catalogue that refused from a catalogue that failed', () => {
    const roll = catalogueRoll(report({
      'Google Books': refused,
      K10plus: brokenDown,
    }))!
    const said = (source: string) => roll.rows.find((one) => one.source === source)!.said

    expect(said('Google Books')).toContain('turned away 12')
    expect(said('Google Books')).toContain('failed on 0')
    expect(said('K10plus')).toContain('turned away 0')
    expect(said('K10plus')).toContain('failed on 12')
  })

  it('says the noughts out loud rather than leaving them off', () => {
    // The rule this whole issue produced. An absent number reads as "nothing to
    // report" and means the opposite.
    const roll = catalogueRoll(report({ 'Open Library': working }))!
    const said = roll.rows.find((one) => one.source === 'Open Library')!.said

    expect(said).toBe(
      'Asked about 12 books: described 10, had no record of 2, '
      + 'turned away 0, failed on 0.',
    )
  })

  it('separates a catalogue held back by its rate limit from one never wanted', () => {
    const roll = catalogueRoll(report({
      'Library of Congress': { skipped: 4 },
    }))!
    const said = (source: string) => roll.rows.find((one) => one.source === source)!.said

    expect(said('Library of Congress')).toContain('Wanted 4 times and not asked')
    expect(said('K10plus')).toBe('Not asked yet.')
  })

  it('says whether the second catalogue has a key, and where one is set', () => {
    expect(catalogueRoll(report({}, true))!.keyed)
      .toBe('Google Books is being asked with a key.')

    const without = catalogueRoll(report({}, false))!.keyed
    expect(without).toContain('without a key')
    // And says plainly that this screen is not where one is typed, so nobody
    // waits for a field that is never coming.
    expect(without).toContain('where the server runs, not here')
  })

  it('says the counts start again, so a nought is about today', () => {
    // They live in the server process and a restart empties them. A card that
    // let "asked 0" read as "never asked, ever" would be inventing the
    // ambiguity it exists to remove.
    expect(catalogueRoll(report())!.said).toContain('start again each time')
  })
})
