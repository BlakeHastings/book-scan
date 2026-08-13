/**
 * A listing of books, a page at a time.
 *
 * The library and the find screen ask the same question with different
 * narrowings, and both are drawn on a phone against a collection that is 288
 * books today and is added to most days. So neither of them asks for the whole
 * catalogue: they ask for a page, draw it, and ask for the next one when
 * somebody reaches the bottom.
 *
 * ## Why a page and not all of it
 *
 * The library is the screen with the most books in the product, and the drawing
 * assumed a number. At ten times today's catalogue, one response is several
 * megabytes of JSON on a phone before anything appears, and several thousand
 * elements in the page before it can be scrolled. A page bounds both: what
 * arrives, and what is drawn.
 *
 * Sixty, because three columns of covers at 414 wide is twenty rows, which is
 * about five screens of scrolling, and because a page a person can reach the
 * bottom of before the next one lands is a page that was too small.
 *
 * ## The narrowing decides when it starts again
 *
 * Everything about a query except which page it is lives in `key`. When that
 * changes, the listing starts from the first page and replaces what it held,
 * because a page three of one question is not a page three of another. Adjusted
 * during the render that sees it rather than in an effect afterwards, so there
 * is never a moment where the next page of the old question is in flight.
 */

import { useEffect, useState } from 'react'
import { api, type BookQuery, type Counts, type FiledBookRow } from '../lib/api'

export const PAGE = 60

export interface Listing {
  /** Every book loaded so far, in filing order. */
  books: FiledBookRow[]
  /** How many the query matches, which is more than has loaded. */
  total: number
  /** The whole collection, which is the number under the title. */
  counts: Counts | null
  loading: boolean
  error: string
  /** Whether everything the query matches has loaded. */
  complete: boolean
  /** Ask for the next page. Does nothing once everything has loaded. */
  more: () => void
}

export function useListing(query: BookQuery, page = PAGE): Listing {
  const key = JSON.stringify(query)

  const [at, setAt] = useState({ key, pages: 1 })
  const [books, setBooks] = useState<FiledBookRow[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // A different question, from this render on. React re-runs the component
  // before touching the DOM, so nothing is drawn against the old answer.
  if (at.key !== key) setAt({ key, pages: 1 })

  useEffect(() => {
    let live = true
    setLoading(true)

    api.findBooks({ ...query, limit: page, offset: (at.pages - 1) * page })
      .then((answer) => {
        if (!live) return
        setBooks((held) => (at.pages === 1 ? answer.books : [...held, ...answer.books]))
        setTotal(answer.total)
        setCounts(answer.counts)
        setError('')
      })
      .catch((caught) => {
        if (live) setError((caught as Error).message)
      })
      .finally(() => {
        if (live) setLoading(false)
      })

    return () => { live = false }
    // `at` is the whole of what decides the request: the narrowing, as a
    // string, and how far down it somebody has read.
  }, [at, page])

  return {
    books,
    total,
    counts,
    loading,
    error,
    complete: books.length >= total,
    more: () => setAt((held) => ({ ...held, pages: held.pages + 1 })),
  }
}
