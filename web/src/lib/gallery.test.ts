/**
 * What the detail view shows. Every case here is a book that really exists in
 * the catalogue: ones photographed before the spine slot was added, ones whose
 * publisher cover was never found, and ones whose spine was shot before spines
 * were cropped. A gallery that assumes all five images shows gaps and offers
 * swipes that go nowhere for most of the collection.
 */

import { describe, expect, it } from 'vitest'
import {
  BEFORE_SPINE_CROP, frameAfterSources, frameAtScroll, gallery, samePhotos, spineShape,
  SPINE_CUT_FROM_WHOLE, SPINE_MAX_ASPECT, SPINE_NOT_FOUND, UNCROPPED_NOTE,
} from './gallery'

const all = {
  catalogue: '/api/covers/cat.jpg',
  front: '/api/covers/front.jpg',
  back: '/api/covers/back.jpg',
  edge: '/api/covers/edge.jpg',
}

const kinds = (frames: { kind: string }[]) => frames.map((f) => f.kind)

describe('gallery', () => {
  it('leads with the catalogue picture and swipes front then back', () => {
    const { swipe } = gallery(all, 'strip')
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back'])
  })

  it('keeps the spine beside the swiped image rather than in it', () => {
    const { swipe, beside } = gallery(all, 'strip')
    expect(beside?.kind).toBe('edge')
    expect(kinds(swipe)).not.toContain('edge')
  })

  it('says whose picture the catalogue one is', () => {
    // The distinction the rest of the app already makes: a catalogue image is
    // what the edition looks like, not what this copy looks like.
    expect(gallery(all, 'strip').swipe[0]?.note).toMatch(/publisher/i)
  })

  it('drops the spine entirely for a book photographed before the slot existed', () => {
    const { swipe, beside } = gallery(
      { catalogue: all.catalogue, front: all.front, back: all.back },
      'strip',
    )
    expect(beside).toBeNull()
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back'])
  })

  it('opens on the front photo when no publisher cover was ever found', () => {
    const { swipe } = gallery({ front: all.front, back: all.back, edge: all.edge }, 'strip')
    expect(kinds(swipe)).toEqual(['front', 'back'])
  })

  it('offers no swipe at all for a book with a single photo', () => {
    // A one-frame gallery must not render dots or a scroll that goes nowhere;
    // the component decides that from the length, so the length has to be 1.
    expect(gallery({ back: all.back }).swipe).toHaveLength(1)
  })

  it('gives a lone spine the whole gallery instead of a margin', () => {
    // Nothing to sit beside, and a strip on its own next to blank space reads
    // as a broken layout rather than as the only photo there is.
    const { swipe, beside } = gallery({ edge: all.edge }, 'strip')
    expect(kinds(swipe)).toEqual(['edge'])
    expect(beside).toBeNull()
  })

  it('returns nothing to draw for a book with no images', () => {
    const { swipe, beside } = gallery({})
    expect(swipe).toEqual([])
    expect(beside).toBeNull()
  })

  it('shows a whole-book spine photo at full size and says why', () => {
    // Squeezed into a strip two centimetres wide it would be unreadable, and
    // cropping it would mean finding the spine, which nothing here can do.
    const { swipe, beside } = gallery(all, 'whole')
    expect(beside).toBeNull()
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back', 'edge'])
    expect(swipe[3]?.note).toMatch(/whole/i)
  })

  it('assumes a strip until the spine has been measured', () => {
    // First render, before the image has loaded. The common case by far is a
    // cropped spine, so reserving the space beside avoids a jump for it.
    expect(gallery(all).beside?.kind).toBe('edge')
  })
})

describe('spineShape', () => {
  it('recognises a capture cropped by the spine guide', () => {
    // SPINE_CROP is 0.24 wide by 0.68 tall of the displayed frame, so a
    // capture off a 393x852 phone lands around 0.16.
    expect(spineShape(94, 579)).toBe('strip')
  })

  it('recognises a whole book photographed before the crop existed', () => {
    expect(spineShape(1800, 2400)).toBe('whole') // portrait, 0.75
    expect(spineShape(2400, 1800)).toBe('whole') // landscape
  })

  it('waits rather than guessing from an image that has not loaded', () => {
    // naturalWidth is 0 until the bytes arrive, and 0/0 is not a shape.
    expect(spineShape(0, 0)).toBe('unknown')
  })

  it('sits its threshold well clear of both real shapes', () => {
    // A guess that flips between renders would move the layout under a thumb.
    expect(SPINE_MAX_ASPECT).toBeGreaterThan(0.16 * 1.5)
    expect(SPINE_MAX_ASPECT).toBeLessThan(0.75 / 1.5)
  })
})

describe('showing the crop but keeping the photograph', () => {
  it('draws the crop and remembers the whole photo behind it', () => {
    const { swipe } = gallery({
      ...all,
      crops: { front: '/api/covers/front_crop.jpg' },
      examined: ['front', 'back', 'edge'],
    }, 'strip')

    const front = swipe.find((frame) => frame.kind === 'front')!
    expect(front.src).toBe('/api/covers/front_crop.jpg')
    // Tapping opens this, so the photograph somebody took is never out of
    // reach just because a tighter version of it exists.
    expect(front.full).toBe('/api/covers/front.jpg')
  })

  it('says so when the detector looked and could not find the book', () => {
    const { swipe } = gallery({
      ...all,
      crops: { front: '/api/covers/front_crop.jpg' },
      examined: ['front', 'back'],
    }, 'strip')

    const back = swipe.find((frame) => frame.kind === 'back')!
    expect(back.src).toBe('/api/covers/back.jpg')
    expect(back.note).toContain('could not be picked out')
  })

  it('says nothing about photos taken before any of this existed', () => {
    // Which is every photo in the catalogue on the day this shipped. A
    // failure notice under all of them would be noise, and it would be a
    // claim about a detector that has never seen them.
    const { swipe } = gallery(all, 'strip')
    for (const frame of swipe) {
      expect(frame.note).not.toContain('could not be picked out')
    }
  })

  it('says one sentence about a whole spine rather than stacking two', () => {
    // The caption is chosen from the three states rather than concatenated,
    // so a reader gets the reason that applies and not a list of reasons.
    const { swipe } = gallery({ ...all, examined: ['edge'] }, 'whole')
    const spine = swipe.find((frame) => frame.kind === 'edge')!
    expect(spine.note).toBe(SPINE_NOT_FOUND)
  })

  it('crops the spine beside the swipe too', () => {
    const { beside } = gallery({
      ...all,
      crops: { edge: '/api/covers/edge_crop.jpg' },
      examined: ['edge'],
    }, 'strip')

    expect(beside?.src).toBe('/api/covers/edge_crop.jpg')
    expect(beside?.full).toBe('/api/covers/edge.jpg')
  })

  it('never crops the catalogue picture, which has no room around it', () => {
    const { swipe } = gallery({
      ...all,
      crops: { front: '/api/covers/front_crop.jpg' },
      examined: ['front'],
    }, 'strip')

    const catalogue = swipe.find((frame) => frame.kind === 'catalogue')!
    expect(catalogue.src).toBe('/api/covers/cat.jpg')
    expect(catalogue.full).toBe('/api/covers/cat.jpg')
  })
})

describe('why a spine is a photograph of a whole book', () => {
  /**
   * Three states, three sentences (#108). One sentence for all three said
   * "shot before spines were cropped" about a photo a detector had refused
   * and about one it had successfully cut down, and only the first of the
   * three was ever true.
   */
  const spine = (sources: Parameters<typeof gallery>[0]) =>
    gallery(sources, 'whole').swipe.find((frame) => frame.kind === 'edge')!

  it('blames the capture crop only where nothing has looked at the photo', () => {
    // The oldest rows in the catalogue: photographed before the spine guide
    // existed, and never put through the detector either, so the shape of the
    // picture is the whole of the explanation. `cropped` is empty for every
    // book saved before any of this, and the backfill is run by hand, so this
    // is still the ordinary case rather than a historical one.
    expect(spine(all).note).toBe(BEFORE_SPINE_CROP)
    expect(spine({ ...all, examined: ['front', 'back'] }).note).toBe(BEFORE_SPINE_CROP)
  })

  it('says the detector refused it, rather than blaming the capture crop', () => {
    // Named in `cropped` with an empty crop column: looked at and declined.
    // Saying it was shot before cropping is true of the shape and false about
    // why it is still whole, which is the wrong reason the issue is about.
    expect(spine({ ...all, examined: ['edge'] }).note).toBe(SPINE_NOT_FOUND)
    expect(spine({ ...all, examined: ['edge'] }).note).toContain('could not be picked out')
  })

  it('does not call a cropped spine whole', () => {
    const cropped = spine({
      ...all,
      crops: { edge: '/api/covers/edge_crop.jpg' },
      examined: ['edge'],
    })

    expect(cropped.src).toBe('/api/covers/edge_crop.jpg')
    expect(cropped.note).toBe(SPINE_CUT_FROM_WHOLE)
    expect(cropped.note).not.toContain('whole photo')
  })

  it('still sends the reader to the photograph the crop came from', () => {
    // The crop is captioned as a crop, so the frame after it, which is the
    // photograph itself, keeps saying what it is.
    const { swipe } = gallery({
      ...all,
      crops: { edge: '/api/covers/edge_crop.jpg' },
      examined: ['edge'],
    }, 'whole')

    expect(swipe.at(-1)?.src).toBe(all.edge)
    expect(swipe.at(-1)?.note).toBe(UNCROPPED_NOTE)
  })

  it('says something different in each of the three states', () => {
    const notes = [
      spine(all).note,
      spine({ ...all, examined: ['edge'] }).note,
      spine({ ...all, crops: { edge: '/api/covers/edge_crop.jpg' }, examined: ['edge'] }).note,
    ]

    expect(new Set(notes).size).toBe(3)
    for (const note of notes) expect(note).not.toBe('')
  })

  it('leaves a spine that really is a strip alone', () => {
    // A capture made since the spine guide existed needs no explanation at
    // all, and none of these three sentences is true of it.
    expect(gallery(all, 'strip').beside?.note).toBe('')
  })
})

describe('scrolling from the crops into the full photos', () => {
  it('runs the cropped photos first, then continues into the uncropped ones', () => {
    const { swipe } = gallery({
      ...all,
      crops: {
        front: '/api/covers/front_crop.jpg',
        back: '/api/covers/back_crop.jpg',
      },
      examined: ['front', 'back'],
    }, 'strip')

    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back', 'front', 'back'])
    expect(swipe.map((frame) => frame.src)).toEqual([
      all.catalogue,
      '/api/covers/front_crop.jpg',
      '/api/covers/back_crop.jpg',
      all.front,
      all.back,
    ])
  })

  it('does not show a declined photo twice', () => {
    // Front was cropped; back was looked at and declined, so its one frame is
    // already the whole photo. Appending it again as a "full" continuation
    // would be the exact duplicate #98 warned about.
    const { swipe } = gallery({
      ...all,
      crops: { front: '/api/covers/front_crop.jpg' },
      examined: ['front', 'back'],
    }, 'strip')

    expect(swipe.filter((frame) => frame.src === all.back)).toHaveLength(1)
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back', 'front'])
  })

  it('does not add a continuation for a photo nobody has ever examined', () => {
    const { swipe } = gallery(all, 'strip')
    expect(swipe.every((frame) => frame.note !== UNCROPPED_NOTE)).toBe(true)
  })

  it('says the continuation is the whole photo the crop above was cut from', () => {
    const { swipe } = gallery({
      ...all,
      crops: { front: '/api/covers/front_crop.jpg' },
      examined: ['front'],
    }, 'strip')

    const crop = swipe.find((frame) => frame.kind === 'front')!
    const continuation = swipe.filter((frame) => frame.kind === 'front').at(-1)!
    expect(continuation.src).toBe(all.front)
    expect(continuation.note).toBe(UNCROPPED_NOTE)
    expect(continuation.label).not.toBe(crop.label) // reads as a different frame from the crop
  })

  it('continues a lone cropped spine into its full photo too', () => {
    // No front, back or catalogue: the spine is the whole gallery, so it is
    // treated like any other swiped photo rather than staying tap-only.
    const { swipe, beside } = gallery({
      edge: all.edge,
      crops: { edge: '/api/covers/edge_crop.jpg' },
      examined: ['edge'],
    }, 'strip')

    expect(beside).toBeNull()
    expect(swipe.map((frame) => frame.src)).toEqual(['/api/covers/edge_crop.jpg', all.edge])
  })

  it('continues a whole-book spine crop into its full photo too', () => {
    const { swipe } = gallery({ ...all, crops: { edge: '/api/covers/edge_crop.jpg' } }, 'whole')
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back', 'edge', 'edge'])
    expect(swipe.at(-1)?.src).toBe(all.edge)
  })

  it('leaves the spine beside the swipe reachable only by tapping, not doubled into it', () => {
    // The spine beside the swipe is not swiped past at all (it never was,
    // #98), so it is not part of "the carousel" this scroll-into-the-full-
    // photos behaviour extends. Its full photo stays one tap away.
    const { swipe, beside } = gallery({
      ...all,
      crops: { edge: '/api/covers/edge_crop.jpg' },
      examined: ['edge'],
    }, 'strip')

    expect(kinds(swipe)).not.toContain('edge')
    expect(beside?.src).toBe('/api/covers/edge_crop.jpg')
    expect(beside?.full).toBe(all.edge)
  })

  it('never leaves a dead scroll position: no frame is added for a book with no crops at all', () => {
    const { swipe } = gallery(all, 'strip')
    expect(kinds(swipe)).toEqual(['catalogue', 'front', 'back'])
  })
})

describe('frameAtScroll', () => {
  it('reports the frame a settled scroll is showing', () => {
    expect(frameAtScroll(0, 320, 3)).toBe(0)
    expect(frameAtScroll(320, 320, 3)).toBe(1)
    expect(frameAtScroll(640, 320, 3)).toBe(2)
  })

  it('rounds to the frame in view rather than the one just left', () => {
    // Snap points land a pixel or two off on a real device, and a dot that
    // says frame one while frame two fills the screen is worse than no dot.
    expect(frameAtScroll(318, 320, 3)).toBe(1)
    expect(frameAtScroll(322, 320, 3)).toBe(1)
  })

  it('never names a frame that does not exist', () => {
    // Rubber-band overscroll on iOS reports past the end, and briefly negative.
    expect(frameAtScroll(9999, 320, 3)).toBe(2)
    expect(frameAtScroll(-40, 320, 3)).toBe(0)
  })

  it('answers zero before the element has been laid out', () => {
    expect(frameAtScroll(0, 0, 3)).toBe(0)
  })
})

describe('opening another book in a gallery that is already on screen', () => {
  /** The next book along the shelf: different copy, so different photographs. */
  const neighbour = {
    catalogue: '/api/covers/cat2.jpg',
    front: '/api/covers/front2.jpg',
    back: '/api/covers/back2.jpg',
    edge: '/api/covers/edge2.jpg',
  }

  it('opens a neighbour at its first photograph', () => {
    // Walking a shelf from the detail row is the common action there (#81),
    // and the frame index used to carry over, so the next book opened part
    // way through its own photographs.
    expect(frameAfterSources(3, all, neighbour, 4)).toBe(0)
  })

  it('opens a neighbour with fewer photographs at the first, not the last', () => {
    // Clamping is what the carry-over degraded into: a book with two frames
    // opened on its second rather than on its first.
    expect(frameAfterSources(3, all, { front: neighbour.front }, 1)).toBe(0)
  })

  /** The same copy, after a relookup found no publisher cover for the new ISBN. */
  const noCover = { front: all.front, back: all.back, edge: all.edge }

  it('keeps your place when the book on screen loses a picture', () => {
    // Changing an ISBN replaces the catalogue cover. The book in your hand is
    // the same book, so the photo you were looking at should not move.
    expect(frameAfterSources(2, all, noCover, 3)).toBe(2)
  })

  it('pulls a place that no longer exists back inside the frames that are left', () => {
    expect(frameAfterSources(3, all, noCover, 3)).toBe(2)
  })

  it('answers zero for a book with nothing to show', () => {
    expect(frameAfterSources(2, all, {}, 0)).toBe(0)
  })

  it('starts at the first frame on the very first render', () => {
    // The gallery has shown nothing yet, so there is no place to keep.
    expect(frameAfterSources(0, {}, all, 4)).toBe(0)
  })
})

describe('samePhotos', () => {
  it('is the three photographs of this copy and not the catalogue picture', () => {
    const swapped = { ...all, catalogue: '/api/covers/other.jpg' }
    expect(samePhotos(all, swapped)).toBe(true)
    expect(samePhotos(all, { ...all, edge: '/api/covers/edge2.jpg' })).toBe(false)
  })

  it('does not confuse a book that has no photographs with one that has', () => {
    expect(samePhotos({ catalogue: all.catalogue }, all)).toBe(false)
  })

  it('ignores the crops, which are derived from the photographs it compares', () => {
    // A crop arriving after a backfill is the same book, newly cut down.
    expect(samePhotos(all, { ...all, crops: { front: '/api/covers/front_crop.jpg' } })).toBe(true)
  })
})
