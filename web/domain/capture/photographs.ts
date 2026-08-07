/**
 * Photographs of a book, and what the crop detector made of each one.
 *
 * ## Why this is a collection rather than four fields
 *
 * The schema this replaces gives a book one `front_image`, one `back_image`,
 * one `edge_image` and one `cover_image`, so a second photograph of a kind can
 * only exist by overwriting the first. A blurred spine cannot be re-shot without
 * destroying the original, and the original is the record: the photographs are
 * half of what is irreplaceable about this catalogue, and the app that owns them
 * should not be the thing that deletes one.
 *
 * So a photograph is a row, many rows per kind are ordinary, and "the spine" is
 * a question with an answer (`latest`) rather than a column. Nothing here knows
 * that there is a database, a file system or an HTTP request.
 *
 * ## The distinction this file exists to keep
 *
 * A photograph is in exactly one of three states, and the middle one is the
 * reason `examined` is a column of its own:
 *
 * | `examined` | `cropFile` | Verdict | What a caption may honestly say |
 * | --- | --- | --- | --- |
 * | false | `''` | `unexamined` | Nothing about the detector. It never ran. |
 * | true | `''` | `declined` | It looked and could not find the book. |
 * | true | a file | `cropped` | It found the book, and here it is. |
 *
 * `examined` true with an empty crop is **not** the same fact as never having
 * looked, and collapsing the two is how a view ends up saying "the book could
 * not be picked out of this photo" about a photograph no detector has ever
 * opened. Today that distinction is smeared across a comma-separated `cropped`
 * string on `books` and on the queue table, where it is one string per row
 * describing three photographs, so it cannot survive a second photograph of a
 * kind at all. Here it is per photograph, which is the only place it was ever
 * a fact about.
 *
 * The fourth combination, `examined` false with a crop file, is not a state: a
 * crop is something the detector produced, so a crop that exists was examined.
 * `verdictOf` reports it as `cropped` rather than inventing a fourth name,
 * because the file is evidence and the flag is bookkeeping.
 */

/**
 * What a photograph is of.
 *
 * `spine` is what the rest of this repository calls `edge`, and the rename is
 * deliberate: `docs/data-model.md` settles the vocabulary as front, back, spine
 * and catalogue, and `edge` is a column name from a schema that is going away.
 * The two spellings meet in exactly one place, the migration that reads the old
 * columns, and nowhere else.
 *
 * `catalogue` is the publisher's artwork downloaded from Open Library or Google
 * Books. It is a photograph of the book in the same sense as the others for
 * everything that draws it, and it is not a photograph of *this copy*, which is
 * why the detector is never pointed at one.
 */
export type PhotographKind = 'front' | 'back' | 'spine' | 'catalogue'

/** Every kind, in the order a person would flick through them. */
export const PHOTOGRAPH_KINDS: readonly PhotographKind[] = [
  'front', 'back', 'spine', 'catalogue',
]

/** Whether a string names a kind. Used where an id arrives from outside. */
export function isPhotographKind(raw: string): raw is PhotographKind {
  return (PHOTOGRAPH_KINDS as readonly string[]).includes(raw)
}

/** One photograph, as everything above the store sees it. */
export interface Photograph {
  kind: PhotographKind
  /** The whole photograph, as taken. Never overwritten, never replaced. */
  file: string
  /** The book cut out of it, when the detector found one. `''` otherwise. */
  cropFile: string
  /** Whether the detector has been shown this photograph at all. */
  examined: boolean
  /** A difference hash of the photograph, for recognising a book by its cover. */
  hash: string
  /** When the shutter went, or when the artwork was fetched. ISO-8601. */
  takenAt: string
}

/** What the detector has to say about one photograph. Three states, not two. */
export type Verdict = 'unexamined' | 'declined' | 'cropped'

/**
 * The detector's verdict on one photograph.
 *
 * The crop file is asked about first, so a row whose flag was never set but
 * whose crop exists still reports `cropped`. See the note at the top of this
 * file about the fourth combination.
 */
export function verdictOf(photograph: Photograph): Verdict {
  if (photograph.cropFile) return 'cropped'
  return photograph.examined ? 'declined' : 'unexamined'
}

/**
 * The file a view should draw for one photograph.
 *
 * The crop where there is one, the whole photograph otherwise. Deliberately not
 * a decision about *which* photograph to draw: that is `latest` below, and
 * mixing the two is how `shared/shelving.ts` ended up answering two questions in
 * one function.
 */
export function shownFile(photograph: Photograph): string {
  return photograph.cropFile || photograph.file
}

/**
 * The photographs one book has, newest first within each kind.
 *
 * Immutable and cheap: a book has single figures of these, so every question
 * below is a scan and none of them is worth an index.
 */
export class Photographs {
  private constructor(private readonly all: readonly Photograph[]) {}

  /**
   * Order once, on the way in, so every reader below agrees.
   *
   * Newest first by `takenAt`. A tie is broken by the order the store handed
   * them over, which is the insertion order and therefore the order they were
   * taken in: two photographs of one book can share a timestamp, because
   * `books.scanned_at` was one value for all three slots before this table
   * existed and every row the migration writes carries it.
   */
  static of(photographs: readonly Photograph[]): Photographs {
    return new Photographs(
      [...photographs].sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0)),
    )
  }

  /** Every photograph, newest first. */
  get list(): readonly Photograph[] {
    return this.all
  }

  get count(): number {
    return this.all.length
  }

  /** Every photograph of one kind, newest first. */
  ofKind(kind: PhotographKind): readonly Photograph[] {
    return this.all.filter((one) => one.kind === kind)
  }

  /**
   * The current photograph of a kind, or null when there is none.
   *
   * "The spine", asked of a model where there can be four of them. The newest
   * one is the answer because a re-shoot is somebody deciding the previous
   * attempt was not good enough, and the ones behind it stay reachable through
   * `ofKind` rather than being deleted.
   */
  latest(kind: PhotographKind): Photograph | null {
    return this.ofKind(kind)[0] ?? null
  }

  /** The kinds this book actually has, in the order `PHOTOGRAPH_KINDS` gives. */
  kinds(): PhotographKind[] {
    return PHOTOGRAPH_KINDS.filter((kind) => this.ofKind(kind).length > 0)
  }
}
