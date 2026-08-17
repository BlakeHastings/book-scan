/**
 * Why one book is here.
 *
 * Reached from two places and back to whichever one it came from: the books
 * standing on an area, and the book's own page. That is why the book it is about
 * lives in `navigation` rather than in `arranging`, which is about furniture.
 *
 * Opening a rule from here lands on the screen that rule is drawn on, which is
 * `belongs`, on the area the rule points at. A rule about a whole piece of
 * furniture is drawn on the first area of that piece, because that is the area
 * its books begin in and the one whose screen already says so.
 */

import { useEffect, useState } from 'react'
import { ClaimedPane } from '../components/ClaimedPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { api, type BookClaim, type RuleDto } from '../lib/api'

export function ClaimedScreen() {
  const { claiming, closeClaim } = useNavigation()
  const { setFixtureId, setAreaId, onward } = useArranging()
  const { room, error, setError } = useRoom()
  const [claim, setClaim] = useState<BookClaim | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  useEffect(() => {
    if (claiming === null) return
    let stale = false
    setClaim(null)
    api.bookClaim(claiming)
      .then((read) => { if (!stale) setClaim(read.claim) })
      .catch((caught) => setError((caught as Error).message))
    return () => { stale = true }
  }, [claiming, setError])

  /** Where a rule is drawn: the area it points at, on the piece holding it. */
  const openRule = (rule: RuleDto) => {
    if (!room || rule.placeId === null) return
    const piece = rule.about === 'area'
      ? room.fixtures.find((one) => one.areas.some((area) => area.id === rule.placeId))
      : room.fixtures.find((one) => one.id === rule.placeId)
    if (!piece) return

    const area = rule.about === 'area'
      ? piece.areas.find((one) => one.id === rule.placeId)
      : piece.areas[0]
    if (!area) return

    setFixtureId(piece.id)
    setAreaId(area.id)
    /*
     * Through the trail rather than straight to the route, so that back off
     * that screen is this one. It used to land on the area screen, which is a
     * screen somebody arriving from a book has never seen (#367).
     */
    onward('belongs')
  }

  return (
    <ClaimedPane
      claim={claim}
      room={room}
      error={error}
      tabs={tabs}
      onBack={closeClaim}
      onRule={openRule}
    />
  )
}
