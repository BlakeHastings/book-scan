/**
 * Presence is the only marker a photograph wears: `wf-shot--taken` when one
 * has been taken and no class at all when none has, because `library.css`
 * keeps every rule about an empty box off a taken one with
 * `:not(.wf-shot--taken)`.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Cloth } from './Shelf'
import { frameAtScroll } from '../lib/gallery'

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
   * draws this is itself one whole button.
   */
  full?: boolean
}) {
  if (mode === 'book') return <TheBook shots={shots} size={size} first={first} full={full} />

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
        {shot.photo && <img className="wf-shot__img" src={shot.photo} alt="" />}
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
    <div className={className} role="list" aria-label="Photographs">
      {shots.map(one)}
      {deck && deck.length > 0 && (
        <span className="wf-shot-deck">
          <Swipe deck={deck} draw={one} />
        </span>
      )}
    </div>
  )
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
  const [looking, setLooking] = useState<number | null>(null)
  /*
  /*
   * Held still rather than made again each render: `Whole` hangs a key listener
   * off this, and a listener taken down and put back up on every render has a
   * gap in it every time.
   */
  const leave = useCallback(() => setLooking(null), [])

  const shot = (one: Shot | undefined, where: string) => {
    const taken = Boolean(one?.cloth || one?.photo)
    const marks = `wf-shot wf-shot--${where}${taken ? ' wf-shot--taken' : ''}`
    const box = (
      <span className={`wf-shot__box${one?.cloth ? ` wf-spine--${one.cloth}` : ''}`}>
        {one?.photo && <img className="wf-shot__img" src={one.photo} alt="" />}
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
        onClick={() => setLooking(there.indexOf(one))}
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
      {looking !== null && there.length > 0 && (
        <Whole shots={there} at={looking} onLeave={leave} />
      )}
    </span>
  )
}

/**
 * One picture, whole, over everything else. It draws `full` rather than the
 * crop every small picture in the app is drawn from, because this is the one
 * place somebody has gone to in order to look at the photograph itself.
 */
function Whole({ shots, at, onLeave }: {
  shots: Shot[]
  at: number
  onLeave: () => void
}) {
  const [showing, setShowing] = useState(at)
  const track = useRef<HTMLSpanElement | null>(null)
  const opened = useRef(at)

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

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onLeave()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onLeave])

  const frameWidth = () => track.current?.firstElementChild?.clientWidth ?? 0
  const goTo = (to: number) => {
    setShowing(to)
    track.current?.scrollTo({ left: to * frameWidth(), behavior: 'smooth' })
  }

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
      onClick={onLeave}
    >
      <span
        className="wf-whole__track"
        ref={hold}
        onScroll={(event) => {
          setShowing(frameAtScroll(event.currentTarget.scrollLeft, frameWidth(), shots.length))
        }}
      >
        {shots.map((one) => (
          <span className="wf-whole__frame" key={one.word}>
            {one.photo ? (
              <img className="wf-whole__img" src={one.full || one.photo} alt={one.word} />
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

      <button type="button" className="wf-whole__away" onClick={onLeave}>
        Close
      </button>
    </span>
  )
}
