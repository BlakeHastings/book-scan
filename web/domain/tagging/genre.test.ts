import { describe, expect, it } from 'vitest'
import { FICTION, NON_FICTION } from './catalogue-claims'
import { genreStatedBy, rangeOfGenre } from './genre'
import { TagSlug, type AppliedTag, type TagSource } from './tags'

const tagged = (slug: string, source: TagSource = 'guess'): AppliedTag =>
  ({ slug: TagSlug.of(slug), source, confidence: 'high' })

describe('the range a book files into', () => {
  it('follows the genre tag it carries', () => {
    expect(rangeOfGenre([tagged('genre/fiction')])).toBe('fiction')
    expect(rangeOfGenre([tagged('genre/non-fiction')])).toBe('nonfiction')
  })

  it('answers null for a book no genre tag claims, rather than picking one', () => {
    // The case `0013` refuses to migrate and `applySchema` counts on every
    // start. Answering 'nonfiction' because it is the other one would put a
    // book on a shelf nobody chose and report nothing.
    expect(rangeOfGenre([])).toBeNull()
    expect(rangeOfGenre([tagged('subject/fiction/fantasy'), tagged('mine/lent-out')])).toBeNull()
  })

  it('ignores a genre that is not one of the two ranges', () => {
    // `genre/fantasy` is a real tag somebody may apply and it says nothing
    // about which of the two runs the book joins.
    expect(rangeOfGenre([tagged('genre/fantasy')])).toBeNull()
    expect(rangeOfGenre([tagged('genre/fantasy'), tagged('genre/non-fiction')]))
      .toBe('nonfiction')
  })

  it('files a book carrying both as fiction, which is what rule 1 does', () => {
    // `0013` writes fiction as priority 1 and non-fiction as 2, and lower is
    // tried first, so the two models answer the same thing for a book #201
    // stopped happening. `0016` is what removes these.
    expect(rangeOfGenre([tagged('genre/non-fiction'), tagged('genre/fiction')])).toBe('fiction')
  })

  it('lets a person outrank a machine, whichever way round they disagree', () => {
    /*
     * The rule the tagging model exists for, read rather than written. A
     * catalogue refresh can put `genre/non-fiction` on a book a person filed as
     * fiction, because a lookup may not retract a person's row. Settling that
     * pair on tag order rather than on who said so would let the lookup move
     * the book, which is the loss the write rule prevents arriving from the
     * other side.
     */
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
    const fiction = genreStatedBy({ isFiction: true })
    expect(fiction.tag.slug.value).toBe(FICTION.value)
    expect(fiction.range).toBe('fiction')

    const other = genreStatedBy({ isFiction: false })
    expect(other.tag.slug.value).toBe(NON_FICTION.value)
    expect(other.range).toBe('nonfiction')
  })

  it('reads a saved edit as a person and everything else as a guess', () => {
    // The mapping `0002` made when it turned the column into rows: `manual` is
    // what `Store.updateBook` records when somebody saved an edit.
    expect(genreStatedBy({ isFiction: true, classificationSource: 'manual' }).tag.source)
      .toBe('person')
    expect(genreStatedBy({ isFiction: true, classificationSource: 'auto' }).tag.source)
      .toBe('guess')
    expect(genreStatedBy({ isFiction: true }).tag.source).toBe('guess')
  })

  it('does not grade a person on the classifier scale', () => {
    expect(genreStatedBy({
      isFiction: true, classificationSource: 'manual', classificationConfidence: 'weak',
    }).tag.confidence).toBe('high')

    expect(genreStatedBy({
      isFiction: true, classificationSource: 'auto', classificationConfidence: 'weak',
    }).tag.confidence).toBe('weak')

    expect(genreStatedBy({
      isFiction: true, classificationSource: 'auto', classificationConfidence: 'nonsense',
    }).tag.confidence).toBe('unknown')
  })

  it('files what it states, so the tag and the shelf cannot disagree', () => {
    // The whole point of answering both from one table: a caller holding the
    // range without the tag is a caller that can write a `shelf_range` no tag
    // agrees with, which is the drift this change ends.
    for (const isFiction of [true, false]) {
      const { tag, range } = genreStatedBy({ isFiction })
      expect(rangeOfGenre([tag])).toBe(range)
    }
  })
})
