import { SIMILAR_LIMIT } from '../../../shared/confidence'
import type { CoverHashes, CoverPictures, CoverWords, HashMatch, PictureMatch, WordsMatch } from '../read-models'

/**
 * Reciprocal rank fusion's constant, from the paper (Cormack, Clarke and
 * Büttcher, SIGIR 2009). Large enough that being first in one list is worth
 * little more than being second, so a book two strategies both put near the
 * top beats a book one strategy alone put first.
 */
export const RRF_K = 60

/** How deep into the picture's and the hash's rankings the fusion reads. */
const DEPTH = 10

/** The shortlist a person is shown, and the candidates the bar is asked of. */
const SHORTLIST = 4

/**
 * The words take part with their own shortlist of four, and only books they
 * found something of. The text handler answers its nearest titles whatever
 * the reading, so in a small catalogue every book is somewhere on its list,
 * and a tail of books scoring 0.05 was outvoting the one book whose title is
 * printed there. Chosen on seed 7, where it moved the fused top-1 from 75.0%
 * to 79.7% (`docs/the-cover-matcher.md`).
 */
const WORDS = { depth: SHORTLIST, score: 0.1 } as const

/**
 * When one book may be opened without asking. Chosen on synthetic seed 7 and
 * reported on seed 1 and on real covers, in `docs/the-cover-matcher.md`
 * ("Fusion, as built"). Two ways in, and both need the words printed on the
 * cover, because the words are the only evidence that tells two volumes of one
 * series apart: an image model sees one design, and an author's name is on
 * every volume.
 */
export const BAR = {
  /**
   * The picture and the words agree: the image model and the text both rank
   * the book first, this much of its title is printed there, and the text
   * puts it this far ahead of its own second. On seed 7 a lead of 0.05 opened
   * a series sibling ("The Silent Orchard" for "The Silent Island"), 0.08
   * opened none, and 0.1 is the room. Seed 7 opened nothing wrong at any
   * share of the title from 0 up once the lead was 0.1; the share is 0.6
   * because of #664's sibling, which seed 7 does not have: a reading of "The
   * Warlord of Mars" by Edgar Rice Burroughs holds 0.48 of "The Gods of Mars"
   * and 0.42 of "A Princess of Mars", and a catalogue holding only one of
   * them has no second volume for the lead to stop it on.
   */
  agreement: { titlePrinted: 0.6, lead: 0.1 },
  /**
   * The title is on the cover: the text ranks the book first with this much
   * of its title printed and this lead, #667's own bar, and the image model
   * has it among the ten it ranks. On seed 7 nothing wrong opened with the
   * picture asked to rank it fourth or better, tenth or better, or not at all;
   * ten is the loosest of the three that still asks the picture at all. With
   * the image model off, the words alone.
   */
  printedTitle: { titlePrinted: 0.8, lead: 0.05, pictureWithin: DEPTH },
} as const

export interface MatchCover {
  /** The photograph, for the image model and the hash. */
  photo: Uint8Array
  /** What OCR already read off this photograph. Never read again here. */
  reading: string
}

/** One book on the shortlist, with what each strategy said about it. */
export interface CoverMatchCandidate {
  id: number
  /** The fused score: higher is more strategies ranking it higher. */
  fused: number
  /** The image model's cosine, or null when it did not rank this book (or is off). */
  similarity: number | null
  /** How much of the title is printed on the cover, or null when the words did not find it. */
  titlePrinted: number | null
  /** The hash's distance in bits, or null when the hash did not find it within its band. */
  distance: number | null
}

export interface CoverMatchAnswer {
  /** Best first, at most four. The confident book, when there is one, is first. */
  candidates: CoverMatchCandidate[]
  /** The one book to open without asking, or null. */
  confident: number | null
  /** False when the image model was off and only the words and the hash were asked. */
  pictures: boolean
}

interface Evidence {
  pictures: readonly PictureMatch[] | null
  words: readonly WordsMatch[]
  hashes: readonly HashMatch[]
}

/** Each strategy's list, best first, as rank-fused scores by book. */
export function fuse(lists: readonly (readonly { id: number }[])[]): Map<number, number> {
  const fused = new Map<number, number>()
  for (const list of lists) {
    list.slice(0, DEPTH).forEach((entry, rank) => {
      fused.set(entry.id, (fused.get(entry.id) ?? 0) + 1 / (RRF_K + rank + 1))
    })
  }
  return fused
}

/** How far this book is ahead of the best other one on the words' list, by score; -1 when the words did not find it. */
function leadOf(words: readonly WordsMatch[], id: number): number {
  const mine = words.find((entry) => entry.id === id)
  if (!mine) return -1
  const next = words.find((entry) => entry.id !== id)
  return mine.score - (next?.score ?? 0)
}

/** Whether this one book clears either way in to the bar. */
export function clearsBar(id: number, evidence: Evidence): boolean {
  const { pictures, words } = evidence
  const first = words[0]
  if (first?.id !== id) return false
  const lead = leadOf(words, id)

  const pictureRank = pictures ? pictures.findIndex((entry) => entry.id === id) : -1
  const agreement = pictureRank === 0
    && first.titlePrinted >= BAR.agreement.titlePrinted
    && lead >= BAR.agreement.lead
  const printed = first.titlePrinted >= BAR.printedTitle.titlePrinted
    && lead >= BAR.printedTitle.lead
    && (pictures === null || (pictureRank >= 0 && pictureRank < BAR.printedTitle.pictureWithin))
  return agreement || printed
}

/**
 * Which book a photograph of a cover is, by every strategy at once: the image
 * model's nearest covers, the words OCR read off it, and the perceptual hash,
 * fused by reciprocal rank (k = 60) into one shortlist, with one book marked
 * confident only when the strategies agree on it (`BAR`).
 *
 * A decoded ISBN is not this handler's question: the scan route short-circuits
 * on one before asking, as it always has. The hash takes part only inside its
 * `similar` band, because past it the hash is close to chance on real covers
 * and pulled the fused row down (`docs/the-cover-matcher.md`).
 *
 * With the image model off, the words and the hash answer alone, and the bar is
 * the printed title alone.
 */
export class MatchCoverHandler {
  constructor(
    private readonly pictures: CoverPictures,
    private readonly words: CoverWords,
    private readonly hashes: CoverHashes,
  ) {}

  async handle(query: MatchCover): Promise<CoverMatchAnswer> {
    // The picture and the hash are both CPU in this process and the words are
    // a query, so the words go alongside.
    const [pictures, words, hashes] = await Promise.all([
      this.pictures.nearest(query.photo, DEPTH),
      this.words.near(query.reading, DEPTH),
      this.hashes.near(query.photo, SIMILAR_LIMIT, DEPTH),
    ])
    const evidence: Evidence = { pictures, words, hashes }

    const telling = words.filter((entry) => entry.score >= WORDS.score).slice(0, WORDS.depth)
    const ranked = [...fuse([pictures ?? [], telling, hashes]).entries()]
      // By id on a tie, so one photograph always answers the same way.
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, SHORTLIST)

    // Only the book the words rank first can clear the bar, so there is never
    // a second to choose between; and it has to be on the shortlist it is
    // opened from.
    const confident = ranked.find(([id]) => clearsBar(id, evidence))?.[0] ?? null
    const ordered = confident === null
      ? ranked
      : [...ranked.filter(([id]) => id === confident), ...ranked.filter(([id]) => id !== confident)]

    return {
      candidates: ordered.map(([id, fused]) => ({
        id,
        fused,
        similarity: pictures?.find((entry) => entry.id === id)?.similarity ?? null,
        titlePrinted: words.find((entry) => entry.id === id)?.titlePrinted ?? null,
        distance: hashes.find((entry) => entry.id === id)?.distance ?? null,
      })),
      confident,
      pictures: pictures !== null,
    }
  }
}
