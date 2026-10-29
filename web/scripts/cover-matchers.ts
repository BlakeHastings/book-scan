/**
 * Score every registered cover matcher on one labelled set and print the table.
 *
 * Run with: npx tsx scripts/cover-matchers.ts [options]   (or npm run eval:covers --)
 *
 *   --seed <n>         which synthetic set (default 1, the one the floors were recorded on)
 *   --books <n>        catalogued books (default 150)
 *   --photos <n>       photographs of each catalogued book (default 2)
 *   --absent <n>       books photographed that are not catalogued (default 30)
 *   --severity <0..1>  how rough the photographs are (default 1)
 *   --only <names>     comma separated: hash, dinov2-small, clip-b32
 *   --ci               the set and matchers the floor test uses, and nothing downloaded
 *   --sample <dir>     also write the first few covers and photographs to <dir>
 *   --real <n>         n real covers from Open Library instead of invented ones;
 *                      downloads to ~/.cache/bookscan/cover-eval, never run in CI
 *
 * Encoders are fetched on first use into ~/.cache/bookscan/models. Nothing here
 * reads or writes the catalogue, BOOKSCAN_DATA, or anything in the repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate, table, type Score } from '../server/cover-matching/evaluate'
import { CI_SET, REGISTERED } from '../server/cover-matching/registry'
import { realCovers, REAL_COVER_CACHE } from '../server/cover-matching/real-covers'
import { coverSet, photographed, type CoverSet } from '../server/cover-matching/synthetic'
import { isCached } from '../server/cover-matching/models'

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}
const flag = (name: string) => process.argv.includes(`--${name}`)
const number = (name: string, fallback: number) => Number(option(name) ?? fallback)

const ci = flag('ci')
const real = option('real')
const only = option('only')?.split(',')

const options = ci
  ? CI_SET
  : {
      seed: number('seed', 1),
      books: number('books', 150),
      photosPerBook: number('photos', 2),
      absent: number('absent', 30),
      severity: number('severity', 1),
    }

const started = performance.now()
let set: CoverSet
if (real) {
  const covers = await realCovers(Number(real))
  console.log(`${covers.length} real covers from Open Library, cached in ${REAL_COVER_CACHE}`)
  set = await photographed(covers, { ...options, absent: Math.min(options.absent, Math.floor(covers.length / 5)) })
} else {
  set = await coverSet(options)
}
const generated = performance.now()
console.log(`set: ${set.catalogue.length} catalogued, ${set.queries.length} photographs, seed ${options.seed}, `
  + `severity ${options.severity ?? 1}, made in ${((generated - started) / 1000).toFixed(1)}s`)

const sample = option('sample')
if (sample) {
  mkdirSync(sample, { recursive: true })
  for (const book of set.catalogue.slice(0, 6)) {
    writeFileSync(join(sample, `${book.id}-cover.jpg`), book.cover)
  }
  set.queries.slice(0, 18).forEach((query, n) => {
    writeFileSync(join(sample, `photo-${String(n).padStart(2, '0')}-of-${query.truth ?? 'uncatalogued'}.jpg`), query.photo)
  })
  console.log(`sample written to ${sample}`)
}

const chosen = REGISTERED.filter((entry) =>
  (!only || only.some((name) => entry.matcher.name.includes(name)))
  && (!ci || !entry.encoder || isCached(entry.encoder)))

const scores: Score[] = []
for (const entry of chosen) scores.push(await evaluate(entry.matcher, set))

console.log()
console.log(table(scores))
console.log()
for (const score of scores) {
  if (!score.wrongAtBar.length) continue
  console.log(`${score.matcher} opened the wrong book for:`)
  for (const wrong of score.wrongAtBar.slice(0, 10)) console.log(`  ${wrong.photographed}  ->  ${wrong.picked}`)
}
console.log(`\nwhole run ${((performance.now() - started) / 1000).toFixed(1)}s`)
