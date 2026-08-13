import { describe, expect, it } from 'vitest'
import { depthOf, groupsOf, labelOf, saysCount, underOf } from './tagTree'
import type { TagRow } from './api'

const tag = (slug: string, label = '', books = 0): TagRow => ({ slug, label, note: '', books })

describe('what a person reads for a tag', () => {
  it('is the label somebody gave it', () => {
    expect(labelOf(tag('genre/fantasy', 'Fantasy'))).toBe('Fantasy')
  })

  /*
   * The pinned rule, arriving where it actually bites: a tag written without a
   * label must not fall back to the string that is its identity.
   */
  it('is words, never the identity, for a tag nobody labelled', () => {
    expect(labelOf(tag('mine/lent-out'))).toBe('Lent out')
    expect(labelOf(tag('mine/lent-out'))).not.toContain('/')
  })
})

describe('where a tag sits, said in words', () => {
  const all = [tag('genre', 'Genre'), tag('genre/fantasy', 'Fantasy'), tag('subject/history', 'History')]

  it('says nothing about a tag that sits at the top', () => {
    expect(underOf(tag('genre', 'Genre'), all)).toBeUndefined()
  })

  it('names the tag it sits under', () => {
    expect(underOf(tag('genre/fantasy', 'Fantasy'), all)).toBe('Genre')
  })

  it('names both of them, two deep', () => {
    expect(underOf(tag('genre/fantasy/urban', 'Urban fantasy'), all)).toBe('Genre, Fantasy')
  })

  /*
   * A book can carry `genre/fantasy` in a vocabulary with no `genre` row, so
   * the nesting has to be sayable without one.
   */
  it('names an ancestor that has no row of its own', () => {
    expect(underOf(tag('where-it-came-from/gift', 'A gift'), [])).toBe('Where it came from')
  })

  it('never says a stroke', () => {
    expect(underOf(tag('genre/fantasy/urban', 'Urban fantasy'), all)).not.toContain('/')
  })
})

describe('cutting the vocabulary into groups', () => {
  const all = [
    tag('genre/fantasy', 'Fantasy', 112),
    tag('genre', 'Genre', 1204),
    tag('mine/lent-out', 'Lent out', 2),
    tag('genre/fantasy/urban', 'Urban fantasy', 14),
  ]

  it('puts everything under one name together, in order', () => {
    const groups = groupsOf(all)

    expect(groups.map((group) => group.name)).toEqual(['Genre', 'Mine'])
    expect(groups[0]!.tags.map((one) => one.slug))
      .toEqual(['genre', 'genre/fantasy', 'genre/fantasy/urban'])
  })

  it('names a group nobody has written a row for', () => {
    expect(groupsOf([tag('how-it-is-bound/hardback', 'Hardback')])[0]!.name).toBe('How it is bound')
  })

  it('says how deep each one is, which is the indent', () => {
    expect(depthOf(tag('genre'))).toBe(0)
    expect(depthOf(tag('genre/fantasy'))).toBe(1)
    expect(depthOf(tag('genre/fantasy/urban'))).toBe(2)
  })
})

describe('counting, in the words the row above uses', () => {
  it('does not say "1 tags"', () => {
    expect(saysCount(1, 'tag')).toBe('1 tag')
    expect(saysCount(8, 'tag')).toBe('8 tags')
  })
})
