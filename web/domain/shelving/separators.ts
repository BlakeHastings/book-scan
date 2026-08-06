/**
 * The boundaries of one shelf range, and the invariant that holds them together.
 *
 * ## What this is
 *
 * A separator is a physical fact: somebody stood at a bookcase, said "this
 * plank is full", and the next book began a new one. The row records where that
 * happened by naming the sort key of the first book on the new shelf, so
 * removing the book it points at leaves the boundary describing the right
 * *place* rather than orphaning it.
 *
 * The aggregate is all of one range's boundaries together, not one boundary,
 * because the invariant is about the set: **positions are 0, 1, 2 ... with no
 * gaps and no repeats.** A gap or a repeat is not cosmetic. `Shelves.list`
 * orders by `position`, so two boundaries sharing one means the same shelf
 * label points at different runs of books between requests, every book in the
 * range derives a plank it is not on, and the misfile check reports the whole
 * range as wrong. That is a real outcome, arrived at twice: once from two
 * removals racing each other and once from two overflows creating a boundary at
 * the same position (see the transaction notes in `Shelves.remove` and
 * `Shelves.overflow`).
 *
 * ## Why it is in `domain/`
 *
 * Nothing here knows there is a database. `without` computes a removal and the
 * renumbering that keeps the rest contiguous, and hands both back; whoever owns
 * the storage writes them. That is the whole of the separation, and it is worth
 * testing exactly because it is small: this file has no fixtures, no container
 * and no async, so the rule that positions stay contiguous is stated somewhere
 * a reader can check it in ten seconds.
 *
 * **`separators` is mid-rename and nothing here anticipates it.** #170 turns it
 * into `area` with a parent, and docs/shelving.md records that an area is not a
 * plank. What is modelled here is what exists today.
 */

import type { Separator } from '../../shared/layout'
import type { ShelfRange } from '../../shared/shelving'

// DELIBERATELY WRONG, and removed in the next commit. This is the import the
// layering exists to prevent: a domain file reaching into infrastructure for
// the shape of a database table. It is here so the check that forbids it can
// be watched failing in CI rather than trusted, per #172.
import type { separators } from '../../infrastructure/db/schema'

/** The leak. If this compiles and CI is green, the boundary is decorative. */
export type SeparatorTable = typeof separators

/** One boundary given a new ordinal, which is all a renumbering is. */
export interface Repositioned {
  id: number
  position: number
}

/** A removal, and everything else that has to move because of it. */
export interface Removal {
  removed: Separator
  /**
   * The boundaries whose position changed, and only those. A renumbering that
   * rewrote every row would be correct and would also make it impossible to
   * read a log and see what actually moved.
   */
  renumbered: Repositioned[]
}

export class RangeSeparators {
  private constructor(
    readonly range: ShelfRange,
    private readonly ordered: readonly Separator[],
  ) {}

  /**
   * The boundaries of one range, put in position order.
   *
   * Sorted here rather than trusted from the caller, and a store that already
   * ordered by `position` loses nothing by it. The reason is the failure this
   * type exists to prevent: when two rows share a position, `ORDER BY position`
   * returns them in whatever order the server felt like, so "the order they
   * arrived in" is exactly the thing that is not dependable in the case that
   * matters. Ties break on id, which is stable and is the order they were
   * created in.
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
   * The position the next boundary takes: after the ones already there.
   *
   * The count rather than the highest position plus one. They are the same
   * number while the invariant holds, and when it does not, this is the one
   * that closes the gap instead of widening it.
   */
  get nextPosition(): number {
    return this.ordered.length
  }

  /** Whether positions are 0, 1, 2 ... with no gaps and no repeats. */
  get contiguous(): boolean {
    return this.ordered.every((separator, at) => separator.position === at)
  }

  /**
   * Take one boundary out, and say what the rest have to become.
   *
   * `null` when no boundary here has that id, which is not an error: a request
   * to remove a line somebody else has already removed has got what it asked
   * for, and that is what the store did before this existed.
   *
   * The renumbering is computed from the resulting order rather than as
   * "decrement everything after it". Those agree whenever the invariant already
   * held, and where they differ this is the one that repairs a range rather
   * than carrying the damage forward one more removal.
   */
  without(id: number): Removal | null {
    const removed = this.ordered.find((separator) => separator.id === id)
    if (!removed) return null

    const renumbered: Repositioned[] = []
    let position = 0
    for (const separator of this.ordered) {
      if (separator.id === id) continue
      if (separator.position !== position) renumbered.push({ id: separator.id, position })
      position += 1
    }

    return { removed, renumbered }
  }
}
