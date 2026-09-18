import { describe, expect, it } from 'vitest'
import { FICTION, FICTION_SLUG, NON_FICTION, NON_FICTION_SLUG } from './catalogue-claims'
import { genreOfRange, genreStatedBy, rangeOfGenre, rangeOfSlug, statedGenre } from './genre'
import { TagSlug, type AppliedTag, type TagSource } from './tags'

const tagged = (slug: string, source: TagSource = 'guess'): AppliedTag =>
  ({ slug: TagSlug.of(slug), source, confidence: 'high' })

describe('the range a book files into', () => {
  it('follows the genre tag it carries', () => {
    expect(rangeOfGenre([tagged('genre/fiction')])).toBe('fiction')
    expect(rangeOfGenre([tagged('genre/non-fiction')])).toBe('nonfiction')
  })

  it('answers null for a book no genre tag claims, rather than picking one', () => {
    // Answering 'nonfiction' because it is the other one would put a book on a shelf nobody chose.
    expect(rangeOfGenre([])).toBeNull()
    expect(rangeOfGenre([tagged('subject/fiction/fantasy'), tagged('mine/lent-out')])).toBeNull()
  })

  it('ignores a genre that is not one of the two ranges', () => {
    // genre/fantasy is a real tag, but says nothing about which of the two runs a book joins.
    expect(rangeOfGenre([tagged('genre/fantasy')])).toBeNull()
    expect(rangeOfGenre([tagged('genre/fantasy'), tagged('genre/non-fiction')]))
      .toBe('nonfiction')
  })

  it('files a book carrying both as fiction, which is what rule 1 does', () => {
    // Fiction wins the tie: rule 1 (priority) is tried before rule 2.
    expect(rangeOfGenre([tagged('genre/non-fiction'), tagged('genre/fiction')])).toBe('fiction')
  })

  it('lets a person outrank a machine, whichever way round they disagree', () => {
    // Settled by who said it, not tag order: a catalogue refresh must never override a person's tag.
    expect(rangeOfGenre([
      tagged('genre/fiction', 'person'),
      tagged('genre/non-fiction', 'catalogue'),
    ])).toBe('fiction')

    expect(rangeOfGenre([
      tagged('genre/non-fiction', 'person'),
      tagged('genre/fiction', 'catalogue'),
    ])).toBe('nonfiction')
  })
})

describe('the genre a save states', () => {
  it('answers the tag and the range together, and they agree', () => {
    const fiction = genreStatedBy({ genre: FICTION_SLUG })
    expect(fiction.tag!.slug.value).toBe(FICTION.value)
    expect(fiction.range).toBe('fiction')

    const other = genreStatedBy({ genre: NON_FICTION_SLUG })
    expect(other.tag!.slug.value).toBe(NON_FICTION.value)
    expect(other.range).toBe('nonfiction')
  })

  it('reads a saved edit as a person and everything else as a guess', () => {
    // 'manual' is what Store.updateBook records when somebody saved an edit.
    expect(genreStatedBy({ genre: FICTION_SLUG, classificationSource: 'manual' }).tag!.source)
      .toBe('person')
    expect(genreStatedBy({ genre: FICTION_SLUG, classificationSource: 'auto' }).tag!.source)
      .toBe('guess')
    expect(genreStatedBy({ genre: FICTION_SLUG }).tag!.source).toBe('guess')
  })

  it('does not grade a person on the classifier scale', () => {
    expect(genreStatedBy({
      genre: FICTION_SLUG, classificationSource: 'manual', classificationConfidence: 'weak',
    }).tag!.confidence).toBe('high')

    expect(genreStatedBy({
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'weak',
    }).tag!.confidence).toBe('weak')

    expect(genreStatedBy({
      genre: FICTION_SLUG, classificationSource: 'auto', classificationConfidence: 'nonsense',
    }).tag!.confidence).toBe('unknown')
  })

  it('files what it states, so the tag and the shelf cannot disagree', () => {
    // Answered from one table so a caller cannot write a shelf_range no tag agrees with.
    for (const genre of [FICTION_SLUG, NON_FICTION_SLUG]) {
      const { tag, range } = genreStatedBy({ genre })
      expect(rangeOfGenre([tag!])).toBe(range)
    }
  })

  it('states nothing when nothing states a genre, rather than non-fiction', () => {
    // No tag and no range to write it into: they are null together, since a range no tag agrees with is the drift this exists to prevent.
    expect(genreStatedBy({ genre: null })).toEqual({ tag: null, range: null })
    expect(genreStatedBy({ genre: null, classificationSource: 'manual' }))
      .toEqual({ tag: null, range: null })
  })

  it('reads a request as the slug it names, and as nothing otherwise', () => {
    // The old default filed every unclassified book into non-fiction; this has no default.
    expect(statedGenre(FICTION_SLUG)).toBe(FICTION_SLUG)
    expect(statedGenre(NON_FICTION_SLUG)).toBe(NON_FICTION_SLUG)

    for (const raw of [undefined, null, '', 'genre/fantasy', 'fiction', true, 0]) {
      expect(statedGenre(raw), `${String(raw)} states no genre`).toBeNull()
    }
  })

  it('reads a book in neither run as carrying neither tag', () => {
    // Reading '' back as non-fiction would put a tag in the review pane nothing had stated.
    expect(genreOfRange('fiction')).toBe(FICTION_SLUG)
    expect(genreOfRange('nonfiction')).toBe(NON_FICTION_SLUG)
    expect(genreOfRange('')).toBeNull()

    expect(rangeOfSlug(FICTION_SLUG)).toBe('fiction')
    expect(rangeOfSlug(null)).toBeNull()
  })
})
