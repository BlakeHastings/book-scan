/**
 * No test file empties the catalogue by naming its own tables in a
 * `beforeEach` or `beforeAll`; see AGENTS.md for why `openTestDatabase()` is
 * the required reset.
 *
 * This is a line-based text scan, not a semantic one: a reset extracted into
 * a helper function, or spelled some other way than TRUNCATE or DELETE, is
 * invisible to it. It catches the one shape that has gone wrong repeatedly,
 * not the whole idea.
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
 * Line-based on purpose: a hook opens on a line of its own and closes on a
 * line at the same indentation beginning with `}`. Where that guess is
 * wrong it runs past the end of the hook, reporting too much rather than too
 * little, since a reset that hid because the scanner stopped early is the
 * one outcome worth ruling out.
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
