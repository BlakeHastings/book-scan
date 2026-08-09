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
    // The whole of "no absence means anything". An area carrying `inherit` and
    // an area carrying `title` are both statements, and they are told apart by
    // comparing values, not by asking whether one is missing.
    expect(strategyFor('author', 'tag', INHERIT)).toBe('tag')
    expect(strategyFor('author', 'tag', 'title')).toBe('title')
  })
})

describe('ordering a run', () => {
  it('orders by author exactly as books.sort_key does, series and all', () => {
    // The strategy the whole catalogue is on. Its key is the stored column, so
    // this is the existing shelf order rather than a second opinion about it.
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
    /*
     * The settled decision, checked by the shape of the function rather than by
     * an assertion about a value: `orderBy` takes a strategy and a list, and
     * there is nowhere to pass a collection default. Changing a global setting
     * therefore cannot reorder a run that chose `tag`, because nothing in this
     * call can see the global setting.
     *
     * What is asserted here is the consequence: two orderings that differ only
     * in what the collection is set to are the same list.
     */
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
    // `Zebra` before `apple` is what byte order says and what `COLLATE "C"` on
    // the columns says. A locale-aware comparison would file them the other way
    // round, silently, and a shelf would be in an order the database is not in.
    expect(orderBy('title', [
      book(1, { titleFiling: 'apple' }),
      book(2, { titleFiling: 'Zebra' }),
    ]).map((one) => one.id)).toEqual([2, 1])
  })
})
