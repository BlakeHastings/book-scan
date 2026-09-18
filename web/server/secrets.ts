/**
 * The secrets this server reads, and the one name each is written in.
 *
 * The secret at rest is a DPAPI-encrypted file, written by
 * `scripts/write-connection-file.ps1` and decrypting only for the account
 * that wrote it, on that machine. What travels on a command line is the path
 * to that file, not the value. The launcher decrypts it into its own process
 * environment, which in PowerShell means that process and its children only;
 * nothing is persisted at User or Machine scope. This server reads it from
 * one variable, by one function, and consults nothing else, so an ambient
 * shell cannot decide what it does.
 *
 * Nothing in this file ever returns the value in something meant to be
 * displayed or logged. `googleBooksKeyConfigured` exists so a diagnostic can
 * say whether there is a key without going near what it is.
 */

/**
 * The Google Books API key, or empty.
 *
 * Empty is a supported state, not an error: a server with no catalogue
 * connection cannot do its job, but a server with no Google Books key can,
 * since Open Library does the real work and Google Books is a top-up. The
 * startup log says which state it is in.
 *
 * Trimmed, since a key pasted into a launcher with a trailing newline or a
 * stray space fails authentication and looks exactly like a key that was
 * never set.
 */
export function googleBooksApiKey(): string {
  return (process.env.GOOGLE_BOOKS_API_KEY ?? '').trim()
}

/**
 * Whether a Google Books key is configured. Never what it is.
 *
 * This is what reaches `/api/health` and the startup log. A boolean cannot
 * leak a key, where a length, a prefix or a masked form all can and all
 * invite the next person to widen them.
 */
export function googleBooksKeyConfigured(): boolean {
  return googleBooksApiKey().length > 0
}
