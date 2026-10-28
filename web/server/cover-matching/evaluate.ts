/**
 * Scoring a matcher on a labelled set, and printing the result as a table.
 *
 * Three numbers decide between matchers, and the third is the one that
 * matters most: a matcher that is better on average but more often opens the
 * wrong book without asking is worse.
 *
 *  - top-1: the right book is first, over photographs of catalogued books.
 *  - top-4: the right book is in the shortlist of four a person is shown.
 *  - confident-wrong: the matcher's own bar picked a book, and it was the
 *    wrong one, over every photograph including those of uncatalogued books.
 */

import type { CoverMatcher } from './matcher'
import type { CoverSet } from './synthetic'

export interface Score {
  matcher: string
  bar: string
  /** Photographs of catalogued books. */
  present: number
  /** Photographs of books the catalogue does not hold. */
  absent: number
  top1: number
  top4: number
  /** Share of all photographs where the bar picked the right book. */
  confidentRight: number
  /** Share of all photographs where the bar picked a wrong book, catalogued or not. */
  confidentWrong: number
  /** How many of the confident-wrong answers were to a book not in the catalogue. */
  confidentWrongAbsent: number
  prepareMs: number
  msPerQuery: number
  /** The titles of what it got wrong at the bar, for reading a failure back. */
  wrongAtBar: { photographed: string, picked: string }[]
}

export async function evaluate(matcher: CoverMatcher, set: CoverSet): Promise<Score> {
  const titles = new Map(set.catalogue.map((book) => [book.id, book.title]))

  const started = performance.now()
  const search = await matcher.prepare(set.catalogue)
  const prepareMs = performance.now() - started

  let present = 0
  let top1 = 0
  let top4 = 0
  let right = 0
  let wrong = 0
  let wrongAbsent = 0
  const wrongAtBar: Score['wrongAtBar'] = []

  const asking = performance.now()
  for (const query of set.queries) {
    const answer = await search(query.photo)
    const ranked = answer.candidates.map((candidate) => candidate.id)

    if (query.truth !== null) {
      present += 1
      if (ranked[0] === query.truth) top1 += 1
      if (ranked.slice(0, 4).includes(query.truth)) top4 += 1
    }

    if (answer.confident !== null) {
      if (answer.confident === query.truth) {
        right += 1
      } else {
        wrong += 1
        if (query.truth === null) wrongAbsent += 1
        wrongAtBar.push({ photographed: query.book, picked: titles.get(answer.confident) ?? answer.confident })
      }
    }
  }
  const total = set.queries.length

  return {
    matcher: matcher.name,
    bar: matcher.bar,
    present,
    absent: total - present,
    top1: present ? top1 / present : 0,
    top4: present ? top4 / present : 0,
    confidentRight: total ? right / total : 0,
    confidentWrong: total ? wrong / total : 0,
    confidentWrongAbsent: wrongAbsent,
    prepareMs,
    msPerQuery: total ? (performance.now() - asking) / total : 0,
    wrongAtBar,
  }
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

export function table(scores: readonly Score[]): string {
  const header = ['matcher', 'photos', 'top-1', 'top-4', 'confident right', 'confident wrong', 'prepare', 'per photo']
  const rows = scores.map((score) => [
    score.matcher,
    `${score.present}+${score.absent}`,
    percent(score.top1),
    percent(score.top4),
    percent(score.confidentRight),
    `${percent(score.confidentWrong)} (${score.confidentWrongAbsent} uncatalogued)`,
    `${(score.prepareMs / 1000).toFixed(1)}s`,
    `${score.msPerQuery.toFixed(0)}ms`,
  ])
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => row[i]!.length)))
  const line = (cells: string[]) => `| ${cells.map((cell, i) => cell.padEnd(widths[i]!)).join(' | ')} |`
  return [
    line(header),
    `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`,
    ...rows.map(line),
    '',
    'photos: of catalogued books + of books not in the catalogue. top-1 and top-4 are over the first;',
    'confident right and wrong are over all of them, each at the bar the matcher declares:',
    ...scores.map((score) => `  ${score.matcher}: ${score.bar}`),
  ].join('\n')
}
