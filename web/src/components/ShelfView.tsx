import { useCallback, useEffect, useState } from 'react'
import {
  api, type BookRow, type CheckedOutAt, type Counts, type Move, type ShelfGroupDto,
} from '../lib/api'
import { coverUrl } from './PlacementCard'
import { areaLabel } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

interface Props {
  onOpen: (id: number) => void
}

/**
 * The shelves as they physically are, rather than one flat list.
 *
 * Each group is a real shelf. The button at the end of the last one is how the
 * software learns something it cannot see: that the shelf is full. From then
 * on a book inserted earlier in the alphabet pushes the last one along, and
 * the moves that causes are reported rather than left for you to discover at
 * the shelf.
 */
export function ShelfView({ onOpen }: Props) {
  const [range, setRange] = useState<ShelfRange>('fiction')
  const [groups, setGroups] = useState<ShelfGroupDto[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [counts, setCounts] = useState<Counts | null>(null)
  const [off, setOff] = useState<CheckedOutAt[]>([])

  /*
   * Both tallies, not just this tab's. A non-fiction book saved while the
   * library sits on Fiction is invisible with no hint it exists, which reads
   * as the save having silently failed rather than as a tab being unopened.
   */
  useEffect(() => {
    api.health().then((h) => setCounts(h.counts)).catch(() => {})
  }, [groups])

  const load = useCallback(() => {
    setLoading(true)
    api.shelves(range)
      .then((result) => {
        setGroups(result.groups)
        setOff(result.checkedOut)
      })
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => { load() }, [load])

  const removeSeparator = async (id: number) => {
    setError('')
    try {
      const result = await api.removeSeparator(id, range)
      setGroups(result.groups)
      setMoves(result.moves)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  const title = (book: BookRow) => book.author_filing || book.authors || book.title

  /**
   * The books on a shelf plus, in their alphabetical slots, the ones that
   * belong there but are currently off it.
   *
   * The numbering deliberately counts only what is physically present, since
   * that is what you use to find a book by counting along. An absent book gets
   * a dash: it is in the list to explain a gap, not to be counted to.
   */
  const rowsFor = (group: ShelfGroupDto) => {
    const present = group.books.map(({ book }, i) => ({ book, n: i + 1, here: true }))
    const absent = off
      .filter((entry) => entry.label === group.label)
      .map((entry) => ({ book: entry.book, n: 0, here: false }))

    return [...present, ...absent].sort((a, b) =>
      a.book.sort_key < b.book.sort_key ? -1 : a.book.sort_key > b.book.sort_key ? 1 : 0)
  }

  return (
    <main className="main">
      <div className="segmented">
        <button
          className={range === 'fiction' ? 'seg seg--on' : 'seg'}
          onClick={() => { setMoves([]); setRange('fiction') }}
        >
          Fiction{counts ? ` (${counts.fiction})` : ''}
        </button>
        <button
          className={range === 'nonfiction' ? 'seg seg--on' : 'seg'}
          onClick={() => { setMoves([]); setRange('nonfiction') }}
        >
          Non-fiction{counts ? ` (${counts.nonfiction})` : ''}
        </button>
      </div>

      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {off.length > 0 && (
        <section className="offshelf">
          <h3 className="offshelf__head">
            Off the shelf ({off.length})
          </h3>
          <p className="hint">
            Held out of the layout, so nothing is filed next to them. Open one
            to put it back.
          </p>
          {off.map(({ book, label }) => (
            <button key={book.id} className="offshelf__row" onClick={() => onOpen(book.id)}>
              <span className="offshelf__title">{book.title}</span>
              <span className="offshelf__author">{title(book)} · belongs at {label}</span>
            </button>
          ))}
        </section>
      )}

      {/* The physical consequence of the change, which is the part that is
          easy to lose track of. */}
      {moves.length > 0 && (
        <div className="moves" onClick={() => setMoves([])}>
          <strong>{moves.length} book{moves.length === 1 ? '' : 's'} to move</strong>
          <ul>
            {moves.map((move) => (
              <li key={move.id}>
                {move.title ?? `#${move.id}`}: {move.from} to <strong>{move.to}</strong>
              </li>
            ))}
          </ul>
          <span className="hint">Tap to dismiss once they are moved.</span>
        </div>
      )}

      {loading && <p className="hint">Loading...</p>}
      {!loading && groups.length === 0 && (
        <p className="hint">Nothing catalogued in this range yet.</p>
      )}

      {groups.map((group) => {
        return (
          <section key={group.label} className="shelfgroup">
            <header className="shelfgroup__head">
              {/* Spelled out rather than left as "A2": the shelf number is the
                  half people actually need when walking to the book. */}
              <span className="shelfgroup__label">Shelf {group.shelf}</span>
              <span className="shelfgroup__shelf">Area {areaLabel(group.area)}</span>
              <span className="shelfgroup__count">
                {group.books.length} books
                {rowsFor(group).length > group.books.length
                  ? `, ${rowsFor(group).length - group.books.length} off`
                  : ''}
              </span>
            </header>

            <ol className="shelf">
              {rowsFor(group).map(({ book, n, here }) => (
                <li key={book.id} className={here ? 'shelfrow' : 'shelfrow shelfrow--off'}>
                  {/* Count along the shelf to find it. The old per-row A1 is
                      gone now that the header carries the location, so this is
                      what identifies a book in the room. */}
                  <span className="shelfrow__n">{here ? n : '--'}</span>
                  <span className="shelfrow__photo">
                    {(book.edge_image || book.front_image) && (
                      <img
                        className={book.edge_image ? 'thumb thumb--edge' : 'thumb thumb--front'}
                        src={coverUrl(book.edge_image || book.front_image)}
                        alt=""
                        loading="lazy"
                      />
                    )}
                  </span>
                  <button className="shelfrow__body" onClick={() => onOpen(book.id)}>
                    <span className="shelfrow__author">{title(book)}</span>
                    <span className="shelfrow__title">{book.title}</span>
                  </button>
                  {/* Repeated per row so a row still says where it is once the
                      header has scrolled away. */}
                  <span className="shelfrow__loc">
                    {here ? group.label : 'off shelf'}
                  </span>
                </li>
              ))}
            </ol>

            {group.separatorId !== null && (
              <div className="divider">
                <span className="divider__label">
                  {group.kind === 'shelf' ? 'New bookcase starts here' : 'New area starts here'}
                </span>
                <button
                  className="btn btn--ghost"
                  onClick={() => removeSeparator(group.separatorId!)}
                >
                  Remove
                </button>
              </div>
            )}
          </section>
        )
      })}
    </main>
  )
}
