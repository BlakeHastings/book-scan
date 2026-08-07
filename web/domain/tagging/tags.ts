/**
 * Tags: what a book is put under, who said so, and the one rule that keeps a
 * machine from overwriting a person.
 *
 * ## The slug is the identity
 *
 * A tag has a slug and a label, and they are not two spellings of one thing.
 * The label is what a person reads, and it can be anything: "Non-fiction",
 * "Non fiction", "NONFICTION". The slug is what everything else references, and
 * it is normalised, so all three of those are `genre/non-fiction` and a rule
 * written against that slug matches all three. Without the normalisation a rule
 * quietly claims a fraction of the books it should, and a book files itself into
 * the wrong bookcase with nothing anywhere reporting an error.
 *
 * **A slug is never rewritten.** Renaming a tag changes its label and nothing
 * else. Placement rules reference slugs, and rewriting one would make every rule
 * mentioning it stop matching, which moves books and shows nobody why. This is
 * the owner's decision, recorded in docs/data-model.md: the slug is never shown
 * to a person, so there is nothing about it worth renaming. There is deliberately
 * no method on `TagSlug` that produces a different slug from an existing one.
 *
 * ## Hierarchy lives in the slug
 *
 * Obsidian style: `genre/fantasy`, `mine/lent-out`. There is no parent column
 * and no tree, so there is nothing to keep consistent and no way for a stored
 * parent to disagree with a path. "Everything under `genre`" is a prefix
 * question, which `COLLATE "C"` turns into an index range in the store and which
 * `isUnder` answers here.
 *
 * ## What is in this file and what is not
 *
 * Nothing here knows there is a database, an HTTP request or a catalogue.
 * `BookTags.restatedBy` computes which rows a source may take back and which it
 * must leave alone, and hands both to whoever owns the storage. That is the
 * whole of the separation, and it is worth having here rather than in a SQL
 * statement because it is the rule the product actually depends on: re-running a
 * lookup must not be able to throw away something a person decided.
 */

/**
 * Who says a book carries a tag.
 *
 * Three, not two. `catalogue` is a claim made by Open Library or Google Books;
 * `guess` is this app's inference over what they said, which is where the
 * fiction classifier's answers land; `person` is somebody deciding. Only a
 * person's is safe from every automatic rewrite.
 */
export type TagSource = 'person' | 'catalogue' | 'guess'

/** How sure the source was. The classifier's own vocabulary, kept. */
export type TagConfidence = 'high' | 'medium' | 'weak' | 'unknown'

/** The separator, in the slug and nowhere else. */
const SEPARATOR = '/'

/**
 * One segment of a slug, from whatever a person or a catalogue wrote.
 *
 * Decomposed and stripped of accents so "Sci-Fi", "sci fi" and "Sci‑Fi" with a
 * non-breaking hyphen all arrive as `sci-fi`, lowercased because case is a
 * display decision, and everything that is not a letter or a digit becomes a
 * single hyphen. `&` becomes "and" first, because dropping it would file
 * "Biography & Autobiography" as `biography-autobiography` and lose the word a
 * person would search for.
 */
export function slugSegment(raw: string): string {
  return raw
    .normalize('NFKD')
    // Combining marks, left behind by the decomposition above. Written as
    // escapes so the range is legible in a diff rather than being two
    // characters nothing renders.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A hierarchical tag slug. Comparable, and never parsed back apart by anything
 * outside this file.
 *
 * Cannot exist invalid: there is no public constructor, and every way in
 * normalises. An input that normalises to nothing is not a slug, and `of`
 * refuses it rather than inventing one.
 */
export class TagSlug {
  private constructor(readonly value: string) {}

  /**
   * The slug for a path, normalised segment by segment.
   *
   * Takes the whole path rather than one segment, so a catalogue heading that
   * already carries its own hierarchy arrives as one: BISAC writes
   * "Fiction / Fantasy / Epic", and that is `fiction/fantasy/epic` without
   * anybody having to take it apart first.
   */
  static of(raw: string): TagSlug {
    const slug = TagSlug.parse(raw)
    if (!slug) throw new Error(`"${raw}" has nothing in it that could be a tag slug`)
    return slug
  }

  /** The same, answering `null` instead of throwing. What a route wants. */
  static parse(raw: string): TagSlug | null {
    const segments = raw.split(SEPARATOR).map(slugSegment).filter(Boolean)
    if (!segments.length) return null
    return new TagSlug(segments.join(SEPARATOR))
  }

  /**
   * A slug under a parent, built from parts.
   *
   *     TagSlug.under('genre', 'Juvenile Fiction')  ->  genre/juvenile-fiction
   */
  static under(...parts: string[]): TagSlug {
    return TagSlug.of(parts.join(SEPARATOR))
  }

  get segments(): readonly string[] {
    return this.value.split(SEPARATOR)
  }

  /** The slug one level up, or null at the top. */
  get parent(): TagSlug | null {
    const segments = this.segments
    if (segments.length < 2) return null
    return new TagSlug(segments.slice(0, -1).join(SEPARATOR))
  }

  /**
   * Every slug this one sits under, nearest first.
   *
   * `genre/fantasy/epic` gives `genre/fantasy` then `genre`. Nothing requires
   * those rows to exist: a book may carry `genre/fantasy` in a vocabulary that
   * has never heard of `genre`, and `under genre` still finds it, because the
   * question is asked of the path rather than of a table.
   */
  get ancestors(): TagSlug[] {
    const found: TagSlug[] = []
    for (let slug = this.parent; slug; slug = slug.parent) found.push(slug)
    return found
  }

  /** Strictly beneath `other`. `genre` is not under `genre`. */
  isUnder(other: TagSlug): boolean {
    return this.value.startsWith(`${other.value}${SEPARATOR}`)
  }

  /** `is` and `under` are different questions, so both are askable. */
  isAtOrUnder(other: TagSlug): boolean {
    return this.value === other.value || this.isUnder(other)
  }

  equals(other: TagSlug): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}

/** A tag a book carries, and the provenance of it. */
export interface AppliedTag {
  slug: TagSlug
  source: TagSource
  confidence: TagConfidence
}

/** One thing a source is claiming right now. */
export interface TagClaim {
  slug: TagSlug
  confidence: TagConfidence
}

/**
 * What a source's latest word means for a book: what it takes back, what it
 * writes, and what it is not allowed to touch.
 */
export interface Restatement {
  /**
   * Rows to delete. **Every one of these carries the restating source**, which
   * is the property the whole design turns on and is asserted in the tests
   * rather than left as a comment.
   */
  retracted: AppliedTag[]
  /** Rows to write, whether new or with a confidence that has changed. */
  applied: TagClaim[]
  /** Left exactly as it was, including everything any other source said. */
  untouched: AppliedTag[]
}

/**
 * Every tag one book carries, from every source at once.
 *
 * The aggregate is the whole set rather than one row, for the same reason
 * `RangeSeparators` is a range rather than a boundary: the rule is about the
 * set. "A lookup may take back its own tags and no others" cannot be stated
 * about a single row, and a rewrite computed one row at a time is exactly how a
 * person's decision goes missing.
 */
export class BookTags {
  private constructor(private readonly applied: readonly AppliedTag[]) {}

  static of(applied: readonly AppliedTag[]): BookTags {
    return new BookTags([...applied])
  }

  get all(): readonly AppliedTag[] {
    return this.applied
  }

  /** Whether the book carries this tag at all, whoever said so. */
  has(slug: TagSlug): boolean {
    return this.applied.some((entry) => entry.slug.equals(slug))
  }

  /** Everything at or under a slug, which is what `under genre` asks. */
  at(prefix: TagSlug): AppliedTag[] {
    return this.applied.filter((entry) => entry.slug.isAtOrUnder(prefix))
  }

  /** Whatever this one source currently says. */
  from(source: TagSource): AppliedTag[] {
    return this.applied.filter((entry) => entry.source === source)
  }

  /**
   * What happens when `source` states its tags afresh.
   *
   * This is a lookup being re-run. A tag it no longer claims is retracted, one
   * it has started claiming is applied, one whose confidence changed is
   * rewritten, and **a row belonging to any other source is untouched, which is
   * not a policy applied afterwards but a consequence of the only rows this
   * looks at being its own.**
   *
   * A tag that is still claimed and unchanged is left alone rather than deleted
   * and written back. That keeps its `added_at`, which is the day somebody's
   * catalogue first said so, rather than the day a lookup last ran.
   *
   * Duplicate claims are collapsed on the slug, first one winning. A catalogue
   * that lists "Fiction" and "FICTION" is claiming one thing, and this is where
   * that becomes true rather than in the store's conflict handling.
   */
  restatedBy(source: TagSource, claims: readonly TagClaim[]): Restatement {
    const claimed = new Map<string, TagClaim>()
    for (const claim of claims) {
      if (!claimed.has(claim.slug.value)) claimed.set(claim.slug.value, claim)
    }

    const mine = new Map(this.from(source).map((entry) => [entry.slug.value, entry]))

    const retracted = [...mine.values()].filter((entry) => !claimed.has(entry.slug.value))
    const applied = [...claimed.values()].filter((claim) => {
      const already = mine.get(claim.slug.value)
      return !already || already.confidence !== claim.confidence
    })

    const rewritten = new Set(applied.map((claim) => claim.slug.value))
    const untouched = this.applied.filter((entry) =>
      entry.source !== source
      || (claimed.has(entry.slug.value) && !rewritten.has(entry.slug.value)))

    return { retracted, applied, untouched }
  }
}
