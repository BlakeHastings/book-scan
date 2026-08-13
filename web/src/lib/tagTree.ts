/**
 * The tags somebody keeps, arranged the way a screen has to draw them.
 *
 * **A tag has two halves and a person only ever sees one of them.** The slug is
 * the identity, `genre/fantasy`, and the label is what anybody reads. That is a
 * pinned rule with a test behind it, and it is the whole reason this file
 * exists: the hierarchy lives in the slug, so every question a screen asks about
 * nesting has to be answered from a string nobody may be shown, and the answers
 * have to come back as words.
 *
 * Twenty-three flat chips do not fit on a phone and would be lying anyway, so
 * the tags are groups that open one at a time, and everything here is about
 * turning a flat vocabulary into that.
 */

import type { TagRow } from './api'

/** Words out of a slug segment, for a name nobody has written down. */
function wordsOf(segment: string): string {
  const words = segment.replace(/-/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : segment
}

/**
 * What a person reads for one tag.
 *
 * The label, and where a tag was created without one, the last part of its own
 * identity turned back into words. Never the identity itself: `genre/fantasy` on
 * a screen is the same mistake as showing somebody a row id.
 */
export function labelOf(tag: TagRow): string {
  return tag.label || wordsOf(tag.slug.split('/').pop() ?? tag.slug)
}

/** How deep a tag sits: 0 for a namespace, 1 for a tag in it, 2 for one under that. */
export function depthOf(tag: TagRow): number {
  return tag.slug.split('/').length - 1
}

/**
 * The tags this one sits under, as labels: "Genre", or "Subject, History".
 *
 * This is where the nesting goes when there is no tree to indent inside, and it
 * is said in words rather than drawn as a path with a stroke in it. An ancestor
 * that has no row of its own is still named, because a book can carry
 * `genre/fantasy` in a vocabulary with no `genre` row and the nesting is true
 * either way.
 */
export function underOf(tag: TagRow, all: readonly TagRow[]): string | undefined {
  const parts = tag.slug.split('/')
  if (parts.length < 2) return undefined

  const known = new Map(all.map((one) => [one.slug, one]))
  const names: string[] = []

  for (let end = 1; end < parts.length; end += 1) {
    const slug = parts.slice(0, end).join('/')
    const found = known.get(slug)
    names.push(found ? labelOf(found) : wordsOf(parts[end - 1]!))
  }

  return names.join(', ')
}

/** Everything under one name, which is what makes twenty-three of them fit. */
export interface TagGrouping {
  /** The namespace, which is the first part of every slug inside it. */
  key: string
  /** What it is called. Never the slug. */
  name: string
  tags: TagRow[]
}

/**
 * The vocabulary, cut into the groups a screen opens one at a time.
 *
 * Ordered by slug, which is how the server answers, so a tag and the tags under
 * it arrive together and stay together. A group is named after its own tag row
 * where there is one and after its identity turned into words where there is
 * not, because a namespace does not have to exist for tags to be under it.
 */
export function groupsOf(tags: readonly TagRow[]): TagGrouping[] {
  const groups = new Map<string, TagGrouping>()
  const known = new Map(tags.map((one) => [one.slug, one]))

  for (const tag of [...tags].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) {
    const key = tag.slug.split('/')[0]!
    let group = groups.get(key)

    if (!group) {
      const own = known.get(key)
      group = { key, name: own ? labelOf(own) : wordsOf(key), tags: [] }
      groups.set(key, group)
    }

    group.tags.push(tag)
  }

  return [...groups.values()]
}

/** How many tags a group holds, said the way the row above them says it. */
export function saysCount(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`
}
