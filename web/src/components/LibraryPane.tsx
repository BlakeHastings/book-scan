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
 *   next sixty when the end of what has loaded arrives on screen, so what
 *   arrives and what is drawn are both bounded however large the catalogue
 *   gets. The route grew `limit`, `offset` and `total` for this.
 * - **The boards are cut from the same page.** The books standing up are the
 *   listing grouped into the areas it is already in order for, so the third view
 *   costs no second request and no second scroll.
 * - **A picture is asked for at the size it is drawn.** 320 pixels wide for a
 *   tile about 120 across, which the server resizes; the full files are tens of
 *   megabytes across a screen of them.
 *
 * **The second of those undid the first, and #364 is the repair.** A page of
 * sixty books adds a screenful of height to the covers and to the list, and
 * adds almost none to the boards, where one area is one row of spines that
 * scrolls sideways rather than a column that grows. The bottom of the listing
 * was therefore permanently on screen there, "reached the bottom" was
 * permanently true, and this screen quietly fetched the whole catalogue on
 * arrival, sixty at a time, in half a second, with nobody scrolling.
 * `src/components/More.tsx` and `src/lib/reachingTheEnd.ts` carry the rule that
 * ends it, and what it costs the boards is said there: where the drawing does
 * not get taller, there is no downward scroll to fetch on, and the button is
 * what advances the page, which is what that button has always been for.
 *
 * What is left is said in the pull request rather than hidden: a count beside an
 * area is only drawn once that area has finished loading, because the last row
 * of a page is usually half a plank.
 */

import { Button } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Filter } from '../design/Finding'
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
import { useRoomMenu } from './RoomMenu'
import type { FiledBookRow } from '../lib/api'

export function LibraryPane() {
  const { setRoute } = useNavigation()
  const { look, setLook, narrowing } = useBrowsing()
  const { viewBook } = useOpenBook()
  /* The corner, and the sheet it opens (#350). The same one the first screen
     draws, from the same place, so the two cannot drift. */
  const room = useRoomMenu()

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
      over={room.sheet}
      top={<TopBar title="Library" sub={counted} action={room.action} />}
    >
      {/*
        Finding left the corner with #350 and came down one row, which is the
        trade #329 named the risk in: "losing a corner action and gaining a
        harder-to-find one is a downgrade dressed as a tidy-up." It is still one
        press, from the first row of the page, and at 414 by 896 it is 56px
        lower and 20px further in from the edge than it was, which on a phone
        held in one hand is nearer the thumb rather than further from it. It
        costs no height: this row was already here.
      */}
      <Filter
        tags={narrowing.map((tag) => tag.label)}
        note={counts ? `${grouped(total)} books` : ''}
        onTags={() => setRoute('tags')}
        onFind={() => setRoute('find')}
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
        <More total={total} loading={loading} onMore={listing.more} />
      )}

      {/*
        The way through to the other half of what this screen used to be.

        It said "Check the bookcases against the order" and the owner could not
        say what that meant (#364): "I'm not sure what that means." Two words
        were doing the damage. **The order** is this codebase talking to itself
        about filing rules. **Bookcases** is the noun he has corrected twice,
        most recently as #362 is sweeping the interface onto fixtures, and
        naming any piece of furniture here is wrong anyway, because what is
        behind this is not about the furniture.

        He led with taking it off, and it was checked before it was kept. Two of
        the three things behind it are reachable elsewhere now: the furniture is
        one tap from the corner (#350), and pointing a stretch of books at
        another piece is reached from the rule that files them (#323). **The
        third is not.** The list of books whose recorded spot disagrees with
        where the filing order puts them is drawn on that screen and on no
        other, it is what somebody acts on, and #358 has just repaired it after
        it had been silently dropping 181 books. Deleting the only door to it
        would delete it.

        So it stays and it is named for what a person gets. Not "books to
        carry", which is #314's flow, one tap from the first screen, and a
        different question: that one is work a rule change made, and this one is
        a book that ended up somewhere the filing order does not put it.
      */}
      <div className="wf-under">
        <Button tone="quiet" onPress={() => setRoute('shelves')}>
          Books that are not where they should be
        </Button>
      </div>
    </Frame>
  )
}

/** The gallery, which is the one for "that one, the green one". */
function CoverView({ books, onOpen }: { books: FiledBookRow[]; onOpen: (book: FiledBookRow) => void }) {
  const byId = new Map(books.map((book) => [book.id, book]))

  /*
   * A cover and a name, and nothing about where the book stands (#407).
   *
   * > Whenever we're in the gallery view in the library, let's not put
   * > underneath the books where they're currently located. We can just show
   * > the book covers and the author name underneath the book.
   *
   * This is the pinned rule about a book screen turned on a wall of them:
   * somebody looking at their covers is browsing what they own, not auditing
   * where things are. The same instinct took the location sentence off the
   * book page in #282 and off the confirmation in #290, both times because the
   * drawing already said it. **The wireframe this screen was built from never
   * drew a place under a cover at all**, so this is the app catching up with
   * the design rather than a fresh opinion: `design/gallery/screens.tsx` builds
   * its gallery out of `covers()`, which carries a title, a name and a cloth,
   * and has never carried anywhere.
   *
   * **Both lines came off, not only the place.** "Checked out" was drawn in
   * the same slot as the place, chosen by the same expression, and answers the
   * same question: it is where a book is when the answer is not a shelf.
   * `CoverItem` says as much itself, calling it "a word instead of a place".
   * Keeping it would have left a third line on a handful of tiles and not on
   * the rest, which is the ragged grid rather than the deliberate one.
   *
   * **Nothing is hidden, only moved off a browsing surface.** The list beside
   * this one still says both, one press away on the same row; the book's own
   * page draws where it stands and says "Out of the house" for a book that is
   * lent; and the button at the foot of this screen opens the whole screen
   * about books that are not where they should be.
   */
  const items: CoverItem[] = books.map((book) => ({
    id: book.id,
    title: book.title,
    /* Empty for a book nobody is credited on, which is a real state rather
       than a gap to fill in: the fallback is what the book itself carries, and
       never the words "Unknown author". Such a tile is its cover and a blank
       line, and the line is still drawn so the covers beside it keep their
       height. */
    author: filedAs(book),
    cloth: clothFor(book.id),
    photo: coverArt(book, 320),
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
