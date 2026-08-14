/**
 * How this API says no, in one place.
 *
 * There was already a good answer here and it was in the wrong file. The
 * furniture module (#302) returns a discriminated union rather than writing to
 * `res` itself, and one helper in `index.ts` renders it, so six routes refuse
 * the same way and every one of them answers a malformed id with a clean 404.
 * Every other route hand-rolled `res.status(404).json({ error })` and parsed its
 * id with a bare `Number(req.params.id)`, so `NaN` reached Postgres and came
 * back as a 500 with a stack trace in the log (`docs/api-review.md`, finding 2).
 *
 * Nineteen routes did that, and none of their authors was being careless. There
 * was nothing to copy: the union lived in a module about bookcases, and the
 * renderer was a local function inside `createApp`. So this file is the fix for
 * the shape rather than for the nineteen instances. **A route that needs an id
 * out of a request copies one line from here**, and the next route copies it
 * from the route above, which is how all nineteen came to exist in the first
 * place.
 *
 * ```ts
 * const id = idIn(req.params.id, res, 'No such book.')
 * if (id === null) return
 * ```
 *
 * ## Why a malformed id is 404 and not 400
 *
 * Because that is what the routes which already got it right answer, and
 * because it is the truth: `/api/books/notanumber` names no book, exactly as
 * `/api/books/999999` names no book, and a client cannot act differently on the
 * two. Splitting them would be a second thing to get right on every route for
 * no caller's benefit. It is also the answer that stops a client typo being
 * written to the server log as a fault of the server's.
 */

import type express from 'express'

/**
 * A refusal, with the status it deserves.
 *
 * 409 rather than 400 wherever the request was well formed and the thing it
 * names was not in a state to take it, which is every refusal the furniture
 * makes that a person can do something about: removing the only area on a
 * piece, or changing a strategy without having been shown what it does.
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
 * write to, and so a caller that already holds a `Refused` of its own can join
 * this to it.
 */
export function identifier(raw: unknown, missing: string): { ok: true; id: number } | Refused {
  const id = Number(raw)
  // Positive integers only. A row id is a `serial`, so 0, -3 and 1.5 name
  // nothing that can exist, and every one of them is a value Postgres would
  // either reject outright or answer emptily after a round trip.
  return Number.isInteger(id) && id > 0 ? { ok: true, id } : refuse(404, missing)
}

/**
 * The id a request names, or null once the refusal has been answered.
 *
 * **This is the line to copy.** `raw` rather than the request, because two
 * routes take their ids out of the query string rather than out of the path and
 * a helper that only reads `req.params.id` would send them back to `Number()`.
 */
export function idIn(raw: unknown, res: express.Response, missing: string): number | null {
  const read = identifier(raw, missing)
  if (!read.ok) {
    refused(res, read)
    return null
  }
  return read.id
}
