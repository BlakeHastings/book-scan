/**
 * Presence is the only marker a photograph wears: `wf-shot--taken` when one
 * has been taken and no class at all when none has, because `library.css`
 * keeps every rule about an empty box off a taken one with
 * `:not(.wf-shot--taken)`.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Cloth } from './Shelf'
import { Photo } from './Photo'
import { frameAtScroll } from '../lib/gallery'
import { originalOf, sized } from '../lib/photos'

export interface Shot {
  /** What this photograph is of: Front, Spine, Back. */
  word: string
  /** The cloth standing in for a photograph. Absent means nobody has taken this one yet. */
  cloth?: Cloth
  /** The one the shutter will fill next. Nothing marks it on a book's page. */
  next?: boolean
  /**
   * This photograph is cropped to the shape of a spine: a tall thin sliver
   * rather than a rectangle the shape of a cover. A flag rather than a match
   * on `word`, which is a label somebody may rewrite without knowing what
   * reads it.
   */
  sliver?: boolean
  /**
   * The publisher's picture of the edition rather than a photograph of this
   * copy, and at most one of them. Read only by `deckOrder`.
   */
  catalogue?: boolean
  /** The photograph itself, where there is one. A cloth or a photo counts equally as taken. */
  photo?: string
  /**
   * The whole photograph `photo` was cut down from, read by the full screen
   * view and by nothing else. Absent means there was nothing to cut, so
   * `photo` already is the whole of it.
   */
  full?: string
  /** What has become of it since, in words: "reading", "ISBN found". */
  note?: string
  /** Where taking this one again goes. Only read when `act` is set. */
  onPress?: () => void
}

/**
 * A preference rather than a property of a book, so it is kept on the phone in
 * `lib/firstPicture.ts`.
 */
export type FirstPicture = 'catalogue' | 'yours'

/**
 * The order the pictures are swiped through. A catalogue picture leads only
 * where there is one behind it, so a book never opens on an empty frame, and
 * nothing else moves from the order it was handed in.
 */
export function deckOrder(deck: Shot[], first: FirstPicture): Shot[] {
  if (first !== 'catalogue') return deck

  const at = deck.findIndex((one) => one.catalogue && Boolean(one.cloth || one.photo))
  if (at <= 0) return deck

  return [deck[at]!, ...deck.filter((_, index) => index !== at)]
}

/**
 * The three slots the details screen draws. A catalogue picture nobody has
 * downloaded is not a slot at all, while a photograph nobody has taken is one,
 * because there the empty box is the button that takes it.
 */
export function threeSlots(
  spine: Shot,
  catalogue: Shot,
  /** The photographs somebody took, in the order they are taken. */
  ours: Shot[],
): { shots: Shot[]; deck?: Shot[] } {
  if (!catalogue.cloth && !catalogue.photo) return { shots: [spine, ...ours] }
  return { shots: [spine, catalogue], deck: ours }
}

export function Shots({
  shots,
  deck,
  act = false,
  size,
  on = 'paper',
  mode = 'rail',
  first = 'catalogue',
  full = false,
}: {
  shots: Shot[]
  /**
   * The last slot of a rail, as a stack swiped between rather than as one
   * photograph. Read only by `mode="rail"`; absent gives every photograph a
   * slot of its own.
   */
  deck?: Shot[]
  /**
   * Off, this is a record; on, each photograph that has an `onPress` is a
   * target that takes it again.
   */
  act?: boolean
  /**
   * Deliberately unset by default rather than `small`, because the two modes
   * have opposite ordinary sizes: a rail is small unless a screen asks for
   * big, and a book is big unless a screen asks for small.
   */
  size?: 'small' | 'big'
  on?: 'paper' | 'picture'
  /**
   * A rail is every photograph side by side; a book is the spine standing
   * against the front, with the rest behind it.
   */
  mode?: 'rail' | 'book'
  /** Which picture the book opens on. Read only by `mode="book"`. */
  first?: FirstPicture
  /**
   * Whether tapping a picture opens it full screen. Off unless a caller asks:
   * a picture that opens one is a `<button>`, and the queue row that also
   * draws this is itself one whole button. In a rail, a picture that retakes
   * (`act` with an `onPress`) does that instead.
   */
  full?: boolean
}) {
  if (mode === 'book') return <TheBook shots={shots} size={size} first={first} full={full} />
  return <Rail shots={shots} deck={deck} act={act} size={size} on={on} full={full} />
}

function Rail({ shots, deck, act, size, on, full }: {
  shots: Shot[]
  deck?: Shot[]
  act: boolean
  size?: 'small' | 'big'
  on: 'paper' | 'picture'
  full: boolean
}) {
  const there = [...shots, ...(deck ?? [])].filter((one) => Boolean(one.photo))
  const whole = useWhole()
  const drawn = size === 'big' ? 132 : on === 'picture' ? 60 : 78

  const className = [
    'wf-shots',
    size === 'big' ? 'wf-shots--big' : '',
    on === 'picture' ? 'wf-shots--picture' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const one = (shot: Shot) => {
    const taken = Boolean(shot.cloth || shot.photo)
    const press = act && Boolean(shot.onPress)

    const marks = [
      'wf-shot',
      shot.sliver ? 'wf-shot--sliver' : '',
      taken ? 'wf-shot--taken' : '',
      shot.next ? 'wf-shot--next' : '',
    ]
      .filter(Boolean)
      .join(' ')

    const box = (
      <span className={`wf-shot__box${shot.cloth ? ` wf-spine--${shot.cloth}` : ''}`}>
        {shot.photo && <Photo className="wf-shot__img" src={shot.photo} drawn={drawn} />}
        {press && taken && <span className="wf-shot__again">Retake</span>}
        {!taken && shot.next && <span className="wf-shot__next">Next</span>}
      </span>
    )

    const words = (
      <>
        <span className="wf-shot__word">{shot.word}</span>
        {shot.note && <span className="wf-shot__note">{shot.note}</span>}
      </>
    )

    if (!press && full && shot.photo) {
      return (
        <button
          key={shot.word}
          type="button"
          role="listitem"
          className={`${marks} wf-shot--opens`}
          aria-label={`See the whole ${shot.word.toLowerCase()} picture`}
          onClick={() => whole.open(there.indexOf(shot))}
        >
          {box}
          {words}
        </button>
      )
    }

    if (!press) {
      return (
        <span className={marks} role="listitem" key={shot.word}>
          {box}
          {words}
        </span>
      )
    }

    return (
      <button
        key={shot.word}
        type="button"
        role="listitem"
        className={marks}
        aria-label={
          taken
            ? `Take the ${shot.word.toLowerCase()} again`
            : `Photograph the ${shot.word.toLowerCase()}`
        }
        onClick={shot.onPress}
      >
        {box}
        {words}
      </button>
    )
  }

  return (
    <>
      <div className={className} role="list" aria-label="Photographs">
        {shots.map(one)}
        {deck && deck.length > 0 && (
          <span className="wf-shot-deck">
            <Swipe deck={deck} draw={one} />
          </span>
        )}
      </div>
      {whole.at !== null && there.length > 0 && (
        <Whole shots={there} at={whole.at} onLeave={whole.leave} />
      )}
    </>
  )
}

/**
 * Which picture is open full screen, if any, and the history entry that lets
 * the phone's back gesture close it.
 *
 * The entry is pushed in the press that opens it rather than in an effect, which
 * `StrictMode` would run twice. Closing any other way takes the entry back off,
 * so the next back gesture leaves the screen as it always did. Nothing else in
 * the app listens for `popstate`: the route is not in the URL.
 */
function useWhole() {
  const [at, setAt] = useState<number | null>(null)

  const open = useCallback((index: number) => {
    window.history.pushState({ bookscanWhole: true }, '')
    setAt(index)
  }, [])

  const leave = useCallback(() => {
    setAt(null)
    if ((window.history.state as { bookscanWhole?: boolean } | null)?.bookscanWhole) {
      window.history.back()
    }
  }, [])

  useEffect(() => {
    if (at === null) return
    const back = () => setAt(null)
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [at])

  return { at, open, leave }
}

/**
 * The pictures of one book in a strip a finger moves across, shared by the
 * three swiped arrangements in this file. It is a native scroll container with
 * snap points, so the browser decides which axis a gesture meant and no click
 * follows a finger that scrolled; a pointer-drag handler has to guess both and
 * gets a diagonal thumb wrong.
 */
function Swipe({
  deck,
  behind = false,
  draw,
  empty,
}: {
  deck: Shot[]
  /** Draws the edge of the next picture behind the front, so it reads as the top of a stack. */
  behind?: boolean
  draw: (one: Shot) => ReactNode
  empty?: ReactNode
}) {
  const [at, setAt] = useState(0)
  const track = useRef<HTMLSpanElement>(null)
  const showing = Math.min(at, Math.max(deck.length - 1, 0))
  /*
   * A different book starts at its first photograph. This is not remounted when
   * the book under it changes, and the scroll position is the browser's rather
   * than React's, so both are put back by hand.
   */
  const shown = useRef('')
  const held = deck.map((one) => `${one.word}|${one.photo ?? ''}|${one.cloth ?? ''}`).join('~')
  useEffect(() => {
    if (shown.current === held) return
    shown.current = held
    setAt(0)
    // Not smooth: a different book rather than a move within one.
    track.current?.scrollTo({ left: 0 })
  })

  /**
   * How wide one photograph is, measured off the element rather than assumed,
   * so the dots cannot drift out of step with the width in the stylesheet.
   */
  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0

  const goTo = (to: number) => {
    setAt(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

  return (
    <>
      <span className="wf-deck">
        {behind && showing < deck.length - 1 && (
          <span className="wf-deck__behind" aria-hidden="true" />
        )}
        <span
          className="wf-deck__track"
          ref={track}
          onScroll={(event) => {
            setAt(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), deck.length))
          }}
        >
          {deck.length ? deck.map(draw) : empty}
        </span>
      </span>
      {deck.length > 1 && (
        <span className="wf-shots__dots" role="group" aria-label="Photographs">
          {deck.map((one, index) => (
            <button
              key={one.word}
              type="button"
              className={[
                'wf-dot',
                one.cloth || one.photo ? 'wf-dot--taken' : '',
                index === showing ? 'wf-dot--showing' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={one.cloth || one.photo ? one.word : `${one.word}, not photographed`}
              aria-current={index === showing ? 'true' : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </span>
      )}
    </>
  )
}

function TheBook({ shots, size, first, full }: {
  shots: Shot[]
  size?: 'small' | 'big'
  first: FirstPicture
  full: boolean
}) {
  const spine = shots.find((one) => one.sliver)
  const deck = deckOrder(shots.filter((one) => !one.sliver), first)

  /*
   * What full screen can reach, which is only the pictures that exist: an empty
   * box has nothing behind it to open, so it is neither a frame nor a target.
   */
  const there = [spine, ...deck].filter(
    (one): one is Shot => Boolean(one && (one.cloth || one.photo)),
  )
  const whole = useWhole()
  const drawn = size === 'small' ? 96 : 172

  const shot = (one: Shot | undefined, where: string) => {
    const taken = Boolean(one?.cloth || one?.photo)
    const marks = `wf-shot wf-shot--${where}${taken ? ' wf-shot--taken' : ''}`
    const box = (
      <span className={`wf-shot__box${one?.cloth ? ` wf-spine--${one.cloth}` : ''}`}>
        {one?.photo && (
          <Photo className="wf-shot__img" src={one.photo} drawn={drawn} eager={one === deck[0]} />
        )}
        {where === 'face' && !taken && (
          <span className="wf-shot__none">
            {one?.word && <span className="wf-shot__word">{one.word}</span>}
            No photograph
          </span>
        )}
      </span>
    )

    if (!full || !taken || !one) {
      return (
        <span key={one?.word ?? where} className={marks} aria-hidden="true">
          {box}
        </span>
      )
    }

    return (
      <button
        key={one.word}
        type="button"
        className={marks}
        aria-label={`See the whole ${one.word.toLowerCase()} picture`}
        onClick={() => whole.open(there.indexOf(one))}
      >
        {box}
      </button>
    )
  }

  return (
    /*
     * A span rather than a div, because a queue row is one whole button and a
     * `<div>` inside a `<button>` is not phrasing content.
     */
    <span
      className={`wf-shots wf-shots--book${size === 'small' ? ' wf-shots--book-small' : ''}`}
    >
      {shot(spine, 'sliver')}
      <Swipe
        deck={deck}
        behind
        draw={(one) => shot(one, 'face')}
        empty={shot(undefined, 'face')}
      />
      {whole.at !== null && there.length > 0 && (
        <Whole shots={there} at={whole.at} onLeave={whole.leave} />
      )}
    </span>
  )
}

/**
 * One picture, whole, over everything else. It draws `full` rather than the
 * crop every small picture in the app is drawn from, because this is the one
 * place somebody has gone to in order to look at the photograph itself.
 *
 * At first it is a copy the width of the screen; zoomed in, the photograph as
 * stored. Only the picture showing and its two neighbours are drawn at all, so
 * opening one does not download every photograph of the book.
 */
function Whole({ shots, at, onLeave }: {
  shots: Shot[]
  at: number
  onLeave: () => void
}) {
  const [showing, setShowing] = useState(at)
  const [zoomed, setZoomed] = useState(false)
  const track = useRef<HTMLSpanElement | null>(null)
  const opened = useRef(at)
  const away = useRef<HTMLButtonElement | null>(null)

  /*
   * A callback ref rather than an effect, and one with a stable identity: a ref
   * callback whose identity changes is detached and reattached on every render,
   * so the strip would be scrolled back to the tapped picture every time the
   * dots moved it. An effect would run after the first paint, which is a
   * visible jump.
   */
  const hold = useCallback((node: HTMLSpanElement | null) => {
    track.current = node
    if (!node) return
    const frame = node.children[opened.current] as HTMLElement | undefined
    if (frame) node.scrollLeft = frame.offsetLeft
  }, [])

  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0
  const goTo = (to: number) => {
    setShowing(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

  // The way out has the focus while this is open, and the press that opened it
  // gets it back afterwards.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    away.current?.focus({ preventScroll: true })
    return () => before?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLeave()
      if (zoomed) return
      if (event.key === 'ArrowRight' && showing < shots.length - 1) goTo(showing + 1)
      if (event.key === 'ArrowLeft' && showing > 0) goTo(showing - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    /*
     * A span, for the same reason the book above is one: this is drawn inside
     * the book, and the book is drawn inside a button on one of the screens
     * that call it.
     */
    <span
      className="wf-whole"
      role="dialog"
      aria-modal="true"
      aria-label="The whole picture"
      onClick={(event) => {
        // Not on to whatever this is drawn inside, which may itself be a button.
        event.stopPropagation()
        // A tap on the picture showing is `Zoomable`'s to read; anywhere else
        // on this layer is a way out.
        if (!(event.target as HTMLElement).closest('.wf-whole__frame--showing .wf-whole__img')) onLeave()
      }}
    >
      <span
        className={`wf-whole__track${zoomed ? ' wf-whole__track--held' : ''}`}
        ref={hold}
        onScroll={(event) => {
          setShowing(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), shots.length))
        }}
      >
        {shots.map((one, index) => (
          <span
            className={`wf-whole__frame${index === showing ? ' wf-whole__frame--showing' : ''}`}
            key={one.word}
          >
            {Math.abs(index - showing) > 1 ? null : one.photo ? (
              <Zoomable
                src={one.full || one.photo}
                word={one.word}
                live={index === showing}
                onZoom={setZoomed}
                onTap={onLeave}
              />
            ) : (
              <span className={`wf-whole__cloth wf-spine--${one.cloth}`} aria-hidden="true" />
            )}
          </span>
        ))}
      </span>

      <span className="wf-whole__word">{shots[showing]?.word}</span>

      {shots.length > 1 && (
        <span className="wf-whole__dots" role="group" aria-label="Photographs">
          {shots.map((one, index) => (
            <button
              key={one.word}
              type="button"
              className={`wf-dot wf-dot--taken${index === showing ? ' wf-dot--showing' : ''}`}
              aria-label={one.word}
              aria-current={index === showing ? 'true' : undefined}
              onClick={(event) => {
                // Everything else here closes; this press is about staying.
                event.stopPropagation()
                goTo(index)
              }}
            />
          ))}
        </span>
      )}

      <button type="button" className="wf-whole__away" ref={away} onClick={onLeave}>
        Close
      </button>
    </span>
  )
}

/** How far in a double tap goes, and the furthest a pinch may. */
const ZOOM_IN = 2.5
const ZOOM_MOST = 5
/** Two taps closer together than this are one double tap, not two single ones. */
const DOUBLE_TAP_MS = 280

const UNZOOMED = { scale: 1, x: 0, y: 0 }

/**
 * The picture showing, which a pinch or a double tap zooms and one finger then
 * moves. A single tap closes, once it has waited long enough to know it was
 * not the first of two.
 *
 * The touch listeners are attached by hand because React's are passive, and a
 * pinch has to `preventDefault` or the page underneath is what moves. One
 * finger on a picture that is not zoomed is left alone, so the strip still
 * swipes to the next one.
 */
function Zoomable({ src, word, live, onZoom, onTap }: {
  src: string
  word: string
  live: boolean
  onZoom: (zoomed: boolean) => void
  onTap: () => void
}) {
  const [view, setView] = useState(UNZOOMED)
  const image = useRef<HTMLImageElement | null>(null)
  const held = useRef(view)
  held.current = view
  const tapTimer = useRef<number | undefined>(undefined)
  const zoomed = view.scale > 1
  /*
   * The stored photograph only once somebody has zoomed in on it, and from then
   * on, so zooming back out does not fetch the copy again. It is the same
   * element throughout, so the browser goes on drawing the copy until the
   * original has arrived.
   */
  const [deep, setDeep] = useState(false)

  useEffect(() => {
    if (live) onZoom(zoomed)
    if (zoomed) setDeep(true)
  }, [live, zoomed, onZoom])
  useEffect(() => {
    if (!live) setView(UNZOOMED)
  }, [live])
  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  useEffect(() => {
    const node = image.current
    if (!node || !live) return
    let pinch: { distance: number; scale: number } | null = null
    let drag: { x: number; y: number; fromX: number; fromY: number } | null = null

    const apart = (touches: TouchList) =>
      Math.hypot(touches[0]!.clientX - touches[1]!.clientX, touches[0]!.clientY - touches[1]!.clientY)

    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault()
        pinch = { distance: apart(event.touches) || 1, scale: held.current.scale }
        drag = null
      } else if (event.touches.length === 1 && held.current.scale > 1) {
        const touch = event.touches[0]!
        drag = { x: touch.clientX, y: touch.clientY, fromX: held.current.x, fromY: held.current.y }
      }
    }
    const move = (event: TouchEvent) => {
      if (pinch && event.touches.length === 2) {
        event.preventDefault()
        const scale = Math.min(ZOOM_MOST, Math.max(1, pinch.scale * (apart(event.touches) / pinch.distance)))
        setView((was) => (scale === 1 ? UNZOOMED : { ...was, scale }))
      } else if (drag && event.touches.length === 1) {
        event.preventDefault()
        const touch = event.touches[0]!
        const from = drag
        setView((was) => ({ ...was, x: from.fromX + touch.clientX - from.x, y: from.fromY + touch.clientY - from.y }))
      }
    }
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null
      if (event.touches.length === 0) drag = null
    }

    node.addEventListener('touchstart', start, { passive: false })
    node.addEventListener('touchmove', move, { passive: false })
    node.addEventListener('touchend', end)
    node.addEventListener('touchcancel', end)
    return () => {
      node.removeEventListener('touchstart', start)
      node.removeEventListener('touchmove', move)
      node.removeEventListener('touchend', end)
      node.removeEventListener('touchcancel', end)
    }
  }, [live])

  const tapped = () => {
    if (!live) return
    if (tapTimer.current !== undefined) {
      window.clearTimeout(tapTimer.current)
      tapTimer.current = undefined
      setView((was) => (was.scale > 1 ? UNZOOMED : { scale: ZOOM_IN, x: 0, y: 0 }))
      return
    }
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = undefined
      if (held.current.scale === 1) onTap()
    }, DOUBLE_TAP_MS)
  }

  const picked = deep ? { src: originalOf(src) } : sized(src, 1280, '100vw')

  return (
    // `sizes` and `srcSet` ahead of `src`, as in `Photo`.
    <img
      ref={image}
      className={`wf-whole__img${zoomed ? ' wf-whole__img--zoomed' : ''}`}
      decoding="async"
      sizes={picked.sizes}
      srcSet={picked.srcSet}
      src={picked.src}
      alt={word}
      draggable={false}
      style={zoomed ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` } : undefined}
      onClick={tapped}
    />
  )
}
