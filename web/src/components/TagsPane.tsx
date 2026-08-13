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
 */

import { useEffect, useState } from 'react'
import { Button } from '../design/Controls'
import { Nothing } from '../design/Card'
import { SearchField, TagGroup, TagPick } from '../design/Finding'
import { TopBar } from '../design/Chrome'
import { api, type TagRow } from '../lib/api'
import { depthOf, groupsOf, labelOf, saysCount } from '../lib/tagTree'
import { useBrowsing } from '../app/browsing'
import { useNavigation } from '../app/navigation'
import { Frame } from './Frame'

export function TagsPane() {
  const { setRoute } = useNavigation()
  const { narrowing, setNarrowing } = useBrowsing()

  const [tags, setTags] = useState<TagRow[]>([])
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    api.tags()
      .then((answer) => { if (live) setTags(answer.tags) })
      .catch((caught) => { if (live) setError((caught as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

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
          <p>A tag arrives when a catalogue says what a book is, or when you do.</p>
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
