/**
 * The list is re-read every time somebody comes back from settling a book, since which rule
 * takes which book is decided by `claim` on the server and cannot be worked out here.
 *
 * Nothing here writes a tag by itself: every write is `useTagging.add` or `.remove`.
 */

import { useCallback, useEffect, useState } from 'react'
import { SayingPane } from '../components/SayingPane'
import { UnclaimedPane, type Settled } from '../components/UnclaimedPane'
import { useNavigation } from '../app/navigation'
import { useDesignPage, useRoomTabs } from '../app/room'
import { useTagging } from '../app/tagging'
import { api, type BookRow, type UnclaimedBook } from '../lib/api'

/** The page of them and how many there are, which arrive together. */
interface Found {
  books: UnclaimedBook[]
  total: number
}

export function UnclaimedScreen() {
  const { setRoute, openClaim, openRoom } = useNavigation()
  const [found, setFound] = useState<Found | null>(null)
  const [error, setError] = useState('')
  const [saying, setSaying] = useState<UnclaimedBook | null>(null)
  const [record, setRecord] = useState<BookRow | null>(null)
  const [naming, setNaming] = useState(false)
  const [settled, setSettled] = useState<Settled | null>(null)
  const tabs = useRoomTabs()
  useDesignPage()

  const tagging = useTagging(saying?.id ?? null)

  const read = useCallback(async (): Promise<Found | null> => {
    try {
      const answer = await api.unclaimed()
      setFound(answer)
      setError('')
      return answer
    } catch (caught) {
      setError((caught as Error).message)
      return null
    }
  }, [])

  useEffect(() => { void read() }, [read])

  useEffect(() => {
    if (!saying) return
    let live = true
    setRecord(null)
    api.getBook(saying.id)
      .then((answer) => { if (live) setRecord(answer.book) })
      .catch(() => { /* Deliberately ignored: the catalogue record is an addition to that screen, not the screen itself. */ })
    return () => { live = false }
  }, [saying])

  /** The book is remembered before the read, since the read is what takes it off the list. */
  const leaveSaying = () => {
    const book = saying
    const labels = tagging.tags.map((tag) => tag.label)
    setSaying(null)
    setNaming(false)
    if (!book) return

    void read().then((answer) => {
      if (!answer) return
      const still = answer.books.find((one) => one.id === book.id)
      setSettled({
        title: book.title,
        claimed: still === undefined,
        tags: still ? still.tags : labels,
      })
    })
  }

  if (saying) {
    return (
      <SayingPane
        book={saying}
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
    <UnclaimedPane
      books={found?.books ?? null}
      total={found?.total ?? 0}
      error={error}
      settled={settled}
      tabs={tabs}
      onBack={() => setRoute('home')}
      onSay={(book) => { setSettled(null); setSaying(book) }}
      onClaimed={openClaim}
      onFurniture={() => openRoom('furniture')}
    />
  )
}
