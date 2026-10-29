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
import { coverTextMatcher } from './text-matcher'

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
  /** When set, the matcher keeps its catalogue in Postgres; see `catalogue-database.ts`. */
  database?: true
  floor: Floor
}

/*
 * Recorded on 2026-10-28 from `npm run eval:covers -- --ci` on Linux x64:
 *
 *   hash (today)              top-1  6.3%  top-4 16.3%  confident wrong 0.0%
 *   embedding (dinov2-small)  top-1 40.0%  top-4 80.0%  confident wrong 0.0%
 *   embedding (clip-b32)      top-1 90.0%  top-4 97.5%  confident wrong 0.0%
 *
 * One photograph is 1.25 points of top-1 here, so each floor sits four to
 * six photographs under what was measured, and each ceiling lets one
 * photograph through, which is the machine-to-machine wobble and not more.
 *
 * The embedding bars were chosen on seed 7, which no table reports, as the
 * loosest pair that opened no wrong book there with room to spare. DINOv2's
 * best cosine for a wrong book reached 0.80 there with a lead of up to 0.06,
 * so its bar is set past both and it is never confident on this set.
 */
const ONE_PHOTO_OF_CI_SET = 1 / 90

export const REGISTERED: Registered[] = [
  {
    matcher: hashMatcher,
    floor: { top1: 0.04, top4: 0.1, confidentWrong: ONE_PHOTO_OF_CI_SET },
  },
  {
    matcher: embeddingMatcher(DINOV2_SMALL, { floor: 0.85, margin: 0.08 }),
    encoder: DINOV2_SMALL,
    floor: { top1: 0.33, top4: 0.72, confidentWrong: ONE_PHOTO_OF_CI_SET },
  },
  {
    matcher: embeddingMatcher(CLIP_B32, { floor: 0.75, margin: 0.1 }),
    encoder: CLIP_B32,
    floor: { top1: 0.85, top4: 0.93, confidentWrong: ONE_PHOTO_OF_CI_SET },
  },
  /*
   * Recorded on 2026-10-29, the same way:
   *
   *   cover text (paddle, pg_trgm)  top-1 93.8%  top-4 96.3%  confident wrong 0.0%
   *
   * Floors five and five photographs under. The bar was chosen on seed 7 the
   * way the embeddings' were: there, a printed title of 0.8 with any lead
   * opened no wrong book, 0.7 opened one, and the 0.05 lead is the room.
   */
  {
    matcher: coverTextMatcher({ title: 0.8, margin: 0.05 }),
    database: true,
    floor: { top1: 0.87, top4: 0.9, confidentWrong: ONE_PHOTO_OF_CI_SET },
  },
]
