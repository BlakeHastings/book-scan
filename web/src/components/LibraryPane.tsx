/**
 * The library: every book somebody owns, drawn three ways.
 *
 * ## One screen with a switcher, not three screens
 *
 * Covers, a list and the books standing up are three drawings of one set of
 * books in one order, and which of them you like is a preference somebody sets
 * about as often as they rearrange the furniture. So there is one request, one
 * filter row, one scroll position and one small round button at the end of that
 * row, which is where the owner asked for it:
 *
 * > Instead of showing covers, list and spines as this very big thing that we
 * > can select one of three options for, can we put it to the right of the
 * > "every book" filter [...] That way you don't take up all this space for
 * > choosing between those different views.
 *
 * ## Fiction and non-fiction are not a control here any more
 *
 * They were two tabs at the top of this screen, and they are now two tags out of
 * however many somebody keeps. The owner named what was wrong with the pair:
 * they were "an opinionated approach just due to what we were needing to do at
 * the time". So this screen opens on the whole collection, and the one row above
 * the books says what is being shown and opens the tags.
 *
 * ## This screen holds the most books in the product
 *
 * 288 today, growing most days, and it has to stay usable at ten times that on a
 * phone. Three things answer that, and none of them is a promise:
 *
 * - **It asks for a page.** `useListing` fetches sixty books and asks for the
 *   next sixty when somebody reaches the bottom, so what arrives and what is
 *   drawn are both bounded however large the catalogue gets. The route grew
 *   `limit`, `offset` and `total` for this.
 * - **The boards are cut from the same page.** The books standing up are the
 *   listing grouped into the areas it is already in order for, so the third view
 *   costs no second request and no second scroll.
 * - **A picture is asked for at the size it is drawn.** 320 pixels wide for a
 *   tile about 120 across, which the server resizes; the full files are tens of
 *   megabytes across a screen of them.
 *
 * What is left is said in the pull request rather than hidden: a count beside an
 * area is only drawn once that area has finished loading, because the last row
 * of a page is usually half a plank.
 */

import { Button } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Filter } from '../design/Finding'
import { IconFind } from '../design/Icons'
import { List, Row } from '../design/List'
import { Nothing } from '../design/Card'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { TopBar } from '../design/Chrome'
import { areaRuns } from '../lib/areaRuns'
import { clothFor, coverArt, filedAs, pagesOf, spineArt } from '../lib/bookLook'
import { grouped } from '../lib/say'
import { useBrowsing } from '../app/browsing'
import { useListing } from '../app/listing'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { Frame } from './Frame'
import { More } from './More'
import type { FiledBookRow } from '../lib/api'

export function LibraryPane() {
  const { setRoute } = useNavigation()
  const { look, setLook, narrowing } = useBrowsing()
  const { viewBook } = useOpenBook()

  const listing = useListing({
    range: 'all',
    tags: narrowing.map((tag) => tag.slug),
  })

  const { books, total, counts, complete, loading, error } = listing
  const narrowed = narrowing.length > 0

  /*
   * Nothing has come back yet.
   *
   * Every number on this screen is about somebody's collection, so until one
   * arrives there are no numbers: drawing "0 books" over an empty page says
   * their library is empty, which is false for as long as the first request
   * takes and is the one thing this screen must never say by accident.
   */
  const counted = counts
    ? narrowed
      ? `${grouped(total)} of ${grouped(counts.total)} books`
      : `${grouped(counts.total)} books`
    : undefined

  const open = (book: FiledBookRow) => viewBook(book.id)

  return (
    <Frame
      tab="library"
      top={
        <TopBar
          title="Library"
          sub={counted}
          action={{ word: 'Find', icon: <IconFind />, onPress: () => setRoute('find') }}
        />
      }
    >
      <Filter
        tags={narrowing.map((tag) => tag.label)}
        note={counts ? `${grouped(total)} books` : ''}
        onTags={() => setRoute('tags')}
        look={look}
        onLook={setLook}
      />

      {error && <Nothing said="The library could not be read." >{error}</Nothing>}

      {!error && !loading && total === 0 && (
        <Nothing said={narrowed ? 'No book here carries all of those.' : 'Nothing is catalogued yet.'}>
          {narrowed && <p>Take a tag off to see more of the collection.</p>}
        </Nothing>
      )}

      {look === 'covers' && <CoverView books={books} onOpen={open} />}
      {look === 'list' && <ListView books={books} onOpen={open} />}
      {look === 'spines' && <SpineView books={books} complete={complete} onOpen={open} />}

      {!complete && total > 0 && (
        <More shown={books.length} total={total} loading={loading} onMore={listing.more} />
      )}

      {/*
        The way through to the other half of what this screen used to be.

        The drawn library has one quiet button at the bottom, to the furniture.
        This one goes to the shelves as a job of work: the areas as the order
        says they should be, with the disagreements listed. Most of what was on
        it now has a home of its own, since #313 gave the furniture screens and
        #314 gave the carrying its flow, and what has not is the reason this is
        still here: moving a whole run to another piece of furniture is reached
        from there and from nowhere else.

        Deliberately not worded as books to carry. That is #314's flow and it is
        one tap from the first screen; two doors to one room is the fault this
        design keeps taking things off screens for.
      */}
      <div className="wf-under">
        <Button tone="quiet" onPress={() => setRoute('shelves')}>
          Check the bookcases against the order
        </Button>
      </div>
    </Frame>
  )
}

/** The gallery, which is the one for "that one, the green one". */
function CoverView({ books, onOpen }: { books: FiledBookRow[]; onOpen: (book: FiledBookRow) => void }) {
  const byId = new Map(books.map((book) => [book.id, book]))
  const items: CoverItem[] = books.map((book) => ({
    id: book.id,
    title: book.title,
    author: filedAs(book),
    cloth: clothFor(book.id),
    photo: coverArt(book, 320),
    // Where it lives, or the reason it does not live anywhere.
    place: book.location || undefined,
    meta: book.checked_out_at ? 'Checked out' : undefined,
  }))

  return (
    <Covers
      items={items}
      label="Your books"
      onPress={(item) => {
        const book = byId.get(Number(item.id))
        if (book) onOpen(book)
      }}
    />
  )
}

/** The list, which is the one you scan a column of authors in. */
function ListView({ books, onOpen }: { books: FiledBookRow[]; onOpen: (book: FiledBookRow) => void }) {
  return (
    <List label="Every book">
      {books.map((book) => (
        <Row
          key={book.id}
          title={book.title}
          sub={filedAs(book)}
          cloth={clothFor(book.id)}
          photo={coverArt(book, 160)}
          place={book.checked_out_at ? undefined : book.location || undefined}
          meta={book.checked_out_at ? 'Checked out' : undefined}
          onPress={() => onOpen(book)}
        />
      ))}
    </List>
  )
}

/**
 * The books as they physically stand, one board per area.
 *
 * The rows are cut from the listing rather than fetched, and a book that is not
 * on a bookcase is left out of them rather than drawn in one: the run has closed
 * up behind it, exactly as it has in the room. How many those are is said under
 * the boards, because something you cannot see belongs in words.
 */
function SpineView({
  books, complete, onOpen,
}: {
  books: FiledBookRow[]
  complete: boolean
  onOpen: (book: FiledBookRow) => void
}) {
  const { runs, off } = areaRuns(books, complete)

  let piece = ''

  return (
    <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
      {runs.map((run, index) => {
        const heading = run.piece === piece ? null : run.piece
        piece = run.piece

        const items: ShelfItem[] = (run.books as FiledBookRow[]).map((book) => ({
          kind: 'spine',
          text: filedAs(book) || book.title,
          cloth: clothFor(book.id),
          pages: pagesOf(book),
          photo: spineArt(book, 160),
          onPress: () => onOpen(book),
        }))

        return (
          <div key={`${run.label}-${index}`} style={{ display: 'grid', gap: 20 }}>
            {heading && <p className="wf-heading">{heading}</p>}
            <Shelf
              label={run.label}
              /* Only for a row that has finished loading. The last row of a page
                 is usually half a plank, and a count over it would be wrong
                 until somebody scrolled. */
              note={run.closed ? `${run.books.length} books` : undefined}
              items={items}
            />
          </div>
        )
      })}

      {off > 0 && (
        <p className="wf-said">
          {off === 1
            ? 'One book is not on a bookcase, so it is not drawn above.'
            : `${grouped(off)} books are not on a bookcase, so they are not drawn above.`}
        </p>
      )}
    </div>
  )
}
