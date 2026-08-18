/**
 * The secrets this server reads, and the one name each of them is written in.
 *
 * There is exactly one of them here so far. The catalogue connection is the
 * other, and it stays in `db.pg.ts` next to the pool it opens, because the four
 * things that need it are all database tools. Both follow the same shape, and
 * the shape is the point of this file existing rather than a
 * `process.env.WHATEVER` at the call site:
 *
 * 1. **The secret at rest is a DPAPI-encrypted file.** It is written by
 *    `scripts/write-connection-file.ps1` and by nothing else, it lives at
 *    `%LOCALAPPDATA%\book-scan\backup-connections.json`, and it decrypts only
 *    for the account that wrote it, on that machine.
 * 2. **What travels on a command line is the path to that file.** A path costs
 *    nothing to show in a process listing or a scheduled task definition. See
 *    #215 for what happened when the values themselves travelled instead.
 * 3. **The launcher decrypts it and puts the value in its own process
 *    environment**, which in PowerShell means that process and its children and
 *    nothing else. Nothing is persisted at User or Machine scope.
 * 4. **This server reads it from one variable, by one function, and consults
 *    nothing else.** A second accepted spelling is a way for an ambient shell
 *    to decide what this process does.
 *
 * Nothing in this file ever returns the value in something meant to be
 * displayed or logged. `googleBooksKeyConfigured` exists so a diagnostic can
 * say whether there is a key without going anywhere near what it is.
 */

/**
 * The Google Books API key, or empty.
 *
 * `GOOGLE_BOOKS_API_KEY` and nothing else, for the reason `catalogueConnection`
 * reads one name and nothing else.
 *
 * **Empty is a supported state and not an error**, which is the one way this
 * differs from the connection. A server with no catalogue cannot do its job; a
 * server with no Google Books key can, because Open Library does the real work
 * and Google Books is a top-up. So this returns empty rather than throwing, and
 * the startup log says which state it is in. What must never happen again is the
 * third state: no key, requests going out anonymously into an exhausted shared
 * quota, and nothing anywhere saying so (#348).
 *
 * Trimmed, because a key pasted into a launcher with a trailing newline or a
 * stray space is a key that fails authentication and looks exactly like a key
 * that was never set.
 */
export function googleBooksApiKey(): string {
  return (process.env.GOOGLE_BOOKS_API_KEY ?? '').trim()
}

/**
 * Whether a Google Books key is configured. Never what it is.
 *
 * This is what reaches `/api/health` and the startup log. A boolean cannot leak
 * a key, where a length, a prefix or a masked form all can and all invite the
 * next person to widen them.
 */
export function googleBooksKeyConfigured(): boolean {
  return googleBooksApiKey().length > 0
}
