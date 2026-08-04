/**
 * Which photos a book's detail view shows, and in what order.
 *
 * Five images at once is most of a phone screen for something you are holding
 * a book in front of. One at a time answers the same questions: the catalogue
 * cover is what the record claims, the spine is what you look for on a shelf,
 * and the front and back are yours if you want them.
 *
 * Kept as data rather than as JSX so the ordering and the degrading are
 * testable without a DOM. Everything here is a decision about what to show;
 * the component only draws the answer.
 */

export type FrameKind = 'catalogue' | 'front' | 'back' | 'edge'

/** One image in the gallery, with the words that go under it. */
export interface Frame {
  kind: FrameKind
  src: string
  /** Caption. Short enough to sit under a thumbnail on a phone. */
  label: string
  /**
   * The part that would otherwise be assumed. Only set where a reader would
   * be wrong to assume: the catalogue image is not a photograph of this copy,
   * and an uncropped spine is not a failure of the camera.
   */
  note: string
}

/** The filenames or data URLs the detail view has to work with. */
export interface GallerySources {
  /** The publisher's cover for the matched ISBN. Not a photo of this copy. */
  catalogue?: string
  front?: string
  back?: string
  edge?: string
}

/**
 * What shape the spine photo turned out to be.
 *
 * `unknown` until the image has loaded and been measured, which is the state
 * the first render is in.
 */
export type SpineShape = 'unknown' | 'strip' | 'whole'

/**
 * Is this image already a spine, or a photograph of a whole book?
 *
 * Spine captures are cropped as they are taken: the camera draws a tall narrow
 * guide, the person lines the spine up inside it, and `captureStill` saves
 * exactly that rectangle (`SPINE_CROP` in `scanner.ts`, 0.24 by 0.68 of the
 * displayed frame, so around 0.16 wide for tall). Nothing has to find the
 * spine afterwards, because somebody already did, with the book in their hand.
 *
 * Spine photos taken before that crop existed are whole books, landscape or
 * roughly 3:4. There is no honest way to crop one here: the book can be at any
 * angle, anywhere in the frame, and the only images that would need it live in
 * the production catalogue, which is not readable from a test. A detector that
 * cannot be checked against a single real example is a guess, and a guess that
 * cuts the title off a spine is worse than the uncropped photo.
 *
 * The threshold is deliberately generous. A capture is around 0.16, a whole
 * book held up in portrait is around 0.75, and nothing real sits at 0.45.
 */
export const SPINE_MAX_ASPECT = 0.45

export function spineShape(width: number, height: number): SpineShape {
  if (!width || !height) return 'unknown'
  return width / height <= SPINE_MAX_ASPECT ? 'strip' : 'whole'
}

const CATALOGUE: Omit<Frame, 'src'> = {
  kind: 'catalogue',
  label: 'Catalogue cover',
  // The same honesty the scan view already applies to a catalogue image it
  // shows in place of a photo: say whose picture this is.
  note: "The publisher's picture, not this copy",
}

const FRONT: Omit<Frame, 'src'> = { kind: 'front', label: 'Front cover', note: '' }
const BACK: Omit<Frame, 'src'> = { kind: 'back', label: 'Back cover', note: '' }

const SPINE_STRIP: Omit<Frame, 'src'> = { kind: 'edge', label: 'Spine', note: '' }

const SPINE_WHOLE: Omit<Frame, 'src'> = {
  kind: 'edge',
  label: 'Spine',
  note: 'Shot before spines were cropped, so shown whole',
}

export interface Gallery {
  /** Swiped through, in this order. Never empty unless the book has no images. */
  swipe: Frame[]
  /**
   * Shown beside the swiped image and never swiped past, because it is the
   * one photo you look for a book by. Null when there is no spine, or when
   * the spine is a whole book and belongs at full size instead.
   */
  beside: Frame | null
}

/**
 * The gallery for one book.
 *
 * Order is the owner's: the catalogue picture, then the front, then the back.
 * Anything missing is left out rather than drawn as a gap, so a book with one
 * photo has one frame and no swipe that goes nowhere.
 */
export function gallery(sources: GallerySources, shape: SpineShape = 'unknown'): Gallery {
  const swipe: Frame[] = []
  if (sources.catalogue) swipe.push({ ...CATALOGUE, src: sources.catalogue })
  if (sources.front) swipe.push({ ...FRONT, src: sources.front })
  if (sources.back) swipe.push({ ...BACK, src: sources.back })

  if (!sources.edge) return { swipe, beside: null }

  // A whole-book spine photo is unreadable in a strip two centimetres wide,
  // so it goes in the swipe at full size instead of being squeezed beside it.
  if (shape === 'whole') {
    swipe.push({ ...SPINE_WHOLE, src: sources.edge })
    return { swipe, beside: null }
  }

  const beside: Frame = { ...SPINE_STRIP, src: sources.edge }

  // Nothing to sit beside. A lone spine is the gallery, not a margin note.
  if (!swipe.length) return { swipe: [beside], beside: null }

  return { swipe, beside }
}

/**
 * Which frame a horizontal scroll has landed on.
 *
 * Rounding rather than flooring, so a scroll stopped a pixel short of a snap
 * point still reports the frame the reader is looking at.
 */
export function frameAtScroll(scrollLeft: number, frameWidth: number, count: number): number {
  if (frameWidth <= 0 || count <= 0) return 0
  return Math.max(0, Math.min(count - 1, Math.round(scrollLeft / frameWidth)))
}
