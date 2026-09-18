import { describe, expect, it } from 'vitest'
import { buildSortKey } from '../../shared/shelving'
import { INHERIT, orderBy, strategyFor, type Orderable } from './strategies'

const book = (id: number, over: Partial<Orderable> = {}): Orderable => ({
  id,
  sortKey: '',
  authorFiling: '',
  titleFiling: '',
  published: '',
  tagSlugs: [],
  ...over,
})

describe('which strategy a run is ordered by', () => {
  it('takes the nearest answer that is not inherit', () => {
    expect(strategyFor('author', 'title', 'published')).toBe('published')
    expect(strategyFor('author', 'title', INHERIT)).toBe('title')
    expect(strategyFor('author', INHERIT, INHERIT)).toBe('author')
  })

  it('reads inherit on an area as a value rather than as nothing said', () => {
    // An area carrying `inherit` and one carrying `title` are both statements, told apart by comparing values, not by checking for absence.
    expect(strategyFor('author', 'tag', INHERIT)).toBe('tag')
    expect(strategyFor('author', 'tag', 'title')).toBe('title')
  })
})

describe('ordering a run', () => {
  it('orders by author exactly as books.sort_key does, series and all', () => {
    // Its key is the stored column itself, not a second opinion about the existing shelf order.
    const dune = buildSortKey({
      authorFiling: 'Herbert, Frank', seriesName: 'Dune', seriesIndex: 1, title: 'Dune',
    })
    const messiah = buildSortKey({
      authorFiling: 'Herbert, Frank', seriesName: 'Dune', seriesIndex: 2, title: 'Dune Messiah',
    })
    const standalone = buildSortKey({
      authorFiling: 'Herbert, Frank', title: 'The Santaroga Barrier',
    })

    const ordered = orderBy('author', [
      book(3, { sortKey: standalone }),
      book(2, { sortKey: messiah }),
      book(1, { sortKey: dune }),
    ])
    expect(ordered.map((one) => one.id)).toEqual([1, 2, 3])
  })

  it('breaks a tag tie by author and then by title, and by nothing else', () => {
    const ordered = orderBy('tag', [
      book(1, { tagSlugs: ['genre/fantasy'], authorFiling: 'Le Guin, Ursula K', titleFiling: 'Tehanu' }),
      book(2, { tagSlugs: ['genre/fantasy'], authorFiling: 'Le Guin, Ursula K', titleFiling: 'Earthsea' }),
      book(3, { tagSlugs: ['genre/fantasy'], authorFiling: 'Banks, Iain', titleFiling: 'Wasp Factory' }),
      book(4, { tagSlugs: ['genre/crime'], authorFiling: 'Zzz', titleFiling: 'Aaa' }),
    ])
    expect(ordered.map((one) => one.id)).toEqual([4, 3, 2, 1])
  })

  it('cannot be told the collection default, which is how the tiebreak is fixed', () => {
    // `orderBy` takes only a strategy and a list, with nowhere to pass a collection default, so changing that default cannot reorder a run that chose `tag`.
    const books = [
      book(1, { tagSlugs: ['genre/crime'], titleFiling: 'Zzz', authorFiling: 'Zzz' }),
      book(2, { tagSlugs: ['genre/crime'], titleFiling: 'Aaa', authorFiling: 'Aaa' }),
    ]
    const underAuthorDefault = orderBy(strategyFor('author', INHERIT, 'tag'), books)
    const underTitleDefault = orderBy(strategyFor('title', INHERIT, 'tag'), books)
    expect(underAuthorDefault.map((one) => one.id)).toEqual([2, 1])
    expect(underTitleDefault.map((one) => one.id)).toEqual(underAuthorDefault.map((one) => one.id))
  })

  it('separates two books nothing else separates, so the answer is total', () => {
    const same = { titleFiling: 'Dune', authorFiling: 'Herbert, Frank' }
    expect(orderBy('title', [book(9, same), book(4, same)]).map((one) => one.id))
      .toEqual([4, 9])
  })

  it('compares byte by byte, not by a linguistic collation', () => {
    // Byte order matches `COLLATE "C"`; a locale-aware comparison would file these the other way round, silently.
    expect(orderBy('title', [
      book(1, { titleFiling: 'apple' }),
      book(2, { titleFiling: 'Zebra' }),
    ]).map((one) => one.id)).toEqual([2, 1])
  })
})
