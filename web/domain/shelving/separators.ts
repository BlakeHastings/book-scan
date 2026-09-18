/**
 * The boundaries of one shelf range. The aggregate is the whole set, not one
 * boundary, because the invariant is about the set: positions are 0, 1, 2, ...
 * with no gaps and no repeats. A repeat means `Shelves.list`'s
 * `ORDER BY position` can return the same shelf label pointing at different
 * runs of books between requests.
 *
 * Nothing here knows there is a database: `without` computes a removal and the
 * renumbering that keeps the rest contiguous, and hands both back for whoever
 * owns storage to write.
 */

import type { Separator } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

export class RangeSeparators {
  private constructor(
    readonly range: ShelfRange,
    private readonly ordered: readonly Separator[],
  ) {}

  /**
   * The boundaries of one range, in position order. Sorted here rather than
   * trusted from the caller, since a shared position makes `ORDER BY position`
   * unstable; ties break on id, which is stable and reflects creation order.
   */
  static of(range: ShelfRange, separators: readonly Separator[]): RangeSeparators {
    const ordered = [...separators].sort(
      (a, b) => (a.position - b.position) || (a.id - b.id),
    )
    return new RangeSeparators(range, ordered)
  }

  /** Every boundary in this range, in the order a reader meets them. */
  get all(): readonly Separator[] {
    return this.ordered
  }

  /**
   * The count, not the highest position plus one. These differ only when the
   * invariant is broken, in which case this is the one that closes the gap
   * instead of widening it.
   */
  get nextPosition(): number {
    return this.ordered.length
  }

  /** Whether positions are 0, 1, 2 ... with no gaps and no repeats. */
  get contiguous(): boolean {
    return this.ordered.every((separator, at) => separator.position === at)
  }

  /**
   * The boundary this range would lose, or `null` when it has none. Null is
   * not an error: a request to remove an already-removed boundary has got
   * what it asked for.
   */
  without(id: number): Separator | null {
    return this.ordered.find((separator) => separator.id === id) ?? null
  }
}
