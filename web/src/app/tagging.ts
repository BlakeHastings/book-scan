/**
 * What a person has said one book is, and the vocabulary they said it in.
 *
 * **One hook, two screens, and that is the whole reason it is here.** It was
 * written inside `screens/ReviewScreen.tsx` for the check-the-details screen
 * (#377), which is where somebody adds a tag by hand. #341 needs exactly that
 * act on a second screen, the books no rule claims, and a hook copied into that
 * screen would be two ways of saying what a book is: two reads of the
 * vocabulary, two idea of what counts as busy, and one of them left behind the
 * day the other learns something.
 *
 * So it moved to `src/app`, which is where the things screens genuinely share
 * live, and neither screen writes a tag any other way.
 *
 * ## Written the moment it is said, rather than carried in a draft
 *
 * The same decision the capture autosave already made and for the same reason
 * (#65): one person photographs, another works out what the book is, a third
 * shelves it, and the middle person's work has to survive them putting the
 * phone down. A tag held in React until some later step is a tag lost by a
 * browser being closed, and a person's tag is the one kind of tag nothing else
 * in this system is allowed to reproduce.
 *
 * It reaches a queued capture as readily as a shelved book, because since #183
 * a capture is a row in `books` from its first photograph.
 *
 * ## Nothing here decides anything
 *
 * Which slug a typed word means, and whether the collection already keeps
 * something meaning the same, are `domain/tagging/naming.ts`, where they are
 * testable without a browser. This asks, writes and holds the answer.
 *
 * **And nothing here writes a tag by itself.** Every call comes from somebody
 * pressing something. That is #304, which stopped this app stating a genre
 * nobody had stated, on the owner's explicit instruction, and a helpful default
 * anywhere in this file would be that instruction quietly reversed.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type AppliedTag, type TagRow } from '../lib/api'

export interface Tagging {
  /**
   * What a person has said, which is what a screen draws as pills to tap off.
   *
   * Only theirs. A book out of Open Library carries up to twelve subject
   * headings, and a wall of them on a screen somebody is trying to get a book
   * off is not what a fast path looks like.
   */
  readonly tags: AppliedTag[]
  /**
   * Every slug this book is under, whoever said it.
   *
   * Not the same list as `tags` and used for a different job: the naming panel
   * takes it to keep from offering a tag the book already carries, which would
   * be a target that changes nothing. A catalogue's subject counts for that even
   * though it is not drawn as a pill, and it counts most on the screen about
   * books carrying a tag no rule asks for, where the tag nobody has a rule for
   * is usually exactly the one a catalogue supplied.
   */
  readonly carried: string[]
  /** Every tag the collection keeps, with its counts. Read once, not per book. */
  readonly vocabulary: TagRow[]
  readonly busy: boolean
  readonly error: string
  /**
   * Put this book under that tag.
   *
   * It answers a promise that settles when the write has, which the
   * check-the-details screen ignores and the books-nothing-files screen waits
   * for: on that screen the list somebody is standing in front of is the answer
   * to a question this write changes, so it has to be asked again afterwards and
   * "afterwards" has to be a real moment rather than a guess at one. The promise
   * does not reject; a refusal is `error`, which is what both screens draw.
   */
  readonly add: (tag: { slug: string; label: string }) => Promise<void>
  readonly remove: (slug: string) => void
}

export function useTagging(bookId: number | null): Tagging {
  const [tags, setTags] = useState<AppliedTag[]>([])
  const [carried, setCarried] = useState<string[]>([])
  const [vocabulary, setVocabulary] = useState<TagRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /* Both at once when the book changes, and both dropped when it does. The
     `live` flag is what stops an answer for the last book landing on this one,
     which on a queue somebody is working through is a second apart. */
  useEffect(() => {
    setError('')
    if (bookId === null) {
      setTags([])
      setCarried([])
      return
    }

    let live = true
    setTags([])
    setCarried([])
    void api.bookTags(bookId)
      .then((answer) => {
        if (!live) return
        setTags(answer.tags.filter((tag) => tag.source === 'person'))
        setCarried(answer.tags.map((tag) => tag.slug))
      })
      .catch(() => { /* The tags are an addition to these screens, not the screen. */ })
    return () => { live = false }
  }, [bookId])

  /* The vocabulary is the collection's rather than the book's, so it is read
     once and not again per book. */
  useEffect(() => {
    let live = true
    void api.tags()
      .then((answer) => { if (live) setVocabulary(answer.tags) })
      .catch(() => { /* An empty vocabulary offers nothing and refuses nothing. */ })
    return () => { live = false }
  }, [])

  const said = (answer: { tags: AppliedTag[] }) => {
    setTags(answer.tags.filter((tag) => tag.source === 'person'))
    setCarried(answer.tags.map((tag) => tag.slug))
  }

  const add = useCallback(async (tag: { slug: string; label: string }) => {
    if (bookId === null) return
    setBusy(true)
    setError('')
    await api.applyTag(bookId, tag)
      .then(said)
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setBusy(false))
  }, [bookId])

  const remove = useCallback((slug: string) => {
    if (bookId === null) return
    setBusy(true)
    setError('')
    api.removeTag(bookId, slug)
      .then(said)
      .catch((caught) => setError((caught as Error).message))
      .finally(() => setBusy(false))
  }, [bookId])

  return { tags, carried, vocabulary, busy, error, add, remove }
}
