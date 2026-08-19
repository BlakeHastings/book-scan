/**
 * One request to somebody else's catalogue, with a bound on it and a vocabulary
 * for what it did.
 *
 * Lifted out of `lookup.ts` by #305, unchanged in behaviour, because a second
 * pair of catalogues now needs the same thing and the two must not drift. The
 * reason they must not is `source-watch.ts`: the string on `why` reaches
 * `/api/health` and the log, and that file checks it against a closed
 * vocabulary rather than trusting it. A second helper with its own idea of what
 * "timed out" reads like would be a reason silently rewritten to
 * "did not answer" at the far end, which is the report going vague exactly where
 * it was built to be specific.
 *
 * **Every request made from this process to a catalogue goes through here**, and
 * that is what #299 asked for: a reader with no bound on it is a dependency that
 * can hang, and #305 adds two more sources that could. There is no code path
 * that reaches `fetch` with no `AbortController` behind it.
 */

/**
 * What came back from one request, which is three outcomes and not two (#348).
 *
 * `data` being null while `answered` is true is the ordinary case: the
 * catalogue replied and has nothing about this book. `answered` being false is
 * the catalogue not replying at all, which until #348 was the same `null` and
 * so was indistinguishable from it.
 */
export interface Answer<T = unknown> {
  /** True when the catalogue replied, whatever it said. */
  answered: boolean
  /** What it said, parsed, or null when it said nothing usable. */
  data: T | null
  /**
   * Why it did not reply, from the closed vocabulary `source-watch.ts` accepts.
   *
   * **Built from the status code and nothing else, deliberately.** A Google
   * Books request carries the API key in its query string, so a reason made by
   * stringifying the error, the response or the URL would carry the key into
   * `/api/health` and into the log. Do not widen this to the response body
   * either: it is somebody else's text and it reaches a diagnostic.
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
    // 404 is the catalogue answering. None of these endpoints uses it for a
    // book it does not hold, but a source that did would be stating an absence
    // rather than failing, so it is not counted as silence either way.
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
     * Two shapes reach here and they mean different things to whoever reads the
     * report. An abort is this process giving up on a catalogue that was too
     * slow; anything else is the request never completing at all, which is DNS,
     * TLS, a refused connection or a body that was not what was asked for.
     * Neither carries anything from the error itself, for the reason on `why`.
     */
    const aborted = error instanceof Error && error.name === 'AbortError'
    return { answered: false, data: null, why: aborted ? 'timed out' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Who is asking, said once for every catalogue.
 *
 * Open Library's documented anonymous rate is one request a second and it
 * raises that for a caller who names an application; the Wikidata policy the
 * measurement in `docs/catalogue-sources.md` looked at requires a descriptive
 * one outright. Nothing here identifies a person: it names the application and
 * what it is for, which is what the terms ask for and is the whole of what they
 * ask for.
 */
export const USER_AGENT = 'book-scan-web/0.1 (personal library cataloguing)'
