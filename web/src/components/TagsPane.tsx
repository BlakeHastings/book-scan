/**
 * Every tag somebody keeps, and the way to narrow the library to one.
 *
 * ## Groups, because twenty-three flat chips do not fit and would be lying
 *
 * Fiction and non-fiction were a two-button control at the top of the library,
 * and the owner named what was wrong with that: they were "an opinionated
 * approach just due to what we were needing to do at the time", and they are now
 * two tags out of however many somebody keeps.
 *
 * The hierarchy is in the slug, Obsidian style, so the tags really are a tree
 * whether or not a screen draws one. Groups, shut, fit above the fold with room
 * to spare; one opens at a time. That is the whole answer to the count and it is
 * the same answer at forty.
 *
 * **The slug is never drawn.** It is the identity, the label is what anybody
 * reads, and the nesting is an indent and a line of words. A pinned test refuses
 * a screen that renders something shaped like a slug, and `lib/tagTree.ts` is
 * where a tag with no label of its own becomes words rather than its own key.
 *
 * ## Every count is the number choosing it produces
 *
 * The number beside a tag counts the books under it as well as the books
 * carrying it, because choosing Fantasy shows the book somebody tagged Urban
 * fantasy. A count that disagreed with the list one tap later would be the
 * screen contradicting itself.
 *
 * ## The third door, and why it is here rather than on a book (#452)
 *
 * Two doors onto naming a tag already existed and both of them start with a
 * book: #377 while cataloguing one, #433 on one already shelved. #400 let a
 * placement rule ask for a tag nothing carries yet, so the rules have accepted a
 * word that does not exist since then and there was no way to make one on
 * purpose. Somebody setting up a bookcase for a subject before they own anything
 * in it is doing exactly the thing the rules already support.
 *
 * So this screen makes one, with the same panel and the same rule behind it that
 * the other two use. Nothing about what a word means is decided here.
 *
 * ## A word with no books on it is drawn, and says which kind it is
 *
 * It has to be drawn, or the person who just made one has no evidence it worked.
 * The list already showed one — `/api/tags` has always counted from `tag` rather
 * than from `book_tag` — so the question this had to answer was the other one:
 * two empty tags look identical in the table and are not the same thing. A word
 * a rule asks for is somebody's setup and is kept; a word nothing asks for is
 * litter and can be swept. The row says which, and only the second offers to go.
 */

import { useEffect, useState } from 'react'
import { Button } from '../design/Controls'
import { Card, Nothing, Said } from '../design/Card'
import { AddTag } from '../design/List'
import { SearchField, TagGroup, TagPick } from '../design/Finding'
import { Sure } from '../design/Sure'
import { TopBar } from '../design/Chrome'
import { api, type TagRow } from '../lib/api'
import { depthOf, groupsOf, labelOf, saysCount } from '../lib/tagTree'
import { useBrowsing } from '../app/browsing'
import { useNavigation } from '../app/navigation'
import { Frame } from './Frame'
import { TagNaming, type NamingWords } from './TagNaming'

/**
 * The panel's two book-shaped sentences, said about a word instead.
 *
 * "Whatever you say here, a rule can ask for" is kept word for word from the
 * door on a book, because it is the reason this door exists at all and it is
 * true on both of them.
 */
const ABOUT_A_WORD: NamingWords = {
  prompt: 'Type a word for what a book is about. Whatever you say here, a rule can ask for.',
  wrong: 'That tag could not be made.',
}

export function TagsPane() {
  const { setRoute } = useNavigation()
  const { narrowing, setNarrowing } = useBrowsing()

  const [tags, setTags] = useState<TagRow[]>([])
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [naming, setNaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [namingError, setNamingError] = useState('')
  const [sweeping, setSweeping] = useState<TagRow | null>(null)

  /* Read again after a write rather than patched in place, because what comes
     back carries the two facts this screen draws that the write does not know:
     the rolled-up count, and whether a rule asks for it. */
  const read = () => api.tags()
    .then((answer) => { setTags(answer.tags); setError('') })
    .catch((caught) => setError((caught as Error).message))

  useEffect(() => {
    let live = true
    api.tags()
      .then((answer) => { if (live) setTags(answer.tags) })
      .catch((caught) => { if (live) setError((caught as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  /**
   * Make the word, then read the list back.
   *
   * The panel offers tags this collection already keeps as well as a new one, so
   * this is reached with a slug that already exists as readily as with one that
   * does not. That is not a case to special-case: `POST /api/tags` is idempotent
   * on the slug, an existing word answers the row already there, and the list
   * comes back with it in. Anything cleverer here would be a second opinion
   * about whether two words are one, which is `nameTag`'s and only `nameTag`'s.
   */
  const make = async (tag: { slug: string; label: string }) => {
    setBusy(true)
    setNamingError('')
    await api.defineTag(tag)
      .then(() => { setNaming(false); setOpen('') })
      .then(read)
      .catch((caught) => setNamingError((caught as Error).message))
      .finally(() => setBusy(false))
  }

  /**
   * Sweep a word away, once somebody has said so out loud.
   *
   * The server decides whether it may go and this draws what it says. Both
   * refusals are reachable from here even though the row that offered the sweep
   * said neither applied: the list is a moment old, and a rule written on
   * another screen in between is exactly the case where quietly taking the word
   * would be this undoing somebody's setup.
   */
  const sweep = async (tag: TagRow) => {
    setBusy(true)
    await api.forgetTag(tag.slug)
      .then(() => { setSweeping(null); setError('') })
      .then(read)
      .catch((caught) => { setSweeping(null); setError((caught as Error).message) })
      .finally(() => setBusy(false))
  }

  const looking = typed.trim().toLowerCase()
  const matching = looking
    ? tags.filter((tag) => labelOf(tag).toLowerCase().includes(looking))
    : tags

  const groups = groupsOf(matching)
  const chosen = new Set(narrowing.map((tag) => tag.slug))

  /**
   * Choosing a tag adds it and choosing it again takes it off.
   *
   * Two tags mean both of them, which is what the library's row says by wearing
   * them side by side, and it is what the listing does with two of them.
   */
  const pick = (tag: TagRow) => {
    setNarrowing(chosen.has(tag.slug)
      ? narrowing.filter((one) => one.slug !== tag.slug)
      : [...narrowing, { slug: tag.slug, label: labelOf(tag) }])
  }

  /* A group opens when it is searched into, so a match is never behind a shut
     door. Otherwise one opens at a time, which is what makes them fit. */
  const isOpen = (key: string) => Boolean(looking) || key === open

  /*
   * The words with nothing standing under them, in the order the issue asks
   * about them: the ones a rule keeps first, then the ones nothing keeps.
   *
   * Searched-into as well, so a screen full of matches does not sprout a section
   * about words that are not among them.
   */
  const empty = matching.filter((tag) => tag.books === 0)
  const kept = empty.filter((tag) => tag.ruled)
  const litter = empty.filter((tag) => !tag.ruled)

  return (
    <Frame
      tab="library"
      top={
        <TopBar
          title="Your tags"
          sub={`${saysCount(tags.length, 'tag')} in ${saysCount(groups.length, 'group')}`}
          onBack={() => setRoute('library')}
        />
      }
      over={naming ? (
        <TagNaming
          vocabulary={tags}
          /* Nothing is carried, because nothing is holding anything: the panel
             leaves out what a book is already under so it never draws a target
             that does nothing, and with no book there is nothing to leave out. */
          carried={[]}
          busy={busy}
          error={namingError}
          words={ABOUT_A_WORD}
          onPick={(tag) => { void make(tag) }}
          onClose={() => { setNaming(false); setNamingError('') }}
        />
      ) : sweeping ? (
        <Sure
          title={`Sweep away ${labelOf(sweeping)}?`}
          said={
            'No book is under it and no rule asks for it. The word goes; nothing '
            + 'else changes, and you can make it again.'
          }
          act={busy ? 'Sweeping...' : 'Sweep it away'}
          busy={busy}
          onAct={() => { void sweep(sweeping) }}
          onKeep={() => setSweeping(null)}
        />
      ) : undefined}
    >
      <SearchField
        typed={typed}
        onType={setTyped}
        placeholder="Search your tags"
        label="Search your tags"
      />

      {error && <Nothing said="Your tags could not be read.">{error}</Nothing>}

      {/* The sentence changed with the third door (#452). "A tag arrives when a
          catalogue says what a book is, or when you do" was true and was a
          description of something happening elsewhere; there is a way to make
          one from here now, and it is the button under this. */}
      {!error && !loading && tags.length === 0 && (
        <Nothing said="Nothing has been tagged yet.">
          <p>
            A tag arrives when a catalogue says what a book is, when you say so
            about a book in your hand, or when you make one here.
          </p>
        </Nothing>
      )}

      {!error && !loading && tags.length > 0 && groups.length === 0 && (
        <Nothing said="No tag of yours reads like that." />
      )}

      {groups.map((group) => (
        <TagGroup
          key={group.key}
          name={group.name}
          note={saysCount(group.tags.length, 'tag')}
          open={isOpen(group.key)}
          onPress={() => setOpen(isOpen(group.key) ? '' : group.key)}
        >
          {group.tags.map((tag) => (
            <TagPick
              key={tag.slug}
              name={labelOf(tag)}
              books={tag.books}
              /* One step in for a tag inside another tag. Two steps is as deep
                 as this goes, and the indent is the only thing saying so. */
              under={depthOf(tag) > 1}
              on={chosen.has(tag.slug)}
              onPress={() => pick(tag)}
            />
          ))}
        </TagGroup>
      ))}

      {/*
        "Make a tag", not "Add a tag", which is what the same panel is opened by
        on both the other doors. They are different acts and the library's own
        rule is that no two things in it share a name: adding one puts the book
        in your hand under a word, and this makes the word with nothing under it.
        Somebody who read "Add a tag" here would be looking for the book.

        It is under the groups rather than in the corner because the corner takes
        one action and this screen has not got one to give up, and because the
        end of the list is where the same control sits on both other doors.
      */}
      {!loading && !error && (
        <AddTag onPress={() => { setNamingError(''); setNaming(true) }}>Make a tag</AddTag>
      )}

      {/*
        The two kinds of empty word, which are the same row until something says
        otherwise (#452).

        Drawn here rather than on the rows above, because choosing a tag and
        unmaking one are different acts and the row is already the target of the
        first. A sweep inside it would be a second thing to press in the one
        place somebody presses without reading.
      */}
      {!loading && !error && empty.length > 0 && (
        <Card
          title="Words with no books on them"
          kind={saysCount(empty.length, 'word')}
        >
          {kept.length > 0 && (
            <Said>
              {kept.map((tag) => labelOf(tag)).join(', ')}
              {kept.length === 1 ? ' is asked for by a rule' : ' are asked for by rules'},
              so {kept.length === 1 ? 'it is' : 'they are'} kept: a bookcase can be
              set up for a subject before a book arrives for it.
            </Said>
          )}
          {litter.map((tag) => (
            <Button key={tag.slug} tone="quiet" block onPress={() => setSweeping(tag)}>
              Sweep away {labelOf(tag)}
            </Button>
          ))}
        </Card>
      )}

      {narrowing.length > 0 && (
        <Button tone="primary" block onPress={() => setRoute('library')}>
          Show the books
        </Button>
      )}
      <Button
        tone="quiet"
        block
        onPress={() => { setNarrowing([]); setRoute('library') }}
      >
        Show everything again
      </Button>
    </Frame>
  )
}
