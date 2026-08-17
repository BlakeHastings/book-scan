/**
 * What `/api/backup` answers, over real HTTP (#311).
 *
 * `backup-watch.test.ts` beside this one is where the check itself is put
 * through its cases. What is here is the wiring, and there are two things in it
 * worth a real request rather than a direct call:
 *
 * 1. **An app given no directory claims nothing.** That is every test, every
 *    development checkout and every end to end run, and it is the state the
 *    AppHost sets explicitly so an inherited variable cannot change it. A
 *    regression here would not be visible as a failure: it would be visible as
 *    an alarm on somebody's scratch catalogue, which is how an alarm stops
 *    being read.
 * 2. **A directory reaches the answer.** The route is three lines and all three
 *    of them are the wiring, so a test that called `watchBackups` directly would
 *    prove nothing about whether the option is passed at all.
 *
 * The harness is `refusal.routes.test.ts`'s, minus the catalogue stubs, which
 * this needs none of: no route here looks at a book.
 */

import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeScratchRoot, scratchRoot } from './scratchdir'
import { closeScratchDatabases, migratedDatabase } from '../infrastructure/db/testdb'
import { PgDb } from './db.pg'
import { dumpFileName, manifestFileName } from './backup'
import { createApp, type BookScanApp } from './index'

let pool: pg.Pool
let db: PgDb
let scratch: string
const running: Array<{ app: BookScanApp; server: Server }> = []

beforeAll(async () => {
  pool = await migratedDatabase()
  db = new PgDb(pool)
  scratch = scratchRoot('backup-routes')
})

afterAll(async () => {
  for (const one of running) {
    await one.app.settled()
    await new Promise<void>((resolve, reject) => {
      one.server.close((error) => (error ? reject(error) : resolve()))
    })
  }
  await closeScratchDatabases()
  removeScratchRoot(scratch)
  running.length = 0
})

/** An app watching `backupDir`, listening, and its base URL. */
async function serving(backupDir?: string): Promise<string> {
  const coverDir = mkdtempSync(join(scratch, 'covers-'))
  const app = createApp({ db, coverDir, startBackgroundWork: false, backupDir })
  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  running.push({ app, server })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('GET /api/backup', () => {
  it('claims nothing when the app was given no directory', async () => {
    const base = await serving()
    const answer = await (await fetch(`${base}/api/backup`)).json()

    expect(answer.state).toBe('unwatched')
    expect(answer.where).toBe('')
  })

  it('reads the directory it was given, and finds a proved backup in it', async () => {
    const dir = mkdtempSync(join(scratch, 'backups-'))
    const name = dumpFileName(new Date())
    writeFileSync(join(dir, name), 'not a real dump')
    writeFileSync(join(dir, manifestFileName(name)), JSON.stringify({
      dump: name,
      verified: { at: new Date().toISOString(), ok: true, scratch: 'bookscan_verify_0', differences: [] },
    }))

    const base = await serving(dir)
    const answer = await (await fetch(`${base}/api/backup`)).json()

    expect(answer.state).toBe('fresh')
    expect(answer.verified.dump).toBe(name)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not pass a directory that is not there', async () => {
    const base = await serving(join(scratch, 'a-disk-that-is-not-plugged-in'))
    const answer = await (await fetch(`${base}/api/backup`)).json()

    expect(answer.state).toBe('unreachable')
    expect(answer.state).not.toBe('fresh')
  })
})
