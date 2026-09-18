/**
 * Must not resort the list, since newest first is what makes the top of the screen the book on
 * top of the pile, and must not assume a capture has a title, since one stays blank until a
 * lookup resolves.
 */

import { describe, expect, it } from 'vitest'
import { filterQueue, matchesQuery } from './queueSearch'
import type { Capture, LookupResponse } from './api'
import { FICTION_SLUG } from '../../domain/tagging/catalogue-claims'

/** A capture the worker has resolved, which is where a title comes from. */
function found(id: number, title: string, authors: string[]): Capture {
  const lookup: Partial<LookupResponse> = {
    found: true,
    isbn13: '',
    isbn10: '',
    title,
    subtitle: '',
    authors,
    publisher: '',
    published: '',
    pages: '',
    seriesName: '',
    seriesIndex: null,
    coverUrl: '',
    source: 'openlibrary',
    classification: { genre: FICTION_SLUG, confidence: 'high', reason: '' },
    notes: [],
    duplicateOf: null,
  }
  return blank(id, { draft_json: JSON.stringify(lookup) })
}

function blank(id: number, over: Partial<Capture> = {}): Capture {
  return {
    id,
    status: 'ready',
    front_image: '',
    back_image: '',
    edge_image: '',
    isbn13: '',
    isbn10: '',
    isbn_source: '',
    title_guess: '',
    cover_text: '',
    analysed: '',
    draft_json: '',
    edit_json: '',
    edited_by: '',
    edited_at: null,
    note: '',
    claimed_by: '',
    claimed_at: null,
    book_id: null,
    created_at: '',
    processed_at: null,
    front_crop: '',
    back_crop: '',
    edge_crop: '',
    cropped: '',
    ...over,
  }
}

const dune = found(9, 'Dune', ['Frank Herbert'])
const dispossessed = found(8, 'The Dispossessed', ['Ursula K. Le Guin'])
const solaris = found(7, 'Solaris', ['Stanisław Lem'])
/* Photographed, not yet read. This is most of the queue, most of the time. */
const unread = blank(6)

const queue = [dune, dispossessed, solaris, unread]

describe('matching a capture against what was typed', () => {
  it('matches on the title', () => {
    expect(matchesQuery(dune, 'dune')).toBe(true)
    expect(matchesQuery(dispossessed, 'dispossessed')).toBe(true)
  })

  it('matches on the author, where one is known', () => {
    expect(matchesQuery(dune, 'herbert')).toBe(true)
    expect(matchesQuery(dispossessed, 'le guin')).toBe(true)
  })

  it('does not care about case', () => {
    expect(matchesQuery(dune, 'DUNE')).toBe(true)
  })

  /* A phone keyboard will not produce "Stanisław" and nobody working through a pile is going to try. */
  it('does not care about accents in either direction', () => {
    expect(matchesQuery(solaris, 'lem')).toBe(true)
    expect(matchesQuery(solaris, 'stanislaw')).toBe(true)
    expect(matchesQuery(solaris, 'stanisław')).toBe(true)
  })

  it('takes the words in any order, so title and author can be mixed', () => {
    expect(matchesQuery(dune, 'herbert dune')).toBe(true)
    expect(matchesQuery(dune, 'dune herbert')).toBe(true)
  })

  it('needs every word, so a second word narrows rather than widens', () => {
    expect(matchesQuery(dune, 'dune leguin')).toBe(false)
  })

  it('matches nothing it was not asked about', () => {
    expect(matchesQuery(dune, 'solaris')).toBe(false)
  })

  it('does not assume a capture has a title yet', () => {
    expect(matchesQuery(unread, 'dune')).toBe(false)
    expect(matchesQuery(unread, '')).toBe(true)
  })

  /* The guess is the name the row is drawn under, so search must find it there. */
  it('finds a capture by the guess its row is named after', () => {
    const guessed = blank(5, { title_guess: 'S0NG 0F SOLOMQN' })
    expect(matchesQuery(guessed, 'solomqn')).toBe(true)
    expect(matchesQuery(guessed, 'dune')).toBe(false)
  })
})

describe('narrowing the queue', () => {
  it('restores the whole queue when the box is cleared', () => {
    expect(filterQueue(queue, '')).toEqual(queue)
    expect(filterQueue(queue, '   ')).toEqual(queue)
  })

  it('narrows to what matches', () => {
    expect(filterQueue(queue, 'dune').map((c) => c.id)).toEqual([9])
  })

  it('hands back nothing when nothing matches, rather than everything', () => {
    expect(filterQueue(queue, 'zzzz')).toEqual([])
  })

  it('leaves the order exactly as it was given', () => {
    expect(filterQueue([dune, dispossessed, solaris], 'e').map((c) => c.id))
      .toEqual([9, 8, 7])
  })

  it('does not sort a list that arrives in some other order', () => {
    expect(filterQueue([solaris, dispossessed, dune], 'e').map((c) => c.id))
      .toEqual([7, 8, 9])
  })

  it('hands back the same array when there is nothing to filter', () => {
    // Not a micro-optimisation: an identity-stable list is what stops the
    // pane's return-anchor effect from re-running on every keystroke.
    expect(filterQueue(queue, '')).toBe(queue)
  })
})
