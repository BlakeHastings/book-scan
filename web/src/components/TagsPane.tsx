/**
 * The slug is never drawn: `lib/tagTree.ts` turns a tag with no label of its
 * own into words rather than its own key, and a pinned test refuses a screen
 * that renders something shaped like a slug. Every count includes books
 * filed under a tag as well as books carrying it directly, so choosing a tag
 * shows the same set the count claims.
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
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { Frame } from './Frame'
import { TagNaming, type NamingWords } from './TagNaming'

/** The two the app asks about every book, which are nobody's to make or sweep. */
const GENRE_ANSWERS: string[] = [FICTION_SLUG, NON_FICTION_SLUG]

/** "Whatever you say here, a rule can ask for" must stay word-for-word the same as the book door's prompt: it is true on both. */
const ABOUT_A_WORD: NamingWords = {
  title: 'Make a tag',
  asks: 'What are the books about?',
  prompt: 'Type a word for what a book is about. Whatever you say here, a rule can ask for.',
  wrong: 'That tag could not be made.',
  doing: 'Making it...',
  genreReads: 'That is one the app asks about a book.',
  genreSaid: 'Fiction and non-fiction are the two this app asks about every book, '
    + 'and it already keeps both. They are answered on a book rather than made '
    + 'here.',
  alreadySaid: 'That is the same word to this app as the one you already keep, so '
    + 'there is one tag rather than two. You have it; type something else.',
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

  // Re-reads after a write rather than patching in place: the write's response
  // carries neither the rolled-up count nor whether a rule asks for the tag.
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

  /** `POST /api/tags` is idempotent on the slug; equality decisions belong to `nameTag` alone, not here. */
  const make = async (tag: { slug: string; label: string }) => {
    setBusy(true)
    setNamingError('')
    await api.defineTag(tag)
      .then(() => { setNaming(false); setOpen('') })
      .then(read)
      .catch((caught) => setNamingError((caught as Error).message))
      .finally(() => setBusy(false))
  }

  /** Both server refusals stay reachable even though the row already filtered them out: the list can be a moment stale, so a rule added elsewhere in between must still block the sweep. */
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

  const pick = (tag: TagRow) => {
    setNarrowing(chosen.has(tag.slug)
      ? narrowing.filter((one) => one.slug !== tag.slug)
      : [...narrowing, { slug: tag.slug, label: labelOf(tag) }])
  }

  // Deliberate: while searching, every group opens regardless of key, so a
  // match is never hidden behind a closed group.
  const isOpen = (key: string) => Boolean(looking) || key === open

  // Computed from `matching` rather than `tags`, so a search does not surface
  // empty tags outside the current results. Excludes the two genre answers,
  // which nothing can ever sweep.
  const empty = matching.filter(
    (tag) => tag.books === 0 && !GENRE_ANSWERS.includes(tag.slug),
  )
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
              // `under` is a boolean, so depth beyond two levels still gets one
              // indent: two levels is as deep as this goes.
              under={depthOf(tag) > 1}
              on={chosen.has(tag.slug)}
              onPress={() => pick(tag)}
            />
          ))}
        </TagGroup>
      ))}

      {/* Deliberately "Make a tag" rather than "Add a tag", which opens the same panel elsewhere: adding files a book under a word, this makes a word with no book under it. */}
      {!loading && !error && (
        <AddTag onPress={() => { setNamingError(''); setNaming(true) }}>Make a tag</AddTag>
      )}

      {!loading && !error && empty.length > 0 && (
        <Card
          title="Words with no books on them"
          kind={saysCount(empty.length, 'word')}
        >
          {kept.length > 0 && (
            <Said>
              {kept.length === 1
                ? `A rule asks for ${labelOf(kept[0]!)}, so it stays: `
                : `Rules ask for ${kept.map((tag) => labelOf(tag)).join(', ')}, so they stay: `}
              a bookcase can be set up for a subject before a book arrives for it.
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
