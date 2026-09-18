/**
 * What a person has said one book is, and the vocabulary they said it in.
 *
 * One hook, shared by both screens that let somebody tag a book by hand,
 * so the two cannot drift into two ideas of what counts as busy or two
 * reads of the vocabulary.
 *
 * Written the moment it is said, rather than carried in a draft: one
 * person photographs, another works out what the book is, a third
 * shelves it, and a tag held in React until some later step is a tag lost
 * by a browser being closed.
 *
 * It reaches a queued capture as readily as a shelved book, since a
 * capture is a row in `books` from its first photograph.
 *
 * Which slug a typed word means, and whether the collection already
 * keeps something meaning the same, are decided in
 * `domain/tagging/naming.ts`. This only asks, writes and holds the answer.
 *
 * Nothing here writes a tag by itself: every call comes from somebody
 * pressing something, so a helpful default here would state a genre
 * nobody had stated.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type AppliedTag, type TagRow } from '../lib/api'

export interface Tagging {
  /**
   * What a person has said, which is what a screen draws as pills to tap
   * off. Only theirs: a book out of Open Library can carry up to twelve
   * subject headings, and drawing all of them is not a fast path.
   */
  readonly tags: AppliedTag[]
  /**
   * Every slug this book is under, whoever said it. Not the same list as
   * `tags`: the naming panel uses it to avoid offering a tag the book
   * already carries, including one only a catalogue supplied.
   */
  readonly carried: string[]
  /** Every tag the collection keeps, with its counts. Read once, not per book. */
  readonly vocabulary: TagRow[]
  readonly busy: boolean
  readonly error: string
  /**
   * Put this book under that tag. Resolves once the write has, which one
   * screen waits for (to re-ask a list this write changes) and the other
   * ignores. Never rejects; a refusal is `error`.
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

  /* Both at once when the book changes, and both dropped when it does.
     `live` stops an answer for the last book landing on this one, which on
     a queue somebody is working through can be a second apart. */
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
