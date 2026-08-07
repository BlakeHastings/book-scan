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

/**
 * Said on the uncropped continuation of a photo that already appeared cropped
 * earlier in the swipe.
 *
 * The owner's ask: scrolling past the cropped photos should keep going into
 * the full ones rather than leaving them behind a tap. This is what tells a
 * reader why what looks like the same book again is not a mistake.
 */
export const UNCROPPED_NOTE = 'The whole photo this was cut from'

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

const SPINE_WHOLE: Omit<Frame, 'src' | 'full'> = { kind: 'edge', label: 'Spine', note: '' }

/**
 * Nothing has been shown this photograph, so the only thing that explains it
 * is when it was taken.
 *
 * A capture made since `SPINE_CROP` existed is a strip, so a spine still shaped
 * like a whole book is one from before it, and no detector has been offered it
 * since. That is the sentence this file has always said, and it is the one
 * state where it is true.
 */
export const BEFORE_SPINE_CROP = 'Shot before spines were cropped, so shown whole'

/**
 * The detector was shown this photograph and would not cut it.
 *
 * Both halves are said because both are true and neither is enough on its own:
 * the shape is explained by when it was taken, and the room still around it is
 * explained by a detector that declined. Saying only the first blames an old
 * capture for a decision made since, which is the wrong reason (#108).
 */
export const SPINE_NOT_FOUND =
  'Shot before spines were cropped, and the book could not be picked out of it'

/**
 * The detector found the book in a whole-book photograph, so this frame is a
 * crop and not the photograph.
 *
 * Said because the frame is labelled Spine and shows a book rather than a
 * spine, which is what a crop of a pre-`SPINE_CROP` capture looks like. This
 * frame used to carry the "shown whole" sentence while showing a crop, which
 * was the plainest of the three lies.
 */
export const SPINE_CUT_FROM_WHOLE = 'Cut from a photo of the whole book'

/**
 * Which of the three things has happened to a whole-book spine photograph.
 *
 * The states are already recorded and were never read here. `cropped` lists
 * the slots the detector has been shown, so a slot named there with no crop
 * beside it was examined and declined, and a slot not named at all has never
 * been attempted (see the comment on `books.cropped` in server/db.ts, which is
 * the contract). One caption for all three said the same thing about a photo
 * nothing had looked at, a photo a detector had refused, and a photo it had
 * successfully cut down.
 */
function wholeSpineNote(sources: GallerySources): string {
  if (sources.crops?.edge) return SPINE_CUT_FROM_WHOLE
  return sources.examined?.includes('edge') ? SPINE_NOT_FOUND : BEFORE_SPINE_CROP
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
 * Order is the owner's: the catalogue picture, then the front, then the back,
 * cropped where a crop exists. Once every cropped photo has had its turn, the
 * swipe keeps going into the uncropped photograph behind each one, so
 * scrolling reaches everything a tap used to be the only way to. Anything
 * missing is left out rather than drawn as a gap, so a book with one photo has
 * one frame and no swipe that goes nowhere.
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

  /**
   * The same photograph again, uncropped, to append after every cropped frame
   * has had its turn.
   *
   * Only returns a frame where a crop actually cut something away. A photo
   * the detector declined already shows the whole picture as its one frame
   * (`photo`, above, falls back to `src` when there is no crop), and a photo
   * never examined is the same case; appending it again here would be the
   * exact duplicate #98 warned against, one pretending to be a crop and one
   * as itself.
   */
  const uncropped = (base: Omit<Frame, 'src' | 'full'>, kind: PhotoKind, src: string): Frame | null => {
    const crop = sources.crops?.[kind] ?? ''
    if (!crop) return null
    return {
      ...base,
      label: `${base.label}, uncropped`,
      src,
      full: src,
      note: UNCROPPED_NOTE,
    }
  }

  const swipe: Frame[] = []
  // Uncropped continuations, held back and appended once every cropped frame
  // is in, so the order reads as "the crops, then the photos" rather than
  // alternating between them.
  const tail: Frame[] = []

  if (sources.catalogue) {
    swipe.push({ ...CATALOGUE, src: sources.catalogue, full: sources.catalogue })
  }
  if (sources.front) {
    swipe.push(photo(FRONT, 'front', sources.front))
    const continuation = uncropped(FRONT, 'front', sources.front)
    if (continuation) tail.push(continuation)
  }
  if (sources.back) {
    swipe.push(photo(BACK, 'back', sources.back))
    const continuation = uncropped(BACK, 'back', sources.back)
    if (continuation) tail.push(continuation)
  }

  if (!sources.edge) return { swipe: [...swipe, ...tail], beside: null }

  // A whole-book spine photo is unreadable in a strip two centimetres wide,
  // so it goes in the swipe at full size instead of being squeezed beside it.
  if (shape === 'whole') {
    // The caption is worked out per book rather than fixed on the constant,
    // because "why is this photo whole" has three different answers and the
    // data says which one applies.
    const whole = { ...SPINE_WHOLE, note: wholeSpineNote(sources) }
    swipe.push(photo(whole, 'edge', sources.edge))
    const continuation = uncropped(whole, 'edge', sources.edge)
    if (continuation) tail.push(continuation)
    return { swipe: [...swipe, ...tail], beside: null }
  }

  const beside: Frame = photo(SPINE_STRIP, 'edge', sources.edge)

  // Nothing to sit beside. A lone spine is the gallery, not a margin note, so
  // it is treated like any other frame in the swipe: cropped first, then its
  // own uncropped continuation if there is one to show.
  if (!swipe.length) {
    const continuation = uncropped(SPINE_STRIP, 'edge', sources.edge)
    return { swipe: continuation ? [beside, continuation] : [beside], beside: null }
  }

  // The spine beside the swipe stays exactly that: shown once, beside it, and
  // never swiped past. It is not part of "the carousel" the owner asked to
  // keep scrolling through, and it already has its full photo one tap away.
  return { swipe: [...swipe, ...tail], beside }
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

/**
 * Is this the same copy the gallery was already showing?
 *
 * The three photographs and deliberately not the catalogue picture: changing
 * an ISBN replaces the publisher's cover while the book in somebody's hand is
 * still the book in their hand, and they should not lose the photo they were
 * looking at over it.
 */
export function samePhotos(before: GallerySources, after: GallerySources): boolean {
  return before.front === after.front
    && before.back === after.back
    && before.edge === after.edge
}

/**
 * Which frame to be on once the photographs under a mounted gallery change.
 *
 * Two changes look alike from in here and mean opposite things. A book that
 * loses a picture while it is open, which is what changing its ISBN does,
 * should keep the place it was at, only pulled back inside the frames that are
 * left. A different book, which is what tapping a neighbour in the shelf row
 * opens (#81), should start at its first photograph the way it would if it had
 * been opened from the library.
 *
 * Clamping alone gave the second case the first case's answer: the frame index
 * carried over, so walking along a shelf from the third photo of one book
 * opened the next one part way through its own, or on its last frame when it
 * had fewer.
 */
export function frameAfterSources(
  index: number,
  before: GallerySources,
  after: GallerySources,
  count: number,
): number {
  if (count <= 0) return 0
  if (!samePhotos(before, after)) return 0
  return Math.max(0, Math.min(index, count - 1))
}
