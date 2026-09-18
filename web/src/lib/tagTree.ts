/**
 * The slug (`genre/fantasy`) is the identity and carries the hierarchy; the label
 * is what a person reads. A screen never shows the slug.
 */

import type { TagRow } from './api'

/** A screen naming a tag the collection has not got yet holds one of these rather than a full row: no count or note exists until the tag does. */
export interface Named {
  slug: string
  label: string
}

/** Words out of a slug segment, for a name nobody has written down. */
function wordsOf(segment: string): string {
  const words = segment.replace(/-/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : segment
}

/** The label, or where a tag was created without one, the last part of its slug turned back into words. */
export function labelOf(tag: Named): string {
  return tag.label || wordsOf(tag.slug.split('/').pop() ?? tag.slug)
}

/** How deep a tag sits: 0 for a namespace, 1 for a tag in it, 2 for one under that. */
export function depthOf(tag: Named): number {
  return tag.slug.split('/').length - 1
}

/**
 * The tags this one sits under, as labels: "Genre", or "Subject, History".
 *
 * An ancestor with no row of its own is still named, since a book can carry
 * `genre/fantasy` in a vocabulary with no `genre` row.
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
 * Ordered by slug, which is how the server answers, so a tag and the tags under it stay together.
 * A group is named after its own tag row where there is one, or its identity turned into words
 * where there is not, since a namespace does not have to exist for tags to be under it.
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
