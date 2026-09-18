/**
 * How this API says no, in one place.
 *
 * A malformed id answers 404, not 400: `/api/books/notanumber` names no book,
 * exactly as `/api/books/999999` names no book, and a client cannot act
 * differently on the two. It also stops a client typo being logged as a
 * fault of the server's.
 */

import type express from 'express'

/**
 * A refusal, with the status it deserves. 409 rather than 400 wherever the
 * request was well formed and the thing it names was not in a state to take
 * it: removing the only area on a piece, or changing a strategy without
 * having been shown what it does.
 */
export interface Refused {
  ok: false
  status: number
  error: string
  /** What the caller has to show somebody before asking again. */
  effect?: unknown
}

export const refuse = (status: number, error: string, effect?: unknown): Refused =>
  ({ ok: false, status, error, ...(effect === undefined ? {} : { effect }) })

/** A refusal, said the way every route here says one: `{ error }` and nothing else. */
export function refused(res: express.Response, result: Refused): void {
  res.status(result.status).json({
    error: result.error,
    ...(result.effect === undefined ? {} : { effect: result.effect }),
  })
}

/**
 * The id a request names, or the refusal a malformed one earns.
 *
 * Kept apart from `idIn` so the decision can be tested without a response to
 * write to.
 */
export function identifier(raw: unknown, missing: string): { ok: true; id: number } | Refused {
  const id = Number(raw)
  // Positive integers only: a row id is a `serial`, so 0, -3 and 1.5 name
  // nothing that can exist.
  return Number.isInteger(id) && id > 0 ? { ok: true, id } : refuse(404, missing)
}

/**
 * The id a request names, or null once the refusal has been answered.
 *
 * `raw` rather than the request, since some routes take their id from the
 * query string rather than the path.
 */
export function idIn(raw: unknown, res: express.Response, missing: string): number | null {
  const read = identifier(raw, missing)
  if (!read.ok) {
    refused(res, read)
    return null
  }
  return read.id
}
