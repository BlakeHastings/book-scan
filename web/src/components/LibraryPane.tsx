import { Button } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Filter } from '../design/Finding'
import { List, Row } from '../design/List'
import { Nothing } from '../design/Card'
import { Shelf, type ShelfItem } from '../design/Shelf'
import { TopBar } from '../design/Chrome'
import { areaRuns, type OffTheBookcase } from '../lib/areaRuns'
import { CHECKED_OUT, SHELVED, type BookState } from '../../domain/books/state'
import { clothFor, coverArt, filedAs, pagesOf, spineArt } from '../lib/bookLook'
import { plural } from '../lib/carryWords'
import { grouped } from '../lib/say'
import { useBrowsing } from '../app/browsing'
import { useListing } from '../app/listing'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { Frame } from './Frame'
import { More } from './More'
import { useRoomMenu } from './RoomMenu'
import type { FiledBookRow } from '../lib/api'

/**
 * Three states, since `catalogued_books` holds three; the other four are the
 * queue's, a different screen. `shelved` is included for completeness even
 * though no count opens it directly: the row must still be able to name any
 * narrowing it is handed.
 */
const SAID_OF: Record<'shelved' | 'checked_out' | 'withdrawn', string> = {
  shelved: 'On a bookcase',
  checked_out: 'Out of the house',
  withdrawn: 'Gone from the collection',
}

/** Whether a state is one this screen can name. See `SAID_OF`. */
const nameable = (state: BookState): state is keyof typeof SAID_OF => state in SAID_OF

/**
 * Nothing here is a door, since neither has a screen to be a door to: the
 * never-placed are the queue's, and "gone from the collection" is a record
 * rather than a job.
 */
function restSaid(off: OffTheBookcase): string {
  const parts: string[] = []
  if (off.gone > 0) {
    parts.push(off.gone === 1
      ? 'One is gone from the collection'
      : `${grouped(off.gone)} are gone from the collection`)
  }
  if (off.unplaced > 0) {
    parts.push(off.unplaced === 1
      ? 'one has never been put anywhere'
      : `${grouped(off.unplaced)} have never been put anywhere`)
  }
  return `${parts.join(', and ')}, so ${
    off.total - off.out === 1 ? 'it is' : 'they are'} not drawn above.`
}

export function LibraryPane() {
  const { setRoute } = useNavigation()
  const { look, setLook, narrowing, showing, setShowing } = useBrowsing()
  const { viewBook } = useOpenBook()
  // The same corner and sheet the first screen draws, from the same place,
  // so the two cannot drift.
  const room = useRoomMenu()

  const listing = useListing({
    range: 'all',
    tags: narrowing.map((tag) => tag.slug),
    state: showing ?? undefined,
  })

  const { books, total, counts, complete, loading, error } = listing
  const narrowed = narrowing.length > 0 || showing !== null

  // The boards are cut from the areas books stand in, so a narrowing to
  // books off the shelf would draw no board at all. Covers still work,
  // since a lent book still has a cover; a view this narrowing cannot draw
  // falls back to the list rather than to nothing.
  const standing = showing === null || showing === SHELVED
  const looks = standing ? undefined : (['covers', 'list'] as const)
  const drawn = standing || look !== 'spines' ? look : 'list'

  // Undefined until counts arrive: drawing "0 books" over an empty page
  // would misrepresent the collection for as long as the request takes.
  const counted = counts
    ? narrowed
      ? `${grouped(total)} of ${plural(counts.total, 'book')}`
      : plural(counts.total, 'book')
    : undefined

  const open = (book: FiledBookRow) => viewBook(book.id)

  return (
    <Frame
      tab="library"
      over={room.sheet}
      top={<TopBar title="Library" sub={counted} action={room.action} />}
    >
      <Filter
        tags={narrowing.map((tag) => tag.label)}
        showing={showing && nameable(showing) ? SAID_OF[showing] : undefined}
        note={counts ? plural(total, 'book') : ''}
        onTags={() => setRoute('tags')}
        onFind={() => setRoute('find')}
        look={drawn}
        looks={looks}
        onLook={setLook}
      />

      {/* The way back out of a narrowing that is not a tag: a tag comes off
          on the tags screen, and this one is not a tag. */}
      {showing && (
        <div className="wf-under">
          <Button tone="quiet" onPress={() => setShowing(null)}>
            Show every book
          </Button>
        </div>
      )}

      {error && <Nothing said="The library could not be read." >{error}</Nothing>}

      {!error && !loading && total === 0 && (
        <Nothing
          said={
            narrowing.length > 0
              ? 'No book here carries all of those.'
              : showing
                ? 'No book is in that state just now.'
                : 'Nothing is catalogued yet.'
          }
        >
          {narrowing.length > 0 && <p>Take a tag off to see more of the collection.</p>}
        </Nothing>
      )}

      {drawn === 'covers' && <CoverView books={books} onOpen={open} />}
      {drawn === 'list' && <ListView books={books} onOpen={open} />}
      {drawn === 'spines' && (
        <SpineView
          books={books}
          complete={complete}
          onOpen={open}
          onOut={() => setShowing(CHECKED_OUT)}
        />
      )}

      {!complete && total > 0 && (
        <More total={total} loading={loading} onMore={listing.more} />
      )}

      {/* The only door to the list of books whose recorded spot disagrees
          with the filing order; deleting this button would delete that screen. */}
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

  // Deliberately no location or checked-out line: somebody browsing covers
  // is browsing what they own, not auditing where things are. Both still
  // appear one press away, on the list view and the book's own page.
  const items: CoverItem[] = books.map((book) => ({
    id: book.id,
    title: book.title,
    // Empty rather than "Unknown author": a blank line still keeps the
    // tile's height, matching the covers beside it.
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
 * Rows are cut from the listing rather than fetched separately. The page
 * arrives in filing order, which is not where anything is standing; each
 * book carries the area it is on and where that area stands, and `areaRuns`
 * turns the one into the other.
 */
function SpineView({
  books, complete, onOpen, onOut,
}: {
  books: FiledBookRow[]
  complete: boolean
  onOpen: (book: FiledBookRow) => void
  /** Show the books that are out of the house, which is this screen narrowed. */
  onOut: () => void
}) {
  const { runs, off } = areaRuns(books, complete)

  // The piece itself rather than its label: two pieces standing on one
  // number are both called "Bookcase 4" until somebody names one of them,
  // and they are still two bookcases with a heading each.
  let piece = 0

  return (
    <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
      {runs.map((run) => {
        const heading = run.standing.fixtureId === piece ? null : run.piece
        piece = run.standing.fixtureId

        const items: ShelfItem[] = (run.books as FiledBookRow[]).map((book) => ({
          kind: 'spine',
          text: filedAs(book) || book.title,
          cloth: clothFor(book.id),
          pages: pagesOf(book),
          photo: spineArt(book, 160),
          onPress: () => onOpen(book),
        }))

        return (
          // Keyed on the area: a label can be shared by two boards, and an
          // index changes under a board when the page before it grows.
          <div key={run.areaId} style={{ display: 'grid', gap: 20 }}>
            {heading && <p className="wf-heading">{heading}</p>}
            <Shelf
              label={run.label}
              // Only once the listing has finished: any board can still gain
              // a book from a later page.
              note={run.closed ? plural(run.books.length, 'book') : undefined}
              items={items}
            />
          </div>
        )
      })}

      {/* The lending half is a button: it opens this same library on those
          books, where each one's page offers to check it in. The other two
          are said but not offered, since neither has a screen to open. */}
      {off.total > 0 && (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          {off.out > 0 && (
            <Button tone="quiet" onPress={() => onOut()}>
              {off.out === 1
                ? 'One book is out of the house'
                : `${grouped(off.out)} books are out of the house`}
            </Button>
          )}
          {off.total - off.out > 0 && (
            <p className="wf-said">{restSaid(off)}</p>
          )}
        </div>
      )}
    </div>
  )
}
