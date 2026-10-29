/**
 * How long a claim on a queued capture holds before someone else may take it.
 * The server enforces it; the queue list reads it to tell a phone working a book
 * now from a claim somebody walked away from.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000
