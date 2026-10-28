/**
 * The registrations `/register` lets anybody write are cleared away once a day
 * has passed and nobody approved them, and nothing a person did is.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { closeTestDatabase, openTestDatabase } from '../testdb'
import type { Db } from '../driver'
import { signedIn } from '../testauth'
import { OAuthStore } from '../../infrastructure/auth/oauth-store'
import { keepSweeping, SWEEP_EVERY_MINUTES, SWEEP_WORK, sweepOnce, UNCLAIMED_AFTER_HOURS } from './sweep'

const HOUR = 3_600_000
const NOW = new Date('2026-10-28T12:00:00.000Z')
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR)

let db: Db
let oauth: OAuthStore

beforeEach(async () => {
  db = await openTestDatabase()
  oauth = new OAuthStore(db)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await closeTestDatabase()
})

async function client(registered: Date): Promise<string> {
  const id = randomUUID()
  await oauth.registerClient(id, JSON.stringify({ client_id: id, client_name: 'a client' }), registered)
  return id
}

async function approve(clientId: string, userId: string, when: Date): Promise<string> {
  const id = randomUUID()
  await oauth.openGrant({
    id, clientId, userId,
    resource: 'https://example.invalid/mcp',
    redirectUri: 'https://example.invalid/callback',
    codeHash: randomUUID(),
    codeChallenge: 'challenge',
  }, when)
  return id
}

async function remaining(): Promise<string[]> {
  const rows = await db.all<{ client_id: string }>('select client_id from oauth_client order by client_id')
  return rows.map((row) => row.client_id)
}

describe('sweeping client registrations nobody approved', () => {
  it('removes one older than a day with no grant, and keeps one younger', async () => {
    const stale = await client(ago(UNCLAIMED_AFTER_HOURS + 1))
    const fresh = await client(ago(UNCLAIMED_AFTER_HOURS - 1))

    expect(await sweepOnce(oauth, NOW)).toBe(1)

    const left = await remaining()
    expect(left).toContain(fresh)
    expect(left).not.toContain(stale)
  })

  it('keeps an old one somebody approved, and one whose approval was since revoked', async () => {
    const { userId } = await signedIn(db)
    const connected = await client(ago(24 * 30))
    await approve(connected, userId, ago(24 * 29))
    const disconnected = await client(ago(24 * 30))
    const grant = await approve(disconnected, userId, ago(24 * 29))
    expect(await oauth.revokeGrant(grant, userId, ago(24))).toBe(true)

    expect(await sweepOnce(oauth, NOW)).toBe(0)
    expect(await remaining()).toEqual([connected, disconnected].sort())
  })

  it('keeps an old one whose consent page is open right now, so the person reading it is not told it expired', async () => {
    const { userId } = await signedIn(db)
    const asking = await client(ago(48))
    const consent = {
      sessionHash: 's', userId, clientId: asking,
      redirectUri: 'https://example.invalid/callback', codeChallenge: 'c', state: '',
      resource: 'https://example.invalid/mcp',
    }
    await oauth.openConsent({ ...consent, tokenHash: 'open' }, new Date(NOW.getTime() - 60_000))

    expect(await sweepOnce(oauth, NOW)).toBe(0)

    // Once that page has expired unanswered, nothing is waiting on the client.
    expect(await sweepOnce(oauth, new Date(NOW.getTime() + HOUR))).toBe(1)
    expect(await remaining()).toEqual([])
  })

  it('says what it removed', async () => {
    const said = vi.spyOn(console, 'log').mockImplementation(() => {})
    await client(ago(48))
    await client(ago(48))
    await sweepOnce(oauth, NOW)
    expect(said).toHaveBeenCalledWith(expect.stringContaining('swept 2 client registrations'))
  })

  it('runs at once, then on an interval, every run handed to the background owner by name', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] })
    const stale = await client(ago(48))
    const handed: Array<{ work: Promise<unknown>; what: string }> = []
    let clock = NOW

    keepSweeping({ db, background: (work, what) => handed.push({ work, what }), now: () => clock })

    expect(handed).toHaveLength(1)
    expect(handed[0]?.what).toBe(SWEEP_WORK)
    expect(await handed[0]?.work).toBe(1)
    expect(await remaining()).not.toContain(stale)

    const later = await client(ago(48))
    clock = new Date(NOW.getTime() + SWEEP_EVERY_MINUTES * 60_000)
    vi.advanceTimersByTime(SWEEP_EVERY_MINUTES * 60_000)

    expect(handed).toHaveLength(2)
    expect(await handed[1]?.work).toBe(1)
    expect(await remaining()).not.toContain(later)
  })
})
