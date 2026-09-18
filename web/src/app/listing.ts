/**
 * Sixty, because three columns of covers at 414 wide is twenty rows, about five screens of
 * scrolling, and a page a person can reach the bottom of before the next one lands is too small.
 *
 * Everything about a query except which page it is lives in `key`. When that changes, the
 * listing starts from the first page and replaces what it held. This is adjusted during the
 * render that sees it rather than in an effect afterwards, so there is never a moment where the
 * next page of the old question is in flight.
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

  // React re-runs the component before touching the DOM, so nothing is drawn against the old answer.
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
