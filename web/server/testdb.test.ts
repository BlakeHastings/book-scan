/**
 * That no test file empties the catalogue by naming the tables it can think of.
 *
 * ## Why this is a test rather than a paragraph
 *
 * `AGENTS.md` has said since #343 that `openTestDatabase()` in a `beforeEach` is
 * the whole reset and that a file should not write its own. Twelve files wrote
 * their own anyway, and #529 was filed about six of them; the sweep that fixed
 * those found the other six standing beside them. Every one of those lists was
 * correct on the day it was typed and wrong by the time somebody read it.
 *
 * That is not carelessness, it is arithmetic. There are 32 migrations under
 * `infrastructure/db/migrations` today and there were 6 tables when the first
 * of these lists was written. **A list of tables is stale from the moment it is
 * written**, because the thing it has to agree with is a folder anybody may add
 * to, and nothing connects the two. The failure is silent in the direction that
 * matters: a list that has fallen behind breaks nothing until a test writes into
 * a table nobody listed, and then it breaks a *different* test, usually one
 * added months later by somebody who has no reason to look at the `beforeEach`.
 * #452 spent a pull request on exactly that and worked around it.
 *
 * So the argument lives here, where it is checked, rather than only in a
 * document where it can be true and unread.
 *
 * ## What is actually being asked
 *
 * Not "do not write `TRUNCATE`". A `TRUNCATE` or a `DELETE` inside a test is
 * ordinary: `backup.pg.test.ts` empties `books` mid-test to insert the same rows
 * in the other order, and that emptying *is* the test. What is refused is a
 * *reset*: a hook that runs before every test and puts the database back by
 * naming what to remove. `openTestDatabase()` puts it back by copying what the
 * schema left, so a table added by a migration is covered by having been added.
 *
 * ## What this would not have caught, said plainly
 *
 * It reads text, so it sees the shapes this repository has actually written and
 * not the idea behind them.
 *
 * - A reset extracted into a helper the hook merely calls is invisible here.
 *   The hook would read `await emptyEverything(db)` and this sweep would pass
 *   it. That is the obvious next site, and the honest answer is that a search of
 *   the source cannot find it; what would is asking a database what a hook left
 *   behind, which is a different instrument and would have to be added beside
 *   this one.
 * - A reset spelled some other way — `db.run(sql)` where `sql` is a constant
 *   defined above, an `UPDATE` that puts a column back, dropping a schema — is
 *   not in the two words below.
 * - It says nothing about a file that has no reset at all and needs one.
 *
 * It catches the shape that has gone wrong twelve times, which is worth having
 * even though it is not the whole idea.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/** `web/`, which is the whole of this project's TypeScript. */
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Neither is generated, and neither is anybody's test. */
const NOT_OURS = new Set(['node_modules', 'dist', 'dist-server', 'coverage', '.git'])

function everyTestFile(from: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(from)) {
    if (NOT_OURS.has(entry)) continue
    const path = join(from, entry)
    if (statSync(path).isDirectory()) found.push(...everyTestFile(path))
    else if (entry.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/**
 * The body of every `beforeEach` or `beforeAll` in a file.
 *
 * Line-based on purpose. A hook here opens on a line of its own and closes on a
 * line at the same indentation beginning with `}`, which is how every file in
 * this project is written and what Vitest's own examples look like. Where that
 * guess is wrong it runs past the end of the hook, which reports too much rather
 * than too little; a reset that hid because the scanner stopped early is the one
 * outcome worth ruling out.
 */
function everyResetHook(source: string): { line: number; body: string }[] {
  const lines = source.split('\n')
  const hooks: { line: number; body: string }[] = []

  for (let at = 0; at < lines.length; at += 1) {
    const opening = /^(\s*)(?:beforeEach|beforeAll)\(/.exec(lines[at]!)
    if (!opening) continue
    const indent = opening[1]!

    let end = at + 1
    while (end < lines.length && !new RegExp(`^${indent}\\}`).test(lines[end]!)) end += 1
    hooks.push({ line: at + 1, body: lines.slice(at, end + 1).join('\n') })
    at = end
  }
  return hooks
}

/** The two ways this repository has spelled "empty it again" in a hook. */
const EMPTYING = /\bTRUNCATE\b|\bDELETE\s+FROM\b/i

describe('how a test file gets a clean catalogue', () => {
  it('takes the reset from openTestDatabase rather than naming the tables', () => {
    const offenders: string[] = []

    for (const path of everyTestFile(ROOT)) {
      const source = readFileSync(path, 'utf8')
      for (const hook of everyResetHook(source)) {
        if (EMPTYING.test(hook.body)) {
          offenders.push(`${relative(ROOT, path).replace(/\\/g, '/')}:${hook.line}`)
        }
      }
    }

    expect(offenders, [
      'A `beforeEach` or `beforeAll` here empties the catalogue by naming tables.',
      '',
      'Use `openTestDatabase()` from `server/testdb.ts` instead. It copies every',
      'table when the file\'s database is made and puts every table back between',
      'tests, so a table a migration adds is covered by having been added and',
      'there is no list to keep in step.',
      '',
      'A list is not wrong because whoever wrote it was careless. There are 32',
      'migrations in this repository today and there will be more tomorrow, and',
      'nothing connects a folder anybody may add to with a string in a test file.',
      'Twelve files had one; every one of them had already fallen behind, and the',
      'first anybody knew of it was a test failing that had nothing to do with it.',
      '',
      'If the emptying is what a test is about rather than how it starts, put it',
      'in the test. See `backup.pg.test.ts`, which does.',
    ].join('\n')).toEqual([])
  })
})
