/**
 * The image models' weights, for CI's cache.
 *
 *   npx tsx scripts/cover-models.ts key     prints key=<one cache key for every pinned encoder>
 *   npx tsx scripts/cover-models.ts fetch   fetches whatever is missing and checks every SHA-256
 *
 * The key is made of each encoder's revision and digest as `models.ts` pins
 * them, so pinning a new revision is a cache miss and nothing else is. Writes
 * only under ~/.cache/bookscan/models: never the repository, never
 * BOOKSCAN_DATA, never a catalogue.
 */

import { ENCODERS, MODEL_CACHE, cachedPath, ensureModel, isCached } from '../server/cover-matching/models'

const command = process.argv[2]

if (command === 'key') {
  console.log(`key=cover-models-${ENCODERS.map((encoder) => `${encoder.name}-${encoder.revision}-${encoder.sha256}`).join('_')}`)
} else if (command === 'fetch') {
  for (const encoder of ENCODERS) {
    const had = isCached(encoder)
    const started = performance.now()
    await ensureModel(encoder, { verify: true })
    console.log(
      `${encoder.name}: ${had ? 'cached' : 'fetched'}, SHA-256 ${encoder.sha256} checked, ` +
      `${cachedPath(encoder)} (${Math.round(performance.now() - started)} ms)`,
    )
  }
  console.log(`every pinned encoder is in ${MODEL_CACHE}`)
} else {
  console.error('Usage: npx tsx scripts/cover-models.ts key|fetch')
  process.exitCode = 2
}
