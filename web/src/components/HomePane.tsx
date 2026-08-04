import type { Counts, QueueCounts } from '../lib/api'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  onAdd: () => void
  onCheckOut: () => void
  onShelve: () => void
  onLibrary: () => void
  onQueue: () => void
}

/**
 * Where the app opens, and the answer to "what am I doing right now".
 *
 * There are four jobs, and which one you are on is decided before you pick up
 * a book, not after. Opening straight into the camera assumed the answer was
 * always "adding", and left taking books off the shelf as a pair of buttons
 * tucked above the library listing, which is not where anyone would look for
 * them.
 */
export function HomePane({
  counts, queue, onAdd, onCheckOut, onShelve, onLibrary, onQueue,
}: Props) {
  const waiting = queue ? queue.pending + queue.ready + queue.failed : 0

  return (
    <main className="main">
      <div className="home">
        <Tile
          title="Add"
          body="Photograph a new book and put it on a bookcase."
          onClick={onAdd}
          primary
        />
        <Tile
          title="Check out"
          body="Hold books up to take them off the bookcase."
          onClick={onCheckOut}
        />
        <Tile
          title="Shelve"
          body="Put a book back, with the guided shuffle."
          onClick={onShelve}
        />
        <Tile
          title="Library"
          body={counts ? `Browse all ${counts.total} books.` : 'Browse the bookcases.'}
          onClick={onLibrary}
        />
      </div>

      {/* Full width and last, because it is a to-do list rather than a job you
          set out to do. Hidden entirely when there is nothing in it. */}
      {waiting > 0 && (
        <button className="home__queue" onClick={onQueue}>
          <span className="home__queue-title">
            Queue
            <span className="home__queue-badge">{waiting}</span>
          </span>
          <span className="home__queue-body">
            {queue?.ready ? `${queue.ready} ready to confirm. ` : ''}
            {queue?.pending ? `${queue.pending} still reading. ` : ''}
            {queue?.failed ? `${queue.failed} need an ISBN by hand.` : ''}
          </span>
        </button>
      )}

      {counts && counts.checkedOut > 0 && (
        <button className="home__off" onClick={onLibrary}>
          {counts.checkedOut} book{counts.checkedOut === 1 ? '' : 's'} off the bookcase
        </button>
      )}
    </main>
  )
}

function Tile({
  title, body, onClick, primary = false,
}: {
  title: string
  body: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button className={primary ? 'tile tile--primary' : 'tile'} onClick={onClick}>
      <span className="tile__title">{title}</span>
      <span className="tile__body">{body}</span>
    </button>
  )
}
