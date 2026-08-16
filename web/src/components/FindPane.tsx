/**
 * Finding a book, which is one field and no mode switch.
 *
 * ## The screen before you type is most of it
 *
 * An empty box is not a waiting state here. It is the collection, drawn as
 * covers, three across, because a cover is the fastest thing to recognise when
 * you already half know what you are after and because scrolling to a book you
 * can see is a way of finding one. Nothing about this screen is greyed out until
 * somebody types, and the field does not take the focus on arrival: a keyboard
 * that opens by itself covers two thirds of the phone with the part of the
 * screen that is doing the work.
 *
 * ## The field works out what you meant
 *
 * > We look and see whether they're putting in an ISBN. We look and see whether
 * > they're putting in the title or the author, and we fuzzy search by title and
 * > author. And we also look for tags. If the user wants to, they can put in
 * > like a pound sign and a tag, and we only show the books in that tag.
 *
 * Four readings, one box, decided by what was typed, in `lib/findQuery.ts` where
 * a test can reach it. The screen says which it chose in one quiet line under
 * the field, and only when that is not obvious from what was typed: a person who
 * types thirteen digits and gets a fuzzy title match has been failed silently,
 * and four radio buttons above the field is the alternative nobody would press.
 *
 * ## Nothing is asked for until it is worth asking
 *
 * What is typed is held for a moment before it becomes a request, because
 * somebody typing "mieville" would otherwise be eight searches. The listing
 * underneath keeps what it has while the next answer is in flight, so the screen
 * does not blink between keystrokes.
 *
 * ## The fifth reading is the book itself, and it is in the corner
 *
 * This app has two cameras. One photographs a book nobody has catalogued yet;
 * the other reads the barcode off a book that is already in the collection and
 * opens it, which is the same question this screen's field asks and the
 * fastest possible way to ask it: no typing, and no chance of typing thirteen
 * digits wrong.
 *
 * It lived in the first screen's top right and #350 gave that corner to the
 * profile icon, so it came here rather than being lost. This is where it
 * belongs anyway, by the same argument that took find off the tab bar: looking
 * for a book is something you do to what you are looking at, and this is the
 * screen for looking for a book. One press from the row above the library's
 * books, which is where finding now lives.
 */

import { useEffect, useState } from 'react'
import { Button } from '../design/Controls'
import { Covers, type CoverItem } from '../design/Covers'
import { Nothing } from '../design/Card'
import { SearchField, Suggestion, Suggestions } from '../design/Finding'
import { IconCamera } from '../design/Icons'
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

  /*
   * One book in a gallery three across is one cover and two empty columns, which
   * looks like the screen has failed rather than answered. What fills it is the
   * question somebody asks straight afterwards: the rest of that author.
   */
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
          /* A glyph in a corner carries its word as its accessible name, which
             is the pinned rule, and this one names the book rather than the
             camera: what it does is find the one you are holding. */
          action={{
            word: 'Find the book in your hand',
            icon: <IconCamera />,
            onPress: openScanner,
          }}
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
        /* Still every book while a tag is being typed, because nothing has been
           chosen yet: "it filters as you type" is a claim about what is
           underneath, and somebody who cannot see the books cannot see them not
           moving. */
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
        <More shown={books.length} total={total} loading={loading} onMore={listing.more} />
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
