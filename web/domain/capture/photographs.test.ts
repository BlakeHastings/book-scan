/**
 * The photograph rules, with no database anywhere near them.
 *
 * The whole point of the domain layer, and the reason this file opens nothing:
 * "the detector looked and declined" versus "the detector never ran" is a rule
 * about facts, not about columns, and it should be checkable without a Postgres
 * container.
 */

import { describe, expect, it } from 'vitest'
import {
  PHOTOGRAPH_KINDS, Photographs, isPhotographKind, shownFile, verdictOf, wantsExamining,
  type Photograph, type PhotographKind,
} from './photographs'

function photograph(over: Partial<Photograph> = {}): Photograph {
  return {
    kind: 'front',
    file: 'front.jpg',
    cropFile: '',
    examined: false,
    hash: '',
    takenAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('what the detector made of a photograph', () => {
  it('says nothing about a photograph it has never been shown', () => {
    expect(verdictOf(photograph())).toBe('unexamined')
  })

  it('separates looking and declining from never having looked', () => {
    // The distinction this table exists to keep. Two photographs with an empty
    // crop, and they are not the same fact: one of them has been through the
    // detector and one of them has not, and only the first licenses a view to
    // say the book could not be picked out of it.
    const neverLooked = photograph({ examined: false, cropFile: '' })
    const lookedAndDeclined = photograph({ examined: true, cropFile: '' })

    expect(verdictOf(neverLooked)).toBe('unexamined')
    expect(verdictOf(lookedAndDeclined)).toBe('declined')
    expect(verdictOf(neverLooked)).not.toBe(verdictOf(lookedAndDeclined))
  })

  it('reports a crop as a crop, whatever the flag says', () => {
    // The file is evidence and the flag is bookkeeping. A crop that exists was
    // produced by a detector that was looking at the time.
    expect(verdictOf(photograph({ examined: false, cropFile: 'front_crop.jpg' }))).toBe('cropped')
    expect(verdictOf(photograph({ examined: true, cropFile: 'front_crop.jpg' }))).toBe('cropped')
  })

  it('offers a declined photograph to the detector no more than once', () => {
    expect(wantsExamining(photograph())).toBe(true)
    expect(wantsExamining(photograph({ examined: true }))).toBe(false)
    expect(wantsExamining(photograph({ cropFile: 'c.jpg' }))).toBe(false)
  })
})

describe('which file a view draws', () => {
  it('draws the crop when there is one', () => {
    expect(shownFile(photograph({ cropFile: 'front_crop.jpg' }))).toBe('front_crop.jpg')
  })

  it('draws the whole photograph when the detector declined', () => {
    expect(shownFile(photograph({ examined: true }))).toBe('front.jpg')
  })
})

describe('the kinds', () => {
  it('is the vocabulary docs/data-model.md settles, and spine is not edge', () => {
    expect([...PHOTOGRAPH_KINDS]).toEqual(['front', 'back', 'spine', 'catalogue'])
    expect(isPhotographKind('spine')).toBe(true)
    // `edge` is a column name from the schema this replaces. Nothing above the
    // migration should be able to say it.
    expect(isPhotographKind('edge')).toBe(false)
  })
})

describe('a book with several photographs of one kind', () => {
  const shots = (kind: PhotographKind, ...times: string[]) =>
    times.map((takenAt, at) => photograph({ kind, file: `${kind}-${at}.jpg`, takenAt }))

  it('answers "the spine" with the newest one, and keeps the rest', () => {
    // The feature this whole table is for: a blurred spine is re-shot and the
    // blurred one is still there afterwards.
    const photographs = Photographs.of(shots(
      'spine',
      '2026-01-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ))

    expect(photographs.latest('spine')?.file).toBe('spine-1.jpg')
    expect(photographs.ofKind('spine').map((one) => one.file))
      .toEqual(['spine-1.jpg', 'spine-0.jpg'])
    expect(photographs.count).toBe(2)
  })

  it('keeps the order they were handed over in when two share a timestamp', () => {
    // Every row the migration writes carries books.scanned_at, which was one
    // value for all three slots, so ties are the normal case rather than a
    // corner. A sort that reordered them would make "the front" unstable
    // between two reads of the same rows.
    const photographs = Photographs.of(shots(
      'front',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ))
    expect(photographs.ofKind('front').map((one) => one.file))
      .toEqual(['front-0.jpg', 'front-1.jpg', 'front-2.jpg'])
  })

  it('answers null for a kind nobody has photographed', () => {
    expect(Photographs.of([]).latest('back')).toBeNull()
    expect(Photographs.of([]).kinds()).toEqual([])
  })

  it('lists the kinds it has in the order somebody flicks through them', () => {
    const photographs = Photographs.of([
      photograph({ kind: 'catalogue', file: 'cover.jpg' }),
      photograph({ kind: 'spine', file: 'spine.jpg' }),
      photograph({ kind: 'front', file: 'front.jpg' }),
    ])
    expect(photographs.kinds()).toEqual(['front', 'spine', 'catalogue'])
  })

  it('never offers the publisher artwork to the detector', () => {
    // The detector finds a book in a room. A downloaded cover has no room in
    // it, and a crop of one would be a crop of a picture rather than of this
    // copy. See PHOTOGRAPHED_KINDS.
    const photographs = Photographs.of([
      photograph({ kind: 'catalogue', file: 'cover.jpg' }),
      photograph({ kind: 'front', file: 'front.jpg' }),
    ])
    expect(photographs.wantingExamination().map((one) => one.kind)).toEqual(['front'])
  })
})
