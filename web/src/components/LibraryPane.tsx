import { useEffect, useState } from 'react'
import { api, type BookRow, type Misfile } from '../lib/api'
import { coverUrl } from './PlacementCard'
import type { ShelfRange } from '../../shared/shelving'

/**
 * Browse a range in shelf order, and surface anything whose recorded location
 * disagrees with its sort position.
 */
export function LibraryPane() {
  const [range, setRange] = useState<ShelfRange>('fiction')
  const [books, setBooks] = useState<BookRow[]>([])
  const [misfiles, setMisfiles] = useState<Misfile[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    Promise.all([api.listBooks(range), api.misfiles()])
      .then(([listed, flagged]) => {
        setBooks(listed.books)
        setMisfiles(flagged.misfiles)
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [range])

  const misfiledIds = new Set(misfiles.map((m) => m.book.id))

  return (
    <main className="main">
      <div className="segmented">
        <button
          className={range === 'fiction' ? 'seg seg--on' : 'seg'}
          onClick={() => setRange('fiction')}
        >
          Fiction
        </button>
        <button
          className={range === 'nonfiction' ? 'seg seg--on' : 'seg'}
          onClick={() => setRange('nonfiction')}
        >
          Non-fiction
        </button>
      </div>

      {misfiles.length > 0 && (
        <div className="warn">
          <strong>{misfiles.length} book{misfiles.length === 1 ? '' : 's'} need attention.</strong>
          <ul>
            {misfiles.map((m) => <li key={m.book.id}>{m.reason}</li>)}
          </ul>
        </div>
      )}

      {loading && <p className="hint">Loading...</p>}

      {!loading && books.length === 0 && (
        <p className="hint">Nothing catalogued in this range yet.</p>
      )}

      <ol className="shelf">
        {books.map((book) => (
          <li key={book.id} className={misfiledIds.has(book.id) ? 'shelf__row shelf__row--flag' : 'shelf__row'}>
            <span className="shelf__loc">{book.location || '??'}</span>
            <span className="shelf__photo">
              {(book.edge_image || book.front_image) && (
                <img
                  src={coverUrl(book.edge_image || book.front_image)}
                  alt=""
                  loading="lazy"
                />
              )}
            </span>
            <span className="shelf__body">
              <span className="shelf__author">{book.author_filing || book.authors}</span>
              <span className="shelf__title">
                {book.title}
                {book.series_name && (
                  <em className="shelf__series">
                    {' '}{book.series_name}
                    {book.series_index !== null ? ` ${book.series_index}` : ''}
                  </em>
                )}
              </span>
            </span>
            <button
              className="btn btn--ghost"
              onClick={() => api.deleteBook(book.id).then(load)}
              aria-label={`Remove ${book.title}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
    </main>
  )
}
