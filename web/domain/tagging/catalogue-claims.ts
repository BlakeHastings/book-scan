/**
 * Turns a catalogue lookup's raw strings into tag claims. Pure: no knowledge of
 * which catalogue answered, the network, or a database.
 *
 * BISAC headings arrive with their hierarchy already in them, "Fiction / Fantasy
 * / Epic", which becomes the slug path `subject/fiction/fantasy/epic`.
 */

import { TagSlug, type TagClaim, type TagConfidence } from './tags'

/**
 * Both built from `GENRE` so there is exactly one spelling of the namespace.
 * `non-fiction` has the hyphen because that is what "Non-fiction" normalises to.
 */
export const GENRE = TagSlug.of('genre')
export const FICTION = TagSlug.under(GENRE.value, 'fiction')
export const NON_FICTION = TagSlug.under(GENRE.value, 'non-fiction')

/**
 * One of those two, as a plain string. Placed here rather than in `genre.ts`
 * to avoid a cycle between domain modules that `npm run lint:layers` refuses.
 */
export type GenreSlug = 'genre/fiction' | 'genre/non-fiction'

/**
 * Cast needed because `TagSlug.value` is a plain `string`; verified against
 * the type in catalogue-claims.test.ts.
 */
export const FICTION_SLUG = FICTION.value as GenreSlug
export const NON_FICTION_SLUG = NON_FICTION.value as GenreSlug

/** Where a catalogue's own subject headings go. */
export const SUBJECT = TagSlug.of('subject')

/** What a lookup came back with, reduced to the parts that make tags. */
export interface CatalogueRecord {
  /** Null when no source stated a genre for the classifier to infer from. */
  genre: GenreSlug | null
  confidence: TagConfidence
  /** Google Books categories. BISAC, so already hierarchical. */
  categories?: readonly string[]
  /** Open Library subjects. Free text, and there can be hundreds. */
  subjects?: readonly string[]
}

/** Unlimited, a book ends up effectively tagless: every rule matches everything. */
export const SUBJECT_LIMIT = 12

/** Fiction or not, as a tag. */
export function genreClaim(genre: GenreSlug, confidence: TagConfidence): TagClaim {
  return { slug: genre === FICTION_SLUG ? FICTION : NON_FICTION, confidence }
}

/**
 * Genre tag first (if any), then subject headings, deduplicated by slug with
 * first mention winning. Categories are `high` confidence, subjects `medium`,
 * matching the ranking in `server/classify.ts`.
 */
export function claimsFrom(record: CatalogueRecord): TagClaim[] {
  const claims: TagClaim[] =
    record.genre ? [genreClaim(record.genre, record.confidence)] : []

  const heading = (raw: string, confidence: TagConfidence) => {
    const slug = TagSlug.parse(`${SUBJECT.value}/${raw}`)
    // Dropped rather than stored as bare `subject`, which would lump every unparseable heading under one meaningless tag.
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
