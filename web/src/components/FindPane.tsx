/** The field does not take focus on arrival: a keyboard that opens by itself would cover two thirds of the phone with the part of the screen doing the work. */

import { useEffect, useState } from 'react'
import { Button, IN_HAND } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Nothing } from '../design/Card'
import { SearchField, Suggestion, Suggestions } from '../design/Finding'
import { IconInHand } from '../design/Icons'
import { TopBar } from '../design/Chrome'
import { clothFor, coverArt, filedAs } from '../lib/bookLook'
import { grouped } from '../lib/say'
import { readQuery, saysWhat } from '../lib/findQuery'
import { useBrowsing } from '../app/browsing'
import { useListing } from '../app/listing'
import { useNavigation } from '../app/navigation'
import { useOpenBook } from '../app/openBook'
import { Frame } from './Frame'
import { More } from './More'
import { labelOf, underOf } from '../lib/tagTree'
import { api, type FiledBookRow, type TagRow } from '../lib/api'

/**
 * How long the field waits before it becomes a request.
 *
 * Long enough that a word typed at speed is one search rather than eight, short
 * enough that it is not a pause somebody notices between finishing a word and
 * seeing the books.
 */
const SETTLE = 250

export function FindPane() {
  const { openScanner, setRoute } = useNavigation()
  const { typed, setTyped, setNarrowing } = useBrowsing()
  const { viewBook } = useOpenBook()

  const [asked, setAsked] = useState(typed)
  const [tags, setTags] = useState<TagRow[]>([])
  const [rest, setRest] = useState<{ name: string; books: FiledBookRow[] } | null>(null)

  useEffect(() => {
    const waiting = setTimeout(() => setAsked(typed), SETTLE)
    return () => clearTimeout(waiting)
  }, [typed])

  /* The vocabulary, once, so a `#` can be answered without a request per key. */
  useEffect(() => {
    let live = true
    api.tags()
      .then((answer) => { if (live) setTags(answer.tags) })
      .catch(() => { if (live) setTags([]) })
    return () => { live = false }
  }, [])

  const found = readQuery(asked)

  const listing = useListing({
    range: 'all',
    q: found.kind === 'words' ? found.words : undefined,
    isbn: found.kind === 'isbn' ? found.isbn : undefined,
  })

  const { books, total, counts, complete, loading } = listing
  const everything = counts?.total ?? 0

  // A single cover in a three-across gallery leaves two empty columns, which
  // looks broken; `rest` fills that with more by the same author.
  const one = found.kind === 'isbn' && books.length === 1 ? books[0] : undefined

  useEffect(() => {
    let live = true
    if (!one) { setRest(null); return undefined }

    const name = filedAs(one)
    if (!name) { setRest(null); return undefined }

    api.findBooks({ range: 'all', q: name, limit: 7 })
      .then((answer) => {
        if (!live) return
        setRest({ name, books: answer.books.filter((book) => book.id !== one.id).slice(0, 6) })
      })
      .catch(() => { if (live) setRest(null) })

    return () => { live = false }
  }, [one?.id])

  /** The tags that match what has been typed after the `#`, by their labels. */
  const matching = found.kind === 'tag'
    ? tags.filter((tag) => labelOf(tag).toLowerCase().includes(found.part.toLowerCase()))
    : []

  const sub = () => {
    if (found.kind === 'nothing') return `${grouped(everything)} books`
    if (found.kind === 'tag') {
      return matching.length === 1 ? 'One tag matches' : `${grouped(matching.length)} tags match`
    }
    if (!loading && total === 0) return 'Nothing matches'
    return `${grouped(total)} of ${grouped(everything)} books`
  }

  const items: CoverItem[] = books.map(asCover)

  const open = (item: CoverItem) => viewBook(Number(item.id))

  const nothingFound = found.kind !== 'tag' && !loading && total === 0

  return (
    <Frame
      tab="library"
      top={
        <TopBar
          title="Find a book"
          sub={sub()}
          onBack={() => setRoute('library')}
          // The accessible name comes from IN_HAND and names the book this
          // camera finds, not the camera itself. IconInHand, not a camera
          // glyph: the camera icon belongs to the other camera, under Scan in
          // the tab bar.
          action={{ word: IN_HAND, icon: <IconInHand />, onPress: openScanner }}
        />
      }
    >
      <SearchField typed={typed} onType={setTyped} reads={saysWhat(found)} />

      {found.kind === 'tag' && (
        <>
          <Suggestions label={`Tags matching ${found.part}`}>
            {matching.slice(0, 8).map((tag) => (
              <Suggestion
                key={tag.slug}
                name={labelOf(tag)}
                where={underOf(tag, tags)}
                books={tag.books}
                onPress={() => {
                  setNarrowing([{ slug: tag.slug, label: labelOf(tag) }])
                  setTyped('')
                  setRoute('library')
                }}
              />
            ))}
          </Suggestions>

          {matching.length === 0 && (
            <Nothing said="No tag of yours reads like that." />
          )}

          <Button tone="quiet" block onPress={() => setRoute('tags')}>
            See all {grouped(tags.length)} of your tags
          </Button>
        </>
      )}

      {nothingFound ? (
        <>
          <Nothing said="No book here answers to that.">
            <p>Not a title, not an author, not an ISBN.</p>
          </Nothing>

          <Button tone="secondary" block onPress={() => setRoute('tags')}>
            Look through your tags instead
          </Button>
          <Button tone="quiet" block onPress={() => setRoute('capture')}>
            Photograph it, if it is in your hand
          </Button>
        </>
      ) : (
        // Shows every book while a tag is still being typed, since nothing
        // has been chosen yet: somebody who cannot see the books would
        // otherwise have no way to tell they are not moving.
        <Covers items={items} label={labelFor(found.kind, asked)} onPress={open} />
      )}

      {rest && rest.books.length > 0 && (
        <>
          <p className="wf-heading wf-heading--flush">More by {rest.name}</p>
          <Covers
            items={rest.books.map(asCover)}
            label={`More by ${rest.name}`}
            onPress={open}
          />
        </>
      )}

      {!complete && total > 0 && (
        <More total={total} loading={loading} onMore={listing.more} />
      )}
    </Frame>
  )
}

/** One book, as a cover in the gallery. */
function asCover(book: FiledBookRow): CoverItem {
  return {
    id: book.id,
    title: book.title,
    author: filedAs(book),
    cloth: clothFor(book.id),
    photo: coverArt(book, 320),
    place: book.location || undefined,
    meta: book.checked_out_at ? 'Checked out' : undefined,
  }
}

/** What the wall of covers is, for anybody who cannot see it. */
function labelFor(kind: string, asked: string): string {
  if (kind === 'words') return `Books matching ${asked}`
  if (kind === 'isbn') return 'The book with that ISBN'
  return 'Every book'
}
