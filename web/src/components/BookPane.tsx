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
 * sits, and what else is here by the same author. A test pins that order on the
 * drawn screens and this page is built to it.
 *
 * ## Round eight took the headings off it (#365)
 *
 * > And "what you can do", we don't need that text there either. [...] And
 * > instead of "where it is", once again, we don't need that text there.
 * > Looking at this tells them where it is.
 *
 * Four of the five headings are gone and only one of the five sections went
 * with them. The tags are in the head, beside the picture and under the ISBN,
 * because what a book is about is a fact about the book. The actions are a row
 * of buttons, and every button that was under that heading is still in the row.
 * The board draws where the book is without being introduced, and "why is it
 * here" stays under it, which is the one part of that section the owner kept.
 *
 * **Where it has been went entirely**, section and heading and the request
 * behind it: this page asked `api.placements` for the ledger and no longer
 * does, so it makes four requests rather than five. The moves themselves are
 * untouched. They are the record of where a book actually is,
 * `/api/books/:id/placements` still answers with them, and the misfile list
 * still rests on the difference between the app assigning a book and somebody
 * carrying one. Nothing draws them now.
 *
 * **More by this author is not drawn at all** when the catalogue has nothing
 * else by them, which is nearly every book in a new collection. Nothing is lost
 * by its going: the name is in the bar and under the title, and what it files
 * under is what the bar says.
 *
 * ## The picture a catalogue holds comes first
 *
 * > We should show the catalogue picture of the front of the book first if
 * > possible, instead of the one the user took.
 *
 * "If possible" is doing real work in that sentence and `deckOrder` in
 * `design/Shots.tsx` is where it is answered: a downloaded cover leads only
 * where there is one, so a book without one still opens on the photograph
 * somebody took rather than on an empty frame. Which way round it is comes off
 * `lib/firstPicture.ts`, which the settings screen writes.
 *
 * ## Editing is an action on this page rather than the whole of it
 *
 * The app has had one screen for a book since it had screens, and that screen is
 * a form: it exists to correct a record. This is the other half, and the two are
 * one journey rather than two doors to one room. The pencil in the corner opens
 * the form, which is exactly what the corner has meant since the first round.
 *
 * ## Four requests, and none of them blocks the book
 *
 * The record, its tags, where it sits and the rest of the author arrive
 * separately, and each part draws when its own answer does. The alternative is
 * one request that waits for the slowest of them before the title appears, on a
 * page somebody often opens to read one line of.
 */

import { useEffect, useState } from 'react'
import { Actions, Head, Part, Tagged, Tagging, Where } from '../design/Book'
import { Button } from '../design/Controls'
import { Nothing } from '../design/Card'
import { IconEdit } from '../design/Icons'
import { List, Place, Row } from '../design/List'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { TopBar } from '../design/Chrome'
import type { Shot } from '../design/Shots'
import {
  api,
  draftFromBook,
  type AppliedTag,
  type BookRow,
  type Credit,
  type PlacementStrip,
} from '../lib/api'
import { clothFor, pagesOf } from '../lib/bookLook'
import { coverThumbUrl, coverUrl } from './PlacementCard'
import { rememberedFirstPicture } from '../lib/firstPicture'
import { grouped } from '../lib/say'
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
  const [strip, setStrip] = useState<PlacementStrip | null>(null)
  const [theirs, setTheirs] = useState<{ books: BookRow[]; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /*
   * Which picture a book opens on, read once when the page mounts.
   *
   * A preference rather than a live value: it is changed on another screen,
   * getting there means leaving this one, and coming back mounts this again.
   * Reading `localStorage` on every render to catch a change that cannot
   * happen while this is on screen would be work done on every keystroke
   * elsewhere for nothing.
   */
  const [firstPicture] = useState(rememberedFirstPicture)

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

  /*
   * Everything else of theirs, which is the list and also the condition.
   *
   * The book on the screen is always in what the server answers with, so "is
   * there anything else by this author" is this list being empty rather than a
   * count of one, and working it out once means the section cannot be drawn on
   * a different answer from the one it lists.
   */
  const others = theirs ? theirs.books.filter((one) => one.id !== book.id) : []

  const checkOut = async (leaving: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api.setCheckedOut(book.id, leaving)
      // The record, and nothing else. Taking a book out changes where it is
      // and what this page offers, both of which come off the record; the
      // ledger that also changed is no longer drawn anywhere.
      reread()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame tab="library" top={top}>
      {/* The tags are in the head now, under the publisher and the ISBN and
          beside the picture, because that is where the owner put them: what a
          book is about is a fact about the book, and it had a heading three
          sections down that said nothing the chips do not. A book nobody has
          said anything about gets the line rather than an empty row, because
          "nothing has been said" is a thing to know and a thing to fix. */}
      <Head
        title={book.title}
        by={book.authors || 'Nobody is credited'}
        shots={shotsOf(book)}
        facts={factsOf(book)}
        first={firstPicture}
        tags={
          tags.length > 0 ? (
            <Tagging>
              {tags.map((tag) => (
                <Tagged key={tag.slug} word={tag.label} from={tag.source} who={whoSaid(tag)} />
              ))}
            </Tagging>
          ) : (
            <p className="wf-said">Nothing has been said about what this one is.</p>
          )
        }
      />

      {error && <Nothing said="That did not work.">{error}</Nothing>}

      {/*
        What a person can do, the moment they arrive, as buttons and with
        nothing written over them: "we don't need that text there either. We
        should just enable them to take action on a book with a series of
        buttons."

        The heading came off and the row is exactly as it was. Three things are
        drawn and the rest are deliberately not. Editing is the pencil in the
        corner and has been since the first round; a second door to it here is
        the fault the first screen had its camera card taken off for. Carrying a
        book to where the rules want it is a journey of its own and the screen
        for it is being built beside this one, so it is not offered here as a
        button that goes nowhere.
      */}
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

      {/* Below the fold, drawn rather than said, and no longer announced:
          "looking at this tells them where it is." The board names the books
          either side and the cat on top of it says which one this is. */}
      <Where>
        {/*
          The board answers for itself and the labels have to answer for
          themselves, which is what changed when the heading came off. "Out"
          and "1C" were answers under a heading reading "Where it is" and are
          two words with no question on a page that no longer asks one, so the
          two labels that are not a drawing say the whole thing. Found by
          looking at the checked-out book with the heading taken off.
        */}
        {out ? (
          <div>
            <Place quiet>Out of the house</Place>
          </div>
        ) : strip ? (
          <div className="wf-bleed">
            <Shelf label={strip.label} items={standing(strip, book.id, viewBook)} />
          </div>
        ) : book.location ? (
          <div>
            <Place>On {book.location}</Place>
          </div>
        ) : (
          <div>
            <Place quiet>Not on a bookcase</Place>
          </div>
        )}

        {/*
          Why it is there rather than somewhere else (#323), which is a rule
          with a name and is the one thing this part could not say. The same
          screen the furniture reaches, so the household gets one explanation of
          the rules rather than two written for two places. It sits under the
          drawing rather than in the row of actions above, because it answers
          nothing about the book and everything about where it sits, and it is
          the one thing here the owner kept when the rest of this went.
        */}
        <Actions>
          <Button tone="quiet" small onPress={() => openClaim(book.id)}>
            Why is it here?
          </Button>
        </Actions>
      </Where>

      {/*
        Drawn only where there is more, which is the last of #365:

        > And if there's nothing else in the catalogue by that author, we
        > shouldn't show "more by this author" at all.

        That covers three states with one condition. While the answer is still
        coming there is nothing to head, so nothing is drawn and the page does
        not jump; where the answer is that this is the only book of theirs,
        there is nothing to head either, and the card that used to say so is
        gone with the heading over it. Only the third state draws, and it is
        the one with a list under it.

        Nothing is lost in the other two. The name is in the bar and under the
        title, and what it files under is what the bar says, so the two lines
        this section opened with are on the screen either way.
      */}
      {others.length > 0 && theirs && (
        <Part head="More by this author" note={`${grouped(theirs.books.length)} of theirs`}>
          <p className="wf-book__by" style={{ margin: 0 }}>
            {book.authors || 'Nobody is credited'}
          </p>
          {credits[0]?.filingName && (
            <p className="wf-said">Files under {credits[0].filingName}</p>
          )}

          <List label="Others by them">
            {others.slice(0, 5).map((one) => (
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
          {others.length > 5 && (
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
        </Part>
      )}
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
 *
 * **And the whole photograph goes with it**, which is the other half of that
 * sentence (#373). Cropping is right for a book on a page and wrong for a
 * picture somebody has tapped to look at, so each shot carries both: the crop
 * to draw, and the photograph it was taken from for the full screen view.
 *
 * The second one is asked for at no width at all, which is deliberate: the
 * server resizes to a short list and the largest of them is 640, which is less
 * than a phone's own screen holds. The book page's lightbox has asked for the
 * file itself since it existed, and this is that request moved rather than a
 * cheaper one substituted for it.
 */
function shotsOf(book: BookRow): Shot[] {
  const of = (file: string, crop: string) => coverThumbUrl(crop || file, 320)
  /* Nothing where there is no photograph, so an absent one stays absent rather
     than becoming a url to a file that is not there. */
  const whole = (file: string) => coverUrl(file) || undefined

  return [
    {
      word: 'Spine',
      sliver: true,
      cloth: book.edge_image ? clothFor(book.id) : undefined,
      photo: of(book.edge_image, book.edge_crop),
      full: whole(book.edge_image),
    },
    {
      word: 'Front',
      cloth: book.front_image ? clothFor(book.id + 1) : undefined,
      photo: of(book.front_image, book.front_crop),
      full: whole(book.front_image),
    },
    {
      word: 'Back',
      cloth: book.back_image ? clothFor(book.id + 2) : undefined,
      photo: of(book.back_image, book.back_crop),
      full: whole(book.back_image),
    },
    {
      word: 'Downloaded',
      // The one that did not come out of the camera, and the one the owner
      // wants first. The list stays in the order the photographs are taken in;
      // `deckOrder` is what moves this one to the front, and only when
      // `cover_image` says there is one to move.
      catalogue: true,
      cloth: book.cover_image ? clothFor(book.id + 3) : undefined,
      photo: coverThumbUrl(book.cover_image, 320),
      // Nothing was ever cut off a downloaded cover, so the whole of it is
      // what is already drawn, only larger.
      full: whole(book.cover_image),
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

/*
 * `moves` and `asRow` were here, and they turned the ledger's rows into the
 * sentences the bottom of this page read out. The section is gone, so the
 * words for it are too rather than being kept warm for a screen nobody has
 * asked for. The rows themselves are untouched and the route that answers with
 * them is still there; if the ledger is ever wanted again it comes back with
 * whatever screen wants it, said the way that screen needs.
 */

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
