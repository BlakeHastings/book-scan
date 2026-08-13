/**
 * What files onto this area, what beats what when two rules want a book, and
 * the way to point the rule somewhere else.
 *
 * The books come from the area's own route, by identity. There is no second
 * request and no matching: `GET /api/areas/:id/books` is what #318 asked for
 * and what replaced the label match this screen's sibling used to make.
 */

import { useEffect, useState } from 'react'
import { BelongsPane } from '../components/BelongsPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, type AreaBook } from '../lib/api'

export function BelongsScreen() {
  const { setRoute, openArranging, openClaim } = useNavigation()
  const { fixtureId, areaId } = useArranging()
  const { room, error, setError } = useRoom()
  const [books, setBooks] = useState<AreaBook[]>([])
  const tabs = useRoomTabs()
  useDesignPage()

  const piece = room?.fixtures.find((one) => one.id === fixtureId) ?? null
  const area = piece?.areas.find((one) => one.id === areaId) ?? null

  useEffect(() => {
    if (areaId === null) return
    let stale = false
    api.areaBooks(areaId)
      .then((read) => { if (!stale) setBooks(read.books) })
      .catch((caught) => setError((caught as Error).message))
    return () => { stale = true }
  }, [areaId, setError])

  return (
    <BelongsPane
      room={room}
      piece={piece}
      area={area}
      books={books}
      error={error}
      tabs={tabs}
      onBack={() => setRoute('area')}
      onChange={() => { if (area?.rule?.range) openArranging(area.rule.range) }}
      onClaimed={openClaim}
    />
  )
}
