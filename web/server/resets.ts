/**
 * The three resets on the Settings screen: what each would change, read without
 * writing, and the write itself once somebody has typed the phrase for it.
 *
 * The writers are where the rest of their kind are: the two about books in
 * `Store`, the furniture beside the furniture writers. This file only asks and
 * refuses.
 */

import { RESET_PHRASES, confirms, type ResetName } from '../shared/resets'
import { countTheRoom, removeEveryPiece, type RoomCounts } from '../infrastructure/shelving/furniture'
import { countErasing, countUnplacing, type ErasureCounts, type UnplaceCounts } from './placement-ledger'
import type { Db } from './driver'
import type { Store } from './store'
import { FURNITURE_LOCK } from '../application/locks'
import { refuse, type Refused } from './refusal'

export type ResetPlan =
  | { reset: 'unplace'; phrase: string; counts: UnplaceCounts }
  | { reset: 'history'; phrase: string; counts: ErasureCounts }
  | { reset: 'furniture'; phrase: string; counts: RoomCounts }

export async function planReset(db: Db, reset: ResetName): Promise<ResetPlan> {
  const phrase = RESET_PHRASES[reset]
  switch (reset) {
    case 'unplace': return { reset, phrase, counts: await countUnplacing(db) }
    case 'history': return { reset, phrase, counts: await countErasing(db) }
    case 'furniture': return { reset, phrase, counts: await countTheRoom(db) }
  }
}

export type ResetDone =
  | { ok: true; reset: 'unplace'; done: UnplaceCounts }
  | { ok: true; reset: 'history'; done: ErasureCounts }
  | { ok: true; reset: 'furniture'; done: RoomCounts }

/**
 * Refused with 400 unless `confirm` in the body is this reset's phrase, so a
 * stray POST, or one carrying another reset's phrase, changes nothing.
 */
export async function runReset(
  db: Db,
  store: Store,
  reset: ResetName,
  body: { confirm?: unknown },
): Promise<ResetDone | Refused> {
  if (!confirms(reset, body.confirm)) {
    return refuse(400, `Nothing was changed. Type "${RESET_PHRASES[reset]}" to do this.`)
  }

  switch (reset) {
    case 'unplace':
      return { ok: true, reset, done: await store.unplaceEveryBook() }
    case 'history':
      return { ok: true, reset, done: await store.eraseEveryPlacement() }
    case 'furniture': {
      const removed = await db.tx((tx) => removeEveryPiece(tx), { serialiseOn: FURNITURE_LOCK })
      if (!removed.ok) {
        return refuse(
          409,
          `${removed.history} placement ${removed.history === 1 ? 'row still names' : 'rows still name'} ` +
          'the furniture. Erase the placement history first.',
        )
      }
      return { ok: true, reset, done: removed.removed }
    }
  }
}
