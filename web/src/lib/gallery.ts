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
  /**
   * The whole photograph `src` was cut from, which is what tapping opens.
   *
   * The same as `src` where nothing was cut. The point of keeping both is the
   * owner's: "so that we can choose when to show these things, the full versus
   * the cropped versus the catalogue". The gallery shows the book; the full
   * screen shows the photograph that was actually taken.
   */
  full: string
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
  /** Each photo cut to the book, where the detector found one. */
  crops?: Partial<Record<PhotoKind, string>>
  /**
   * Slots the detector has been shown, whether or not it found a book.
   *
   * The distinction is the whole reason this is here rather than inferred from
   * an absent crop. "Looked at and could not find the book" is worth saying,
   * because a reader is entitled to wonder why one photo has the room in it
   * and the next does not. "Never looked at" is not worth saying, and saying
   * it would put a failure notice under every photograph taken before any of
   * this existed, which is all of them.
   */
  examined?: PhotoKind[]
}

/** The kinds that are photographs of this copy, so the ones that get cropped. */
export type PhotoKind = 'front' | 'back' | 'edge'

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

/**
 * Said only where the detector was shown this photo and declined.
 *
 * The same honesty as the whole-spine caption: a photo that still has the room
 * around it says why, rather than being quietly worse than the one next to it.
 * A crop that cut a cover in half would be the expensive mistake here, so the
 * detector refuses whenever it is unsure and this is what refusing looks like.
 */
const NOT_FOUND = 'The book could not be picked out, so this is the whole photo'

const CATALOGUE: Omit<Frame, 'src' | 'full'> = {
  kind: 'catalogue',
  label: 'Catalogue cover',
  // The same honesty the scan view already applies to a catalogue image it
  // shows in place of a photo: say whose picture this is.
  note: "The publisher's picture, not this copy",
}

const FRONT: Omit<Frame, 'src' | 'full'> = { kind: 'front', label: 'Front cover', note: '' }
const BACK: Omit<Frame, 'src' | 'full'> = { kind: 'back', label: 'Back cover', note: '' }

const SPINE_STRIP: Omit<Frame, 'src' | 'full'> = { kind: 'edge', label: 'Spine', note: '' }

const SPINE_WHOLE: Omit<Frame, 'src' | 'full'> = {
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
  /**
   * One photograph, showing the crop where there is one and saying so where
   * there was meant to be one and is not.
   */
  const photo = (base: Omit<Frame, 'src' | 'full'>, kind: PhotoKind, src: string): Frame => {
    const crop = sources.crops?.[kind] ?? ''
    const looked = sources.examined?.includes(kind) ?? false
    return {
      ...base,
      src: crop || src,
      full: src,
      // A note the frame already carries wins. A spine shot before spines were
      // cropped is explained by that, and stacking a second explanation on it
      // helps nobody.
      note: base.note || (looked && !crop ? NOT_FOUND : ''),
    }
  }

  const swipe: Frame[] = []
  if (sources.catalogue) {
    swipe.push({ ...CATALOGUE, src: sources.catalogue, full: sources.catalogue })
  }
  if (sources.front) swipe.push(photo(FRONT, 'front', sources.front))
  if (sources.back) swipe.push(photo(BACK, 'back', sources.back))

  if (!sources.edge) return { swipe, beside: null }

  // A whole-book spine photo is unreadable in a strip two centimetres wide,
  // so it goes in the swipe at full size instead of being squeezed beside it.
  if (shape === 'whole') {
    swipe.push(photo(SPINE_WHOLE, 'edge', sources.edge))
    return { swipe, beside: null }
  }

  const beside: Frame = photo(SPINE_STRIP, 'edge', sources.edge)

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
