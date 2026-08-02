/**
 * Queue behaviour, with the two-person cases front and centre. The claim
 * logic is the part that stops both people filling in the same book.
 */

import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { CaptureQueue } from './queue'
import { Store } from './store'

let queue: CaptureQueue
let store: Store
let db: Database

beforeEach(() => {
  db = openDatabase(':memory:')
  store = new Store(db)
  // No image reader: these tests never run the worker.
  queue = new CaptureQueue(db, () => null)
})

function add() {
  return queue.add({ front: 'f.jpg', back: 'b.jpg', edge: 'e.jpg' })
}

/** A real book, because captures.book_id is a foreign key. */
function addBook() {
  return store.addBook({ title: 'A Book', authors: ['Ann Author'], isFiction: true }).id
}

describe('queueing', () => {
  it('accepts a capture as pending so the camera never waits', () => {
    const capture = add()
    expect(capture.status).toBe('pending')
    expect(capture.back_image).toBe('b.jpg')
  })

  it('counts by status', () => {
    add()
    add()
    expect(queue.counts().pending).toBe(2)
    expect(queue.counts().ready).toBe(0)
  })

  it('keeps done captures out of the working list', () => {
    const capture = add()
    const bookId = addBook()
    queue.markDone(capture.id, bookId)
    expect(queue.list()).toHaveLength(0)
    expect(queue.get(capture.id)?.book_id).toBe(bookId)
  })
})

describe('claiming, with two people on the same queue', () => {
  it('lets the first person claim', () => {
    const capture = add()
    expect(queue.claim(capture.id, 'alice').ok).toBe(true)
  })

  it('refuses a second person and names who holds it', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    const second = queue.claim(capture.id, 'bob')
    expect(second.ok).toBe(false)
    expect(second.heldBy).toBe('alice')
  })

  it('lets the same person reclaim after a refresh', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    expect(queue.claim(capture.id, 'alice').ok).toBe(true)
  })

  it('frees the capture when released', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    queue.release(capture.id, 'alice')
    expect(queue.claim(capture.id, 'bob').ok).toBe(true)
  })

  it('ignores a release from someone who does not hold it', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')
    queue.release(capture.id, 'bob')
    expect(queue.claim(capture.id, 'bob').ok).toBe(false)
  })

  it('expires a stale claim so a walked-away lease cannot block forever', () => {
    const capture = add()
    queue.claim(capture.id, 'alice')

    // Backdate the claim past the lease window.
    db.prepare('UPDATE captures SET claimed_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), capture.id)

    expect(queue.claim(capture.id, 'bob').ok).toBe(true)
  })

  it('will not claim a capture that is already shelved', () => {
    const capture = add()
    queue.markDone(capture.id, addBook())
    expect(queue.claim(capture.id, 'alice').ok).toBe(false)
  })
})
