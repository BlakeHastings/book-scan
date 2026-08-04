/**
 * What the detail view shows. Every case here is a book that really exists in
 * the catalogue: ones photographed before the spine slot was added, ones whose
 * publisher cover was never found, and ones whose spine was shot before spines
 * were cropped. A gallery that assumes all five images shows gaps and offers
 * swipes that go nowhere for most of the collection.
 */

import { describe, expect, it } from 'vitest'
import { frameAtScroll, gallery, spineShape, SPINE_MAX_ASPECT } from './gallery'

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
