/**
 * The four maintenance tools that write rows must take their catalogue from
 * `--target` and never from the environment the app runs in. The variable is
 * set here, to a server nobody is listening on, because the defect is a tool
 * that reads it: with it unset, a tool falling back to it would refuse for the
 * wrong reason and pass.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeTestDatabase, openTestDatabase, testDatabaseUrl } from './testdb'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { main as refileBooks } from './refile-books'
import { main as cropBooks } from './crop-books'
import { main as cropCaptures } from './crop-captures'
import { main as rehashCovers } from './rehash-covers'

const tools = [
  ['refile-books', refileBooks],
  ['crop-books', cropBooks],
  ['crop-captures', cropCaptures],
  ['rehash-covers', rehashCovers],
] as const

/** Port 1 on loopback: nothing answers, so even a tool that reached for it writes nothing. */
const IN_THE_ENVIRONMENT = 'postgres://nobody:nothing@127.0.0.1:1/the_app_catalogue'

const saved = {
  connection: process.env.ConnectionStrings__bookscan,
  data: process.env.BOOKSCAN_DATA,
}
let scratch: string | undefined
let said: string[]

beforeAll(async () => {
  await openTestDatabase()
  scratch = scratchRoot('write-tools')
  // Each photograph tool reads a directory as well; an empty one of this file's
  // own keeps the dry runs below from looking under web/data.
  process.env.BOOKSCAN_DATA = scratch
  process.env.ConnectionStrings__bookscan = IN_THE_ENVIRONMENT
})

afterAll(async () => {
  for (const [name, value] of [
    ['ConnectionStrings__bookscan', saved.connection],
    ['BOOKSCAN_DATA', saved.data],
  ] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  removeScratchRoot(scratch)
  await closeTestDatabase()
})

beforeEach(() => {
  said = []
  const hear = (...parts: unknown[]) => { said.push(parts.map(String).join(' ')) }
  vi.spyOn(console, 'log').mockImplementation(hear)
  vi.spyOn(console, 'error').mockImplementation(hear)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(tools)('%s', (_name, run) => {
  it('refuses to start with no --target, even with the app\'s variable set', async () => {
    expect(await run([])).toBe(2)

    const output = said.join('\n')
    expect(output).toContain('No --target')
    expect(output).not.toContain('the_app_catalogue')
  })

  it('refuses a --target with no value after it', async () => {
    expect(await run(['--target'])).toBe(2)
    expect(await run(['--target', '--apply'])).toBe(2)
    expect(said.join('\n')).not.toContain('the_app_catalogue')
  })

  it('opens the catalogue it was given, not the one in the environment', async () => {
    expect(await run(['--target', testDatabaseUrl()])).toBe(0)

    const output = said.join('\n')
    expect(output).toContain(new URL(testDatabaseUrl()).pathname)
    expect(output).toContain('DRY RUN')
    expect(output).not.toContain('the_app_catalogue')
  })
})
