/**
 * The books no rule claims, and somebody saying what one of them is.
 *
 * **Two panes and one route**, which is what `ReviewScreen` already does with a
 * capture and a catalogued book. The two are one journey rather than two doors
 * to one room: you arrive at the list, settle a book, and come back to the list
 * you left. A route of its own would have meant carrying which book it is about
 * in `navigation`, which is where the things two unrelated screen groups share
 * live, and nothing but this list opens it.
 *
 * ## The list is asked for again every time somebody comes back
 *
 * Saying what a book is changes the answer to the question this screen is. A
 * book that was carrying nothing may now be claimed and gone, or may now carry
 * a word no rule asks for and have moved from the first block to the second.
 * Both are worth seeing, and neither can be worked out here: which rule takes
 * which book is `claim` on the server, and there is one opinion about it on
 * purpose.
 *
 * So the re-read is what turns walking back into an answer, and the answer is
 * said in a line. Without it, settling the book at the top of a dozen looks the
 * same whether a rule took it or nothing did.
 *
 * **Nothing here writes a tag by itself** (#304). Every write is
 * `useTagging.add` or `.remove`, and every call to either is a person pressing a
 * word.
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

  /*
   * What the catalogue holds about the one book being settled.
   *
   * Asked for here rather than carried on the list: the list answers what makes
   * a row, and the publisher, the year and the length are what somebody decides
   * a genre on. One book at a time, so a list of five hundred costs nothing.
   */
  useEffect(() => {
    if (!saying) return
    let live = true
    setRecord(null)
    api.getBook(saying.id)
      .then((answer) => { if (live) setRecord(answer.book) })
      .catch(() => { /* The facts are an addition to that screen, not the screen. */ })
    return () => { live = false }
  }, [saying])

  /**
   * Back to the list, with what the book now says written into it.
   *
   * The book is remembered before the read, because the read is what takes it
   * off the list, and gone from the list is exactly what "a rule has it now"
   * means. `tagging.carried` is the book's own answer rather than a guess made
   * from what was pressed, so several words said in a row read correctly.
   */
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
      /* The last answer goes when a new question is asked. A line about the
         previous book, on the way into this one, is somebody reading the wrong
         title while deciding. */
      onSay={(book) => { setSettled(null); setSaying(book) }}
      onClaimed={openClaim}
      onFurniture={() => openRoom('furniture')}
    />
  )
}
