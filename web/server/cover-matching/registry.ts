/**
 * The matchers the harness scores, and the floor each one is held to.
 *
 * A floor is what the matcher measured on `CI_SET` when it was recorded, less
 * a margin for the few grey levels glyph edges differ by between machines. A
 * matcher that falls below one has got worse, and `floors.test.ts` turns that
 * into a red check. Raise a floor when a matcher genuinely improves; lowering
 * one is a decision to accept a regression and belongs in a pull request that
 * says so.
 */

import { embeddingMatcher } from './embedding-matcher'
import { hashMatcher } from './hash-matcher'
import type { CoverMatcher } from './matcher'
import { CLIP_B32, DINOV2_SMALL, type Encoder } from './models'
import type { SetOptions } from './synthetic'

/** Small enough to generate inside one test file's budget, large enough that one photograph is under two points. */
export const CI_SET: SetOptions = { seed: 1, books: 40, photosPerBook: 2, absent: 10, severity: 1 }

export interface Floor {
  top1: number
  top4: number
  /** A ceiling rather than a floor: the most often it may open the wrong book. */
  confidentWrong: number
}

export interface Registered {
  matcher: CoverMatcher
  /** When set, the matcher needs these weights, and is skipped by the test where they are not cached. */
  encoder?: Encoder
  floor: Floor
}

export const REGISTERED: Registered[] = [
  {
    matcher: hashMatcher,
    floor: { top1: 0, top4: 0, confidentWrong: 0 },
  },
  {
    matcher: embeddingMatcher(DINOV2_SMALL, { floor: 0.8, margin: 0.05 }),
    encoder: DINOV2_SMALL,
    floor: { top1: 0, top4: 0, confidentWrong: 0 },
  },
  {
    matcher: embeddingMatcher(CLIP_B32, { floor: 0.9, margin: 0.03 }),
    encoder: CLIP_B32,
    floor: { top1: 0, top4: 0, confidentWrong: 0 },
  },
]
