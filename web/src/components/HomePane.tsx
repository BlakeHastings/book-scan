import { failureLines } from '../../shared/captureFailure'
import type { Counts, QueueCounts } from '../lib/api'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  onAdd: () => void
  onScan: () => void
  onLibrary: () => void
  onQueue: () => void
}

/**
 * Where the app opens, and the answer to "what am I doing right now".
 *
 * Opening straight into the camera assumed the answer was always "adding",
 * and left everything else as buttons tucked above the library listing, which
 * is not where anyone would look for them.
 *
 * There used to be four tiles here and two of them were the same camera: Check
 * out and Shelve differed only in which direction they wrote. That put the
 * decision before the book, so picking wrong meant backing out and starting
 * again, and it made the app ask a question it had no business asking yet.
 * Now a book that is already in the catalogue has one door, Scan, which opens
 * the book itself. What can be done with it is a property of the book, and the
 * book's own page is where it is said.
 */
export function HomePane({
  counts, queue, onAdd, onScan, onLibrary, onQueue,
}: Props) {
  const waiting = queue ? queue.pending + queue.ready + queue.failed : 0
  /*
   * The failed ones, said one kind at a time (#148). This used to be a single
   * sentence off `queue.failed` telling people to type in an ISBN, which was
   * wrong for every capture whose barcode read perfectly well and whose real
   * problem was that no catalogue has the number. Home is where the work gets
   * sorted, so getting it wrong here mis-sorts it before anybody starts.
   */
  const failures = queue ? failureLines(queue.failures) : []

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
          title="Scan"
          body="Hold a book you already have up to the camera. It opens the book, and you say what happens next."
          onClick={onScan}
        />
        <Tile
          title="Library"
          body={counts ? `Browse all ${counts.total} books.` : 'Browse the bookcases.'}
          onClick={onLibrary}
          wide
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
            {failures.join(' ')}
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
  title, body, onClick, primary = false, wide = false,
}: {
  title: string
  body: string
  onClick: () => void
  primary?: boolean
  /** Takes the whole row rather than half of one. */
  wide?: boolean
}) {
  return (
    <button
      className={['tile', primary ? 'tile--primary' : '', wide ? 'tile--wide' : '']
        .filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <span className="tile__title">{title}</span>
      <span className="tile__body">{body}</span>
    </button>
  )
}
