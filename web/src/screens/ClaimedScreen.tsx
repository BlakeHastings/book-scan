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
 *
 * **And since #341 it can say what the book is**, which is the one state this
 * screen used to explain and offer nothing about. It is the same screen the
 * list of books no rule claims opens, drawn here rather than a panel of its
 * own: two screens reaching one way of saying what a book is, exactly as two
 * screens already reach this one.
 */

import { useCallback, useEffect, useState } from 'react'
import { ClaimedPane } from '../components/ClaimedPane'
import { SayingPane } from '../components/SayingPane'
import { useArranging } from '../app/arranging'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoom, useRoomTabs } from '../app/room'
import { useTagging } from '../app/tagging'
import { api, type BookClaim, type BookRow, type RuleDto, type UnclaimedBook } from '../lib/api'

/**
 * The claim, as the screen that settles one book needs a book.
 *
 * The two states are told apart the way `booksNoRuleClaims` tells them apart
 * and by the same fact, so a book reached from here and the same book reached
 * from the list are the same book on that screen. Only ever built for a book no
 * rule claims, which is the only state that opens it.
 */
const asUnclaimed = (claim: BookClaim): UnclaimedBook => ({
  id: claim.book.id,
  title: claim.book.title,
  authorFiling: claim.book.authorFiling,
  standing: claim.standing,
  tags: claim.tags,
  why: claim.tags.length === 0 ? 'untagged' : 'unmatched',
})

export function ClaimedScreen() {
  const { claiming, closeClaim } = useNavigation()
  const { setFixtureId, setAreaId, onward } = useArranging()
  const { room, error, setError } = useRoom()
  const [claim, setClaim] = useState<BookClaim | null>(null)
  const [saying, setSaying] = useState(false)
  const [record, setRecord] = useState<BookRow | null>(null)
  const [naming, setNaming] = useState(false)
  const tabs = useRoomTabs()
  useDesignPage()

  /* Only while that screen is up. It is two reads of a book nobody is looking
     at otherwise, and this screen has its own answer about the book's tags. */
  const tagging = useTagging(saying ? claiming : null)

  const read = useCallback(async () => {
    if (claiming === null) return
    try {
      setClaim((await api.bookClaim(claiming)).claim)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [claiming, setError])

  useEffect(() => {
    if (claiming === null) return
    let stale = false
    setClaim(null)
    api.bookClaim(claiming)
      .then((found) => { if (!stale) setClaim(found.claim) })
      .catch((caught) => setError((caught as Error).message))
    return () => { stale = true }
  }, [claiming, setError])

  /* What the catalogue holds, which is what somebody decides a genre on. Only
     for the screen that asks them to. */
  useEffect(() => {
    if (!saying || claiming === null) return
    let live = true
    setRecord(null)
    api.getBook(claiming)
      .then((answer) => { if (live) setRecord(answer.book) })
      .catch(() => { /* The facts are an addition to that screen, not the screen. */ })
    return () => { live = false }
  }, [saying, claiming])

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

  /*
   * Back off that screen asks the whole claim again, because saying what a book
   * is changes what this screen says: a rule may take it now, and which rule
   * takes which book is `claim` on the server rather than something this can
   * work out. A word no rule wants leaves the screen saying exactly what it
   * said before, which is the truth and is why it also names the other repair.
   */
  const leaveSaying = () => {
    setSaying(false)
    setNaming(false)
    void read()
  }

  if (saying && claim) {
    return (
      <SayingPane
        book={asUnclaimed(claim)}
        record={record}
        tags={tagging.tags}
        carried={tagging.carried}
        vocabulary={tagging.vocabulary}
        busy={tagging.busy}
        error={tagging.error}
        naming={naming}
        tabs={tabs}
        onBack={leaveSaying}
        onSay={(tag) => { setNaming(false); void tagging.add(tag) }}
        onUnsay={tagging.remove}
        onOpenNaming={() => setNaming(true)}
        onCloseNaming={() => setNaming(false)}
      />
    )
  }

  return (
    <ClaimedPane
      claim={claim}
      room={room}
      error={error}
      tabs={tabs}
      onBack={closeClaim}
      onRule={openRule}
      onSay={() => setSaying(true)}
    />
  )
}
