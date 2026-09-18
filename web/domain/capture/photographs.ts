/**
 * What a photograph is of. `spine` is called `edge` elsewhere in the schema;
 * the migration that reads the old columns is the only place both spellings meet.
 *
 * `catalogue` is downloaded publisher artwork, not a photograph of this copy,
 * so the detector is never pointed at one.
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
 * The crop file is checked first, so a crop that exists reports `cropped`
 * even if `examined` was never set.
 */
export function verdictOf(photograph: Photograph): Verdict {
  if (photograph.cropFile) return 'cropped'
  return photograph.examined ? 'declined' : 'unexamined'
}

/**
 * The crop if there is one, else the whole photograph. Deliberately not about
 * *which* photograph: that is `latest` below.
 */
export function shownFile(photograph: Photograph): string {
  return photograph.cropFile || photograph.file
}

/**
 * The photographs one book has, newest first within each kind. Every lookup
 * below is a linear scan, deliberately: a book has only a handful of these.
 */
export class Photographs {
  private constructor(private readonly all: readonly Photograph[]) {}

  /**
   * Sorted once here so every reader agrees: newest first by `takenAt`, ties
   * broken by insertion order (two photographs can share a timestamp).
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
   * The current photograph of a kind, or null when there is none. The newest,
   * since a re-shoot means the previous one was not good enough; older ones
   * stay reachable via `ofKind`.
   */
  latest(kind: PhotographKind): Photograph | null {
    return this.ofKind(kind)[0] ?? null
  }

  /** The kinds this book actually has, in the order `PHOTOGRAPH_KINDS` gives. */
  kinds(): PhotographKind[] {
    return PHOTOGRAPH_KINDS.filter((kind) => this.ofKind(kind).length > 0)
  }
}
