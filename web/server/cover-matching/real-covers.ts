/**
 * Real covers from Open Library, for running the harness locally on artwork
 * nobody designed to be easy. Only `scripts/cover-matchers.ts --real` calls
 * this, and no test does: it needs the network, and covers are copyrighted, so
 * they are cached under the user's home directory and never in the repository
 * or beside the catalogue.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Covered } from './synthetic'

export const REAL_COVER_CACHE = join(homedir(), '.cache', 'bookscan', 'cover-eval', 'openlibrary')

/** Open Library asks scripted clients to say who they are. */
const HEADERS = { 'User-Agent': 'book-scan cover matcher evaluation (github.com/BlakeHastings/book-scan)' }

interface Entry {
  title: string
  author: string
  coverId: number
}

/**
 * Subjects spread across what a home library holds, so the set is not one
 * genre's design conventions. Ordered by subject and then by Open Library's
 * own ranking, which is stable enough for a local measurement and is the
 * reason the manifest is cached: a second run reads the same books.
 */
const SUBJECTS = ['fantasy', 'science_fiction', 'mystery', 'romance', 'history', 'biography', 'poetry', 'cooking', 'children', 'philosophy']

async function manifest(count: number): Promise<Entry[]> {
  const path = join(REAL_COVER_CACHE, `manifest-${count}.json`)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Entry[]

  const perSubject = Math.ceil(count / SUBJECTS.length)
  const entries: Entry[] = []
  const seen = new Set<number>()
  for (const subject of SUBJECTS) {
    const url = `https://openlibrary.org/subjects/${subject}.json?limit=${perSubject * 2}`
    const response = await fetch(url, { headers: HEADERS })
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`)
    const body = await response.json() as { works?: { title?: string, cover_id?: number, authors?: { name?: string }[] }[] }
    let taken = 0
    for (const work of body.works ?? []) {
      if (taken >= perSubject || !work.cover_id || !work.title || seen.has(work.cover_id)) continue
      seen.add(work.cover_id)
      entries.push({ title: work.title, author: work.authors?.[0]?.name ?? '', coverId: work.cover_id })
      taken += 1
    }
  }
  const chosen = entries.slice(0, count)
  writeFileSync(path, JSON.stringify(chosen, null, 2))
  return chosen
}

/** `count` real covers, downloaded once and read from the cache after that. */
export async function realCovers(count: number): Promise<Covered[]> {
  mkdirSync(REAL_COVER_CACHE, { recursive: true })
  const books: Covered[] = []
  for (const entry of await manifest(count)) {
    const path = join(REAL_COVER_CACHE, `${entry.coverId}-M.jpg`)
    if (!existsSync(path)) {
      // By cover id, which the covers API does not rate limit the way it
      // limits lookups by ISBN; the pause is courtesy rather than a limit.
      const response = await fetch(`https://covers.openlibrary.org/b/id/${entry.coverId}-M.jpg`, { headers: HEADERS })
      if (!response.ok) continue
      writeFileSync(path, Buffer.from(await response.arrayBuffer()))
      await new Promise((done) => setTimeout(done, 150))
    }
    books.push({ title: entry.title, author: entry.author, cover: readFileSync(path) })
  }
  return books
}
