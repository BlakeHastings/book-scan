import { useEffect, useState } from 'react'
import { Actions, Head, Part, Tagged, Tagging, Where } from '../design/Book'
import { Button } from '../design/Controls'
import { Nothing } from '../design/Card'
import { IconEdit } from '../design/Icons'
import { List, Place, Row } from '../design/List'
import { Shelf } from '../design/Shelf'
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
import { clothFor, pagesOf, standing } from '../lib/bookLook'
import { whenSaid } from '../lib/carryWords'
import { coverThumbUrl, coverUrl } from './PlacementCard'
import { rememberedFirstPicture } from '../lib/firstPicture'
import { grouped } from '../lib/say'
import { useBrowsing } from '../app/browsing'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { Frame } from './Frame'

export function BookPane() {
  const { setRoute, openClaim } = useNavigation()
  const { viewing, setTyped } = useBrowsing()
  const { openBook, moveBook, viewBook } = useOpenBook()

  const [book, setBook] = useState<BookRow | null>(null)
  const [credits, setCredits] = useState<Credit[]>([])
  const [tags, setTags] = useState<AppliedTag[]>([])
  const [strip, setStrip] = useState<PlacementStrip | null>(null)
  const [theirs, setTheirs] = useState<{ books: BookRow[]; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Read once on mount; it is changed on another screen, and coming back
  // here mounts this again.
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

  // Asked only once the record has arrived, since the request is built from
  // it. `previewPlacement` writes nothing.
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

  // Computed once so the section can't disagree with what it lists: "is
  // there more" is this list being non-empty, not a separate count.
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

      <Actions>
        {/* The same walk `moveBook` makes elsewhere: `api.updateAndShelve`
            writes the plank and the check-in together, and neither is a
            fact this screen holds. */}
        {out ? (
          <Button tone="secondary" small onPress={() => void moveBook(book.id)}>
            Check it in
          </Button>
        ) : (
          <Button tone="secondary" small onPress={() => void checkOut(true)}>
            {busy ? 'Just a moment' : 'Check it out'}
          </Button>
        )}
        {!out && (
          <Button tone="quiet" small onPress={() => void moveBook(book.id)}>
            It moved
          </Button>
        )}
        {!book.isbn13 && (
          <Button tone="quiet" small onPress={() => void openBook(book.id)}>
            Say what it is
          </Button>
        )}
      </Actions>

      <Where>
        {out ? (
          // Said the way the rest of the app says a day, through `whenSaid`:
          // "yesterday" inside the week and "on 24 August" beyond it.
          <div>
            <Place quiet>Out of the house</Place>
            <p className="wf-said">Checked out {whenSaid(book.checked_out_at!.slice(0, 10))}.</p>
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

        <Actions>
          <Button tone="quiet" small onPress={() => openClaim(book.id)}>
            Why is it here?
          </Button>
        </Actions>
      </Where>

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
 * A crop is drawn in preference to the whole photograph, since the room a
 * book was photographed in is not part of the book, but each shot also
 * carries the whole photograph for the full-screen view. That full view is
 * asked for at no width at all, deliberately: the server's largest resize
 * is 640, which is smaller than a phone's own screen.
 */
function shotsOf(book: BookRow): Shot[] {
  const of = (file: string, crop: string) => coverThumbUrl(crop || file, 320)
  // Nothing where there is no photograph, rather than a url to a file that
  // is not there.
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
      // `deckOrder` moves this one to the front when `cover_image` says
      // there is one; this list stays in the order photographs are taken.
      catalogue: true,
      cloth: book.cover_image ? clothFor(book.id + 3) : undefined,
      photo: coverThumbUrl(book.cover_image, 320),
      full: whole(book.cover_image),
    },
  ]
}

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
