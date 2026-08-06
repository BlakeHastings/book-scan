import { useEffect, useRef, useState } from 'react'
import {
  frameAfterSources, frameAtScroll, gallery, samePhotos, spineShape,
  type Frame, type GallerySources, type SpineShape,
} from '../lib/gallery'

interface Props {
  sources: GallerySources
  /** Open one image full screen. The detail view owns the lightbox. */
  onZoom: (frame: Frame) => void
}

/**
 * A book's photos, one at a time, with the spine beside them.
 *
 * The swipe is a native scroll container with snap points rather than a
 * pointer-drag handler. That is the whole reason vertical scrolling still
 * works: the browser decides which axis a gesture belongs to from its first
 * few pixels, and hands the other axis to the page. A hand-rolled drag has to
 * guess, and guesses wrong on a thumb moving diagonally, which is how every
 * phone carousel that fights the page is built.
 *
 * Nothing here is reachable only by swiping. The dots are buttons, the caption
 * names what is on screen, and the next frame peeks in at the edge, so the
 * gesture is discovered rather than required.
 */
export function BookGallery({ sources, onZoom }: Props) {
  const [shape, setShape] = useState<SpineShape>('unknown')
  const [index, setIndex] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  // The photographs this gallery was last drawn for. `sources` is built fresh
  // by the caller on every render, so there is nothing to compare against
  // without keeping the last one.
  const shown = useRef<GallerySources>(sources)

  const { swipe, beside } = gallery(sources, shape)

  /*
   * Two things change these pictures, and they want opposite answers.
   *
   * A book can lose photos while it is open: change the ISBN and the catalogue
   * cover is replaced. Landing on a frame that no longer exists would leave
   * the dots pointing past the end, so the place is kept and pulled back
   * inside what is left.
   *
   * A different book arriving is not that. This component is not remounted
   * when a neighbour opens from the shelf row (#81), so without this it keeps
   * the last book's frame index, its scroll position, which is the browser's
   * and not React's, and its measured spine shape. All three belong to the
   * book that has just been left.
   */
  useEffect(() => {
    const was = shown.current
    shown.current = sources

    setIndex(frameAfterSources(index, was, sources, swipe.length))

    if (!samePhotos(was, sources)) {
      // Not smooth: this is a different page, not a move within one, and an
      // animation back to the start would read as the last book sliding away.
      track.current?.scrollTo({ left: 0 })
      setShape('unknown')
    }
  })

  if (!swipe.length && !beside) return null

  const current = swipe[index]

  /**
   * How wide one frame is, measured rather than assumed.
   *
   * A frame is deliberately narrower than the track so the next photo peeks
   * in at the edge, and that width lives in the stylesheet. Reading it back
   * off the element is what stops the dots drifting out of step if the peek
   * is ever adjusted there.
   */
  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0

  const goTo = (to: number) => {
    setIndex(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

  /** Measure the spine so it is only put in a strip if it really is one. */
  const measure = (image: HTMLImageElement) => {
    const found = spineShape(image.naturalWidth, image.naturalHeight)
    if (found !== 'unknown') setShape(found)
  }

  return (
    <div className={beside ? 'gallery gallery--with-spine' : 'gallery'}>
      <div className="gallery__main">
        <div
          className={swipe.length > 1 ? 'gallery__track' : 'gallery__track gallery__track--single'}
          ref={track}
          onScroll={(event) => {
            setIndex(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), swipe.length))
          }}
          // One frame at a time is a list of pictures, not a control.
          role={swipe.length > 1 ? 'group' : undefined}
          aria-label={swipe.length > 1 ? 'Photos of this book' : undefined}
        >
          {swipe.map((frame) => (
            // `src` rather than `kind`: a cropped photo and the uncropped
            // continuation of it now share a kind, since scrolling reaches
            // both. The two are always different files.
            <figure key={frame.src} className="gallery__frame">
              <img
                src={frame.src}
                alt={frame.label}
                loading="lazy"
                onClick={() => onZoom(frame)}
                onLoad={(event) => {
                  if (frame.kind === 'edge') measure(event.currentTarget)
                }}
              />
            </figure>
          ))}
        </div>

        {/* Under the image and always present, because a caption that only
            appears for some frames reads as a warning rather than a label. */}
        {current && (
          /* A div rather than a figcaption: it labels whichever frame is
             showing, not one figure, and a figcaption outside its figure is
             not a caption at all as far as a screen reader is concerned. */
          <div className="gallery__caption">
            <span className="gallery__label">{current.label}</span>
            {current.note && <span className="gallery__note">{current.note}</span>}
          </div>
        )}

        {/* Dots, not decoration: each one moves the track. Somebody who never
            discovers the swipe can still reach every photo by tapping. */}
        {swipe.length > 1 && (
          <div className="gallery__dots">
            {swipe.map((frame, i) => (
              <button
                key={frame.src}
                type="button"
                className={i === index ? 'gallery__dot gallery__dot--on' : 'gallery__dot'}
                aria-label={frame.label}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        )}
      </div>

      {beside && (
        <figure className="gallery__spine">
          <img
            src={beside.src}
            alt={beside.label}
            loading="lazy"
            onClick={() => onZoom(beside)}
            onLoad={(event) => measure(event.currentTarget)}
          />
          <figcaption>{beside.label}</figcaption>
        </figure>
      )}
    </div>
  )
}
