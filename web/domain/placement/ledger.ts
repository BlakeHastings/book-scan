/**
 * Where a book has been, as rows rather than as three columns of present tense.
 *
 * `books.location`, `books.shelved_at` and `books.checked_out_at` can say where
 * a book is and when it got there, and nothing else. They cannot say that it
 * came back from somewhere, that a person put it where the rules did not want
 * it, or that somebody decided once and for all that it stays on this plank. A
 * ledger says all of that by keeping every move instead of the last one.
 *
 * ## The two kinds are the whole design
 *
 * **`assigned` is what the rules want; `placed` is what somebody did.** They
 * disagree exactly when a book needs attention, so the misfile list stops being
 * a computation beside the model and becomes a property of it: a book is
 * misfiled when its standing assignment names an area it is not in.
 *
 * That distinction only means anything while every row in this table is about
 * placement. The owner settled on 2026-08-07 that the ledger records placement
 * and not tag changes, and `docs/data-model.md` says what that gives up on
 * purpose. **Do not widen this to carry another kind of event.**
 *
 * ## `pinned` beats every rule, forever
 *
 * A book whose latest row is `pinned` is skipped by the rule engine. Unpinning
 * is another row, so even the decision to stop pinning is in the history, and
 * there is no flag anywhere that a person can be surprised by.
 *
 * ## Withdrawing is the other half of applying, and it is a row too
 *
 * An intention somebody can create and cannot take back is a one-way door, and
 * this app does not have those: a discard is a state, a removal retires, a
 * boundary move can be handed back. `released` is that half here. It says the
 * rules' answer is not one this person is going to act on, it leaves `placed`
 * untouched because no book has moved, and it is remembered as `declined` so
 * that applying a plan again does not hand the same work straight back.
 *
 * It is not a pin. A pin says where a book goes whatever the rules want, forever
 * and for every rule; this says no to one answer, and the next different answer
 * is asked for normally.
 *
 * ## What is in this file and what is not
 *
 * The fold, and only the fold. Everything here is a pure function of a book's
 * own rows, so the same answers are available to a migration reading them back,
 * to a test replaying them, and to the check that proves `books.current_area_id`
 * agrees with them. Which rows exist, and when one is written, is `application/`
 * and `infrastructure/`.
 */

/**
 * Every kind of row, in the order a book meets them.
 *
 * The order is a life rather than an alphabet, the way `BOOK_STATES` is: a book
 * is assigned somewhere, perhaps left where it stands instead, put there,
 * perhaps pinned there, goes out and comes back, and one day leaves the
 * collection.
 */
export const PLACEMENT_KINDS = [
  /** The rules claim this book belongs in this area. Nobody has moved it. */
  'assigned',
  /**
   * A person will not act on that claim. The book stays exactly where it stands.
   *
   * **The withdrawal of an assignment and nothing else.** It names no area, and
   * that is structural rather than tidy: withdrawing must never say where a book
   * is, `placed` is what somebody did and is not this row's to touch, and a kind
   * the schema forbids an area on cannot rewrite one by accident.
   *
   * What it withdraws is whatever assignment was standing when it was written,
   * which is `Standing.declined` read back out of the fold. Nothing is deleted:
   * the assignment is still in the ledger with the rule that wanted it, and this
   * row is the answer somebody gave it.
   */
  'released',
  /** A person put the book in this area and said so. */
  'placed',
  /** A definitive placement no rule may overwrite. Undone by a later row. */
  'pinned',
  /** Off the shelf, still owned. Holds no area: it is nowhere to be found. */
  'checked_out',
  /** Back in the house, and not yet anywhere: the rules place it again. */
  'checked_in',
  /** Given away, sold, lost. Terminal and archival. Nothing is deleted. */
  'withdrawn',
] as const

export type PlacementKind = (typeof PLACEMENT_KINDS)[number]

/**
 * The kinds that name an area, which is exactly the kinds that put a book
 * somewhere.
 *
 * Three of the other four take a book out of every area there is, so an area on
 * one of them would be a claim about where a book that is nowhere is. The
 * fourth is `released`, which is the one kind that leaves a book exactly where
 * it was: it is about the rules' answer rather than about the room, so it has no
 * area to name and must not be given one. The schema's check constraint is
 * written from this list, so the table cannot hold a row this file would not
 * know how to fold.
 */
export const KINDS_AT_A_PLACE = ['assigned', 'placed', 'pinned'] as const

export type KindAtAPlace = (typeof KINDS_AT_A_PLACE)[number]

export function isAtAPlace(kind: PlacementKind): kind is KindAtAPlace {
  return (KINDS_AT_A_PLACE as readonly string[]).includes(kind)
}

/**
 * The kinds that say nothing at all about where a book is.
 *
 * Both of them are about the rules' answer rather than about the room: one is
 * the answer, the other is somebody declining it. Neither moves a book, so the
 * projection has to skip past both to the last row that did, and it is written
 * from this constant rather than from a hand-kept `<> 'assigned'` in four
 * statements. That literal was correct for exactly as long as `assigned` was the
 * only kind of its sort, and a projection that read a `released` row as "this
 * book is nowhere" would empty `current_area_id` for every book somebody left
 * where it stood: the one outcome this whole feature must not produce.
 */
export const KINDS_ABOUT_THE_ANSWER = ['assigned', 'released'] as const

/**
 * Who wrote a row.
 *
 * Three, and the third one is the honest part: `migration` is what a backfill
 * reading a column wrote, and it is a weaker claim than either of the others. A
 * `person` row is somebody saying where a book is; a `rules` row is the engine
 * saying where it should be; a `migration` row is neither, and being able to
 * tell them apart is why this is not free text.
 */
export const PLACEMENT_ACTORS = ['person', 'rules', 'migration'] as const

export type PlacementActor = (typeof PLACEMENT_ACTORS)[number]

/** One row of the ledger. Append only: nothing here is ever updated. */
export interface Placement {
  /** Ascending with time, and the only ordering this file uses. */
  id: number
  bookId: number
  kind: PlacementKind
  /** Set on exactly the kinds in `KINDS_AT_A_PLACE`. */
  areaId: number | null
  /**
   * The book's sort key when the row was written.
   *
   * History rather than input: an area is anchored to a sort key, so a row that
   * did not carry one could not be read back as a position once the book has
   * been re-keyed by an edit.
   */
  sortKey: string
  /** The rule that wanted this, on `assigned` rows and on no others. */
  ruleId: number | null
  actor: PlacementActor
  reason: string
  createdAt: string
}

/**
 * What a book's rows add up to.
 *
 * Deliberately the raw facts rather than a verdict, so the two questions asked
 * of it, "where is this book" and "does it need attention", are each answered in
 * one place below rather than folded together here.
 */
export interface Standing {
  /**
   * Where the book is: the area a person last put it in.
   *
   * **`assigned` does not move this, and that is the point.** A projection that
   * followed the rules would say a book is where nobody has carried it, and the
   * misfile list would be empty by construction.
   */
  area: number | null
  /** Where the rules last said it belongs, when that is still outstanding. */
  assigned: number | null
  /**
   * An area a person has already said this book is not going to.
   *
   * **The withdrawal remembered, and the only reason it is remembered is that
   * forgetting it would re-create the work.** An assignment comes from a rule,
   * the rule is still there after the assignment is withdrawn, and a run that
   * knew nothing about the withdrawal would write the same row again the next
   * time anybody applied a plan. So `assignmentFor` reads this, and the answer
   * somebody has already declined is not asked for a second time.
   *
   * One area rather than a set, and the newest: it is the answer that was on the
   * table when the person said no. A rule that changes its mind to a different
   * area is a different answer, and it is written, because it is work the person
   * has not seen. Anything that moves the book, pins it, or takes it out of the
   * house clears this, because after any of those the question is a new one.
   */
  declined: number | null
  /** The latest row is a pin, so the engine leaves this book alone. */
  pinned: boolean
  checkedOut: boolean
  withdrawn: boolean
}

const NOWHERE: Standing = {
  area: null, assigned: null, declined: null, pinned: false, checkedOut: false, withdrawn: false,
}

/**
 * Replay a book's rows.
 *
 * `rows` may arrive in any order; they are folded by `id`, which is the order
 * they were written in. A book with no rows is nowhere, which is a real answer:
 * it is the state of every book nobody has put anywhere.
 *
 * Three kinds take a book out of every area. `checked_out` because a book in a
 * box on the floor holds no position; `checked_in` because a book that has come
 * back is placed again by the rules rather than remembering where it was, which
 * is `docs/data-model.md`'s decision and the reason `Store.setCheckedOut`
 * returns a book to `shelved` and not to an area; `withdrawn` because it is not
 * in the house.
 *
 * A pin clears the standing assignment as well as setting the area. Pinning says
 * "this is where it goes, whatever the rules want", so leaving an older
 * assignment standing would report a pinned book as misfiled forever.
 *
 * **`released` is the one kind that changes nothing about where the book is.**
 * It takes the standing assignment off and keeps it as `declined`, so the book
 * goes on standing where it stands and the rules stop asking for the answer
 * somebody turned down. An assignment naming the declined area again is a person
 * putting the work back on the list, and it clears the memory rather than
 * standing beside it: an area cannot be both wanted and declined.
 */
export function standingOf(rows: readonly Placement[]): Standing {
  const ordered = [...rows].sort((a, b) => a.id - b.id)

  let standing = { ...NOWHERE }
  for (const row of ordered) {
    switch (row.kind) {
      case 'assigned':
        standing = {
          ...standing,
          assigned: row.areaId,
          declined: standing.declined === row.areaId ? null : standing.declined,
        }
        break
      case 'released':
        standing = {
          ...standing,
          assigned: null,
          /*
           * Only an answer that was actually outstanding is declined. A book
           * somebody has already carried to the area the rules wanted has its
           * assignment satisfied rather than outstanding, so there is nothing
           * there to turn down, and remembering one would have the list reporting
           * a book as set aside from the place it is standing in.
           */
          declined: standing.assigned !== null && standing.assigned !== standing.area
            ? standing.assigned
            : standing.declined,
        }
        break
      case 'placed':
        standing = {
          ...standing,
          area: row.areaId,
          declined: null,
          pinned: false,
          checkedOut: false,
          withdrawn: false,
        }
        break
      case 'pinned':
        standing = {
          ...NOWHERE, area: row.areaId, pinned: true,
        }
        break
      case 'checked_out':
        standing = { ...NOWHERE, checkedOut: true }
        break
      case 'checked_in':
        standing = { ...NOWHERE }
        break
      case 'withdrawn':
        standing = { ...NOWHERE, withdrawn: true }
        break
    }
    if (row.kind !== 'pinned' && row.kind !== 'placed') continue
  }
  return standing
}

/**
 * Where a book is, which is what `books.current_area_id` holds.
 *
 * The projection is exactly this function applied to a book's rows, and the
 * check that proves the two agree is the reason the projection is allowed to
 * exist at all. See `infrastructure/placement/projection.ts`.
 */
export function currentAreaOf(rows: readonly Placement[]): number | null {
  return standingOf(rows).area
}

/**
 * Whether the rules and the room disagree about this book.
 *
 * **This is the misfile list, as a property of the model.** Today it is
 * `reviewShelving` comparing a recorded label against one derived from the sort
 * order every time anybody asks. Here it is two columns of one row, already
 * written down, and the reason for the disagreement is a rule with a name.
 *
 * A pinned book is never misfiled: a pin is a person overruling the rules, so
 * reporting it as needing attention would be the app arguing with them.
 */
export function needsAttention(standing: Standing): boolean {
  if (standing.pinned || standing.withdrawn || standing.checkedOut) return false
  return standing.assigned !== null && standing.assigned !== standing.area
}

/**
 * The area an `assigned` row would name, or null when the engine writes none.
 *
 * **`assigned` rows are written only where the answer differs from where the
 * book already is**, and this is that rule in one place. Writing a row for every
 * book on every evaluation would make the ledger enormous and useless as
 * history: a run over a settled catalogue would add a row per book saying
 * nothing changed, and the rows that mean something would be lost among them.
 *
 * "Where the book already is" is the standing assignment when there is one, and
 * where a person last put it otherwise. Comparing against the placement alone
 * would rewrite the same assignment on every run for as long as nobody carries
 * the book, which is the same flood arriving more slowly.
 *
 * Null for a pinned book, because a pin beats every rule; for a withdrawn one,
 * because it has left; and for a checked out one, because it is placed again
 * when it comes back and not before.
 *
 * **And null for the answer somebody has already declined**, which is the half
 * that makes withdrawing worth having. A rule that produced an assignment is
 * still standing after that assignment is withdrawn, so a run that ignored the
 * withdrawal would write the identical row again and hand back the work the
 * person had just taken off their list. Silently re-creating dismissed work is
 * worse than never offering to dismiss it.
 *
 * It is the answer that is declined and not the book. A rule naming a different
 * area is written, because that is something the person has not seen and turned
 * down, and moving, pinning or checking the book out clears the memory entirely.
 */
export function assignmentFor(standing: Standing, wanted: number | null): number | null {
  if (standing.pinned || standing.withdrawn || standing.checkedOut) return null
  if (wanted === null) return null
  if (wanted === standing.declined) return null
  return wanted === (standing.assigned ?? standing.area) ? null : wanted
}
