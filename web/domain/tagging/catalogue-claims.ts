/**
 * What a catalogue's answer means as tags.
 *
 * The one place a catalogue's strings become slugs, and it is pure: it takes
 * what a lookup said and returns claims, without knowing which catalogue
 * answered, whether it was reached over the network, or that there is a database
 * to write them to. `server/index.ts` does the translation from a `LookupResult`
 * and nothing else in the app repeats these rules.
 *
 * ## Why normalisation is the whole job
 *
 * Open Library and Google Books answer the same idea as "Fiction", "fiction",
 * "FICTION", "Fiction." and "Science Fiction", across two vocabularies and
 * whatever a contributor typed. Stored as written, a rule matching one of them
 * claims a fraction of the books it should, and the books it misses go somewhere
 * else with nothing reporting a problem. `TagSlug` folds all of those into one
 * slug on the way in, so what a rule references is stable even though what the
 * catalogue sends is not.
 *
 * BISAC headings arrive with their hierarchy already in them, "Fiction / Fantasy
 * / Epic", and that is a slug path rather than a string to flatten:
 * `subject/fiction/fantasy/epic`, which `under subject/fiction` then finds.
 */

import { TagSlug, type TagClaim, type TagConfidence } from './tags'

/**
 * The two tags the fiction flag becomes.
 *
 * Named here so the migration, the classifier and any future rule all mean the
 * same slugs. `genre/non-fiction` with the hyphen, because that is what
 * "Non-fiction" normalises to and the normalisation is the identity.
 */
export const FICTION = TagSlug.of('genre/fiction')
export const NON_FICTION = TagSlug.of('genre/non-fiction')

/** Where a catalogue's own subject headings go. */
export const SUBJECT = TagSlug.of('subject')

/** What a lookup came back with, reduced to the parts that make tags. */
export interface CatalogueRecord {
  /** The classifier's verdict, which is an inference rather than a claim. */
  isFiction: boolean
  confidence: TagConfidence
  /** Google Books categories. BISAC, so already hierarchical. */
  categories?: readonly string[]
  /** Open Library subjects. Free text, and there can be hundreds. */
  subjects?: readonly string[]
}

/**
 * How many subject headings are worth keeping.
 *
 * Open Library returns everything anybody ever attached to an edition, and a
 * book carrying two hundred tags is a book with no tags: the shelf view becomes
 * unreadable and every rule matches everything. The first dozen are the ones
 * contributors agreed on often enough to be listed first.
 */
export const SUBJECT_LIMIT = 12

/** Fiction or not, as a tag. The flag `books.is_fiction` has always held. */
export function genreClaim(isFiction: boolean, confidence: TagConfidence): TagClaim {
  return { slug: isFiction ? FICTION : NON_FICTION, confidence }
}

/**
 * Everything a catalogue lookup claims about a book.
 *
 * The genre tag first, because it is the one the shelving actually reads today,
 * then the subject headings. Deduplicated on the slug, first mention winning, so
 * a catalogue listing "Fiction" and "FICTION" is claiming one thing rather than
 * two: that has to be settled here rather than by the store's conflict handling,
 * or the second insert would quietly overwrite the first one's confidence.
 *
 * Google's categories are `high` and Open Library's subjects `medium`, which is
 * the same ranking `server/classify.ts` already gives them: BISAC headings are
 * curated by publishers, Open Library subjects are typed by anybody.
 */
export function claimsFrom(record: CatalogueRecord): TagClaim[] {
  const claims: TagClaim[] = [genreClaim(record.isFiction, record.confidence)]

  const heading = (raw: string, confidence: TagConfidence) => {
    const slug = TagSlug.parse(`${SUBJECT.value}/${raw}`)
    // A heading that normalises to nothing, "---" or "?", is not a tag. Dropped
    // rather than stored as `subject`, which would put every unparseable
    // heading in the catalogue under one meaningless tag.
    if (slug && slug.isUnder(SUBJECT)) claims.push({ slug, confidence })
  }

  for (const category of record.categories ?? []) heading(category, 'high')
  for (const subject of (record.subjects ?? []).slice(0, SUBJECT_LIMIT)) heading(subject, 'medium')

  const seen = new Set<string>()
  return claims.filter((claim) => {
    if (seen.has(claim.slug.value)) return false
    seen.add(claim.slug.value)
    return true
  })
}
