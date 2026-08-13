/**
 * One book's own page.
 *
 * ## It is about the book, not about where the book sits
 *
 * That is a pinned rule and the owner has said it twice:
 *
 * > This is the detailed view for a book. Where it is, is one part of that.
 * > It's not the whole picture.
 *
 * So the page answers "what do I know about this book, and what can I do with
 * it", and where it sits is one section of several. There is no sentence over
 * the drawing of the board saying in words what the drawing shows; that line
 * came off in #282 and this page never had one.
 *
 * ## Doing before knowing, which is the order of the whole page
 *
 * > We should have the actions available to the user the moment they get to
 * > this detail view [...] And then if they don't intend to take action, when
 * > they scroll down they see the current shelving view, and that shows them
 * > where it is, which might be what they're here for.
 *
 * The book, its facts, its tags, what you can do. Then, on scrolling: where it
 * sits, where it has been, and what else is here by the same author. A test
 * pins that order on the drawn screens and this page is built to it.
 *
 * ## Editing is an action on this page rather than the whole of it
 *
 * The app has had one screen for a book since it had screens, and that screen is
 * a form: it exists to correct a record. This is the other half, and the two are
 * one journey rather than two doors to one room. The pencil in the corner opens
 * the form, which is exactly what the corner has meant since the first round.
 *
 * ## Five requests, and none of them blocks the book
 *
 * The record, its tags, where it has been, where it sits and the rest of the
 * author arrive separately, and each section draws when its own answer does.
 * The alternative is one request that waits for the slowest of them before the
 * title appears, on a page somebody often opens to read one line of.
 */

import { useEffect, useState } from 'react'
import { Actions, Been, Head, Part, Tagged, Tagging } from '../design/Book'
import { Button } from '../design/Controls'
import { Card, Nothing } from '../design/Card'
import { IconEdit } from '../design/Icons'
import { List, Place, Row } from '../design/List'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { TopBar } from '../design/Chrome'
import type { Shot } from '../design/Shots'
import {
  api,
  draftFromBook,
  type AppliedTag,
  type Been as Move,
  type BookRow,
  type Credit,
  type PlacementStrip,
} from '../lib/api'
import { clothFor, pagesOf } from '../lib/bookLook'
import { coverThumbUrl } from './PlacementCard'
import { grouped, shortDate } from '../lib/say'
import { spineLabel } from '../lib/shelfRow'
import { useBrowsing } from '../app/browsing'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { Frame } from './Frame'

export function BookPane() {
  const { setRoute, openClaim } = useNavigation()
  const { viewing, setTyped } = useBrowsing()
  const { openBook, viewBook } = useOpenBook()

  const [book, setBook] = useState<BookRow | null>(null)
  const [credits, setCredits] = useState<Credit[]>([])
  const [tags, setTags] = useState<AppliedTag[]>([])
  const [been, setBeen] = useState<{ moves: Move[]; total: number }>({ moves: [], total: 0 })
  const [strip, setStrip] = useState<PlacementStrip | null>(null)
  const [theirs, setTheirs] = useState<{ books: BookRow[]; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** Read the record again, which is what every action here changes. */
  const reread = () => {
    api.getBook(viewing)
      .then(({ book: found, authors }) => { setBook(found); setCredits(authors) })
      .catch((caught) => setError((caught as Error).message))
  }

  useEffect(() => {
    let live = true
    setBook(null)
    setStrip(null)
    setTheirs(null)

    api.getBook(viewing)
      .then(({ book: found, authors }) => {
        if (!live) return
        setBook(found)
        setCredits(authors)
      })
      .catch((caught) => { if (live) setError((caught as Error).message) })

    api.bookTags(viewing)
      .then((answer) => { if (live) setTags(answer.tags) })
      .catch(() => { if (live) setTags([]) })

    api.placements(viewing)
      .then((answer) => { if (live) setBeen({ moves: answer.been, total: answer.total }) })
      .catch(() => { if (live) setBeen({ moves: [], total: 0 }) })

    return () => { live = false }
  }, [viewing])

  /*
   * The board this book stands on.
   *
   * `previewPlacement` writes nothing and already answers with the run drawn,
   * which is the same drawing the shelving step is looked at on. It is asked for
   * only once the record has arrived, because it is asked in terms of the book.
   */
  useEffect(() => {
    let live = true
    if (!book?.location || !book.title) return undefined

    api.previewPlacement(draftFromBook(book))
      .then((answer) => { if (live) setStrip(answer.strip ?? null) })
      .catch(() => { if (live) setStrip(null) })

    return () => { live = false }
  }, [book])

  /* And everything else by whoever is credited first, which is who it files under. */
  useEffect(() => {
    let live = true
    const first = credits[0]
    if (!first) return undefined

    api.authorBooks(first.authorId)
      .then((answer) => {
        if (!live) return
        setTheirs({ books: answer.books, name: first.filingName || first.displayName })
      })
      .catch(() => { if (live) setTheirs(null) })

    return () => { live = false }
  }, [credits])

  const top = (
    <TopBar
      title={book?.title || 'A book'}
      sub={book ? (credits[0]?.filingName || book.authors) : undefined}
      onBack={() => setRoute('library')}
      action={{ word: 'Edit', icon: <IconEdit />, onPress: () => void openBook(viewing) }}
    />
  )

  if (!book) {
    return (
      <Frame tab="library" top={top}>
        {error ? <Nothing said="That book could not be read.">{error}</Nothing> : null}
      </Frame>
    )
  }

  const out = Boolean(book.checked_out_at)

  const checkOut = async (leaving: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api.setCheckedOut(book.id, leaving)
      reread()
      const answer = await api.placements(book.id)
      setBeen({ moves: answer.been, total: answer.total })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame tab="library" top={top}>
      <Head
        title={book.title}
        by={book.authors || 'Nobody is credited'}
        shots={shotsOf(book)}
        facts={factsOf(book)}
      />

      {error && <Nothing said="That did not work.">{error}</Nothing>}

      {/* Straight under the publisher and the ISBN, because that is where the
          owner put them: what a book is about is a fact about the book. */}
      <Part head="What it is about">
        {tags.length > 0 ? (
          <Tagging>
            {tags.map((tag) => (
              <Tagged key={tag.slug} word={tag.label} from={tag.source} who={whoSaid(tag)} />
            ))}
          </Tagging>
        ) : (
          <p className="wf-said">Nothing has been said about what this one is.</p>
        )}
      </Part>

      {/*
        What a person can do, the moment they arrive.

        Three things are drawn and the rest are deliberately not. Editing is the
        pencil in the corner and has been since the first round; a second door to
        it here is the fault the first screen had its camera card taken off for.
        Carrying a book to where the rules want it is a journey of its own and
        the screen for it is being built beside this one, so it is not offered
        here as a button that goes nowhere.
      */}
      <Part head="What you can do">
        <Actions>
          {out ? (
            <Button tone="secondary" small onPress={() => void openBook(book.id)}>
              Put it back
            </Button>
          ) : (
            <Button tone="secondary" small onPress={() => void checkOut(true)}>
              {busy ? 'Just a moment' : 'Check it out'}
            </Button>
          )}
          {!out && (
            <Button tone="quiet" small onPress={() => void openBook(book.id)}>
              It moved
            </Button>
          )}
          {!book.isbn13 && (
            <Button tone="quiet" small onPress={() => void openBook(book.id)}>
              Say what it is
            </Button>
          )}
        </Actions>
      </Part>

      {/* Below the fold, and drawn rather than said. The board names the books
          either side and the cat on top of it says which one this is. */}
      <Part head="Where it is">
        {out ? (
          <div>
            <Place quiet>Out</Place>
          </div>
        ) : strip ? (
          <div className="wf-bleed">
            <Shelf label={strip.label} items={standing(strip, book.id, viewBook)} />
          </div>
        ) : book.location ? (
          <div>
            <Place>{book.location}</Place>
          </div>
        ) : (
          <div>
            <Place quiet>Not on a bookcase</Place>
          </div>
        )}

        {/*
          Why it is there rather than somewhere else (#323), which is a rule
          with a name and is the one thing this section could not say. The same
          screen the furniture reaches, so the household gets one explanation of
          the rules rather than two written for two places. It sits under the
          drawing rather than in "what you can do", because it answers nothing
          about the book and everything about where it sits.
        */}
        <Actions>
          <Button tone="quiet" small onPress={() => openClaim(book.id)}>
            Why is it here?
          </Button>
        </Actions>
      </Part>

      <Part head="Where it has been" note={moves(been.total)}>
        {been.moves.length > 0 ? (
          <Been rows={been.moves.map(asRow)} />
        ) : (
          <p className="wf-said">Nobody has written down where this one goes.</p>
        )}
      </Part>

      <Part
        head="More by this author"
        note={theirs ? `${grouped(theirs.books.length)} of theirs` : undefined}
      >
        <p className="wf-book__by" style={{ margin: 0 }}>
          {book.authors || 'Nobody is credited'}
        </p>
        {credits[0]?.filingName && (
          <p className="wf-said">Files under {credits[0].filingName}</p>
        )}

        {theirs && theirs.books.length > 1 ? (
          <>
            <List label="Others by them">
              {theirs.books
                .filter((one) => one.id !== book.id)
                .slice(0, 5)
                .map((one) => (
                  <Row
                    key={one.id}
                    title={one.title}
                    sub={one.published || ''}
                    cloth={clothFor(one.id)}
                    photo={coverThumbUrl(one.front_crop || one.front_image || one.cover_image, 160)}
                    place={one.location || undefined}
                    onPress={() => viewBook(one.id)}
                  />
                ))}
            </List>
            {theirs.books.length > 6 && (
              <Actions>
                <Button
                  tone="quiet"
                  small
                  onPress={() => { setTyped(theirs.name); setRoute('find') }}
                >
                  All {grouped(theirs.books.length)} of theirs
                </Button>
              </Actions>
            )}
          </>
        ) : (
          <Card weight="quiet" title="Nothing else of theirs is catalogued" />
        )}
      </Part>
    </Frame>
  )
}

/**
 * The photographs, as the book they are photographs of.
 *
 * The four kinds are drawn whether or not they exist, because a kind nobody has
 * taken is a thing to know and a thing to fix. The spine is the one marked
 * `sliver`, which is what stands it against the front rather than beside it, and
 * a crop is preferred to the whole photograph for the reason the gallery prefers
 * one: the room the book was photographed in is not part of the book.
 */
function shotsOf(book: BookRow): Shot[] {
  const of = (file: string, crop: string) => coverThumbUrl(crop || file, 320)

  return [
    {
      word: 'Spine',
      sliver: true,
      cloth: book.edge_image ? clothFor(book.id) : undefined,
      photo: of(book.edge_image, book.edge_crop),
    },
    {
      word: 'Front',
      cloth: book.front_image ? clothFor(book.id + 1) : undefined,
      photo: of(book.front_image, book.front_crop),
    },
    {
      word: 'Back',
      cloth: book.back_image ? clothFor(book.id + 2) : undefined,
      photo: of(book.back_image, book.back_crop),
    },
    {
      word: 'Downloaded',
      cloth: book.cover_image ? clothFor(book.id + 3) : undefined,
      photo: coverThumbUrl(book.cover_image, 320),
    },
  ]
}

/**
 * The facts, as sentences rather than as a table of labels.
 *
 * A phone is 414 wide and a label column eats half of it to repeat words a
 * reader can see the shape of. What is absent is said once, plainly, rather than
 * left as three empty rows.
 */
function factsOf(book: BookRow): string[] {
  const facts: string[] = []

  const printed = [book.publisher, book.published].filter(Boolean).join(', ')
  const pages = pagesOf(book)
  const long = pages ? `${grouped(pages)} pages` : ''

  if (printed || long) facts.push([printed, long].filter(Boolean).join('. ') + '.')
  else facts.push('No publisher, year or length')

  if (book.series_name) {
    facts.push(book.series_index
      ? `${book.series_name}, book ${book.series_index}`
      : book.series_name)
  }

  facts.push(book.isbn13 ? `ISBN ${book.isbn13}` : 'No ISBN')

  return facts
}

/** Who said a tag, as the sentence the chip carries but does not draw. */
function whoSaid(tag: AppliedTag): string {
  if (tag.source === 'person') return 'You said so'
  if (tag.source === 'catalogue') return 'A catalogue says so'
  return 'The app guessed it, and it is not sure'
}

/** How many moves, said in words above the ledger. */
function moves(total: number): string | undefined {
  if (!total) return undefined
  return total === 1 ? 'One move' : `${grouped(total)} moves`
}

/**
 * One row of the ledger, as a sentence.
 *
 * The kinds are the model's and the words are not: `assigned` is the app
 * deciding where a book should go and `placed` is somebody having carried it,
 * which is the difference the whole misfile list rests on, so it is the one
 * difference this has to say out loud.
 */
function asRow(move: Move): { what: string; who?: string; when: string } {
  const when = shortDate(move.at)
  const at = move.location ? ` on ${move.location}` : ''

  if (move.kind === 'checked_out') return { what: 'Taken out', when }
  if (move.kind === 'checked_in') return { what: 'Brought back', when }
  if (move.kind === 'withdrawn') return { what: 'Given away', when }
  if (move.kind === 'assigned') return { what: `Meant for${at}`.trim(), who: 'The app', when }
  if (move.kind === 'pinned') return { what: `Kept${at}`, who: 'You said so', when }

  return {
    what: `Put${at}`,
    who: move.actor === 'person' ? 'You carried it' : 'The app',
    when,
  }
}

/**
 * The run this book stands in, with this book marked.
 *
 * The mark is `here`, which puts the cat on top of the book rather than a ring
 * around it: a ring is drawn outside the element, the run scrolls inside itself,
 * and the top of it was cut off every time. Tapping any other spine walks along
 * the shelf, which is what a row of books is for.
 */
function standing(
  strip: PlacementStrip,
  id: number,
  onOpen: (id: number) => void,
): ShelfItem[] {
  return strip.books.map((one) => ({
    kind: 'spine' as const,
    // What is written down a spine with no photograph, and what the spine is
    // called for anybody not looking at pixels either way.
    text: one.authorFiling || one.title || spineLabel(one),
    cloth: clothFor(one.id),
    pages: pagesOf(one),
    photo: coverThumbUrl(one.spine, 160),
    here: one.id === id,
    // The book this page is about goes nowhere: it is already here.
    onPress: one.id === id ? undefined : () => onOpen(one.id),
  }))
}
