/**
 * One request to somebody else's catalogue, with a bound on it and a
 * vocabulary for what it did.
 *
 * Every request this process makes to a catalogue goes through here: there
 * is no code path that reaches `fetch` with no `AbortController` behind it.
 *
 * The string on `why` reaches `/api/health` and the log, and
 * `source-watch.ts` checks it against a closed vocabulary, so a second
 * helper with its own idea of what a reason looks like would read as a
 * report going vague exactly where it needs to be specific.
 */

/**
 * What came back from one request: three outcomes, not two. `data` null
 * while `answered` is true is the ordinary case: the catalogue replied and
 * has nothing about this book. `answered` false is the catalogue not
 * replying at all, which is not the same thing.
 */
export interface Answer<T = unknown> {
  /** True when the catalogue replied, whatever it said. */
  answered: boolean
  /** What it said, parsed, or null when it said nothing usable. */
  data: T | null
  /**
   * Why it did not reply, from the closed vocabulary `source-watch.ts` accepts.
   *
   * Built from the status code and nothing else, deliberately: a Google
   * Books request carries the API key in its query string, so a reason built
   * from the error, response or URL would leak the key into `/api/health`
   * and the log.
   */
  why: string
}

/** What the caller wants back, which decides both the Accept header and the parse. */
export type Wanted = 'json' | 'text'

/**
 * Ask one URL, give up after `timeoutMs`, and say which of the three happened.
 *
 * @param url the endpoint, without the query
 * @param params appended as the query string
 * @param timeoutMs how long before this process stops waiting
 * @param wanted JSON for the two book APIs, text for the two SRU catalogues,
 *   which answer MARCXML and have no JSON form
 */
export async function fetchBounded(
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
  wanted: Wanted = 'json',
): Promise<Answer> {
  const target = new URL(url)
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: wanted === 'json' ? 'application/json' : 'application/xml, text/xml',
      },
      signal: controller.signal,
    })
    // 404 counts as the catalogue answering: none of these endpoints uses it
    // for a missing book, but one that did would be stating an absence, not
    // failing.
    if (!response.ok) {
      return { answered: response.status === 404, data: null, why: `HTTP ${response.status}` }
    }
    return {
      answered: true,
      data: wanted === 'json' ? await response.json() : await response.text(),
      why: '',
    }
  } catch (error) {
    /*
     * An abort is this process giving up on a catalogue that was too slow;
     * anything else is the request never completing, which is DNS, TLS, a
     * refused connection, or an unexpected body.
     */
    const aborted = error instanceof Error && error.name === 'AbortError'
    return { answered: false, data: null, why: aborted ? 'timed out' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Who is asking, said once for every catalogue. Open Library's documented
 * anonymous rate is one request a second and it raises that for a caller who
 * names an application. Nothing here identifies a person, only the
 * application and what it is for.
 */
export const USER_AGENT = 'book-scan-web/0.1 (personal library cataloguing)'
