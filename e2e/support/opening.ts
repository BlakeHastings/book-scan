/**
 * Opening the app, not mistaking the machine for it.
 *
 * Starting or stopping a Docker container (this repository's own AppHost, or
 * another checkout's, since several agents can share a machine) briefly
 * changes the host's network configuration, and Chromium abandons every
 * request in flight with `net::ERR_NETWORK_CHANGED` or
 * `net::ERR_NETWORK_IO_SUSPENDED`. That reads as a broken page, not as a
 * network blip.
 *
 * This waits for either the screen the caller is about to assert on, or the
 * browser reporting one of those two errors, and reloads only for the second.
 * A genuinely broken app produces neither error, so the caller's own assertion
 * still fails with its own words.
 */

import type { Locator, Page, Request } from '@playwright/test'

/**
 * The errors that mean "the host's network moved", and nothing else.
 *
 * Deliberately narrow: everything else the network layer can say (refused,
 * reset, timed out, name not resolved) is something about the app or the
 * server, and reloading for one of those would wave through a real failure.
 */
const THE_MACHINE_MOVED = /net::ERR_NETWORK_CHANGED|net::ERR_NETWORK_IO_SUSPENDED/

/**
 * How many times the page is loaded again before giving up. One interface
 * event during a page load is ordinary where agents share a machine, three in
 * a row is not something to keep trying through.
 */
const RELOADS = 2

/**
 * The same timeout `playwright.config.ts` gives an assertion, because this
 * waits for the same thing the caller's next line does.
 */
const TO_DRAW = 30_000

/**
 * Load the page and wait for the screen the caller is about to assert on.
 *
 * `ready` is passed in rather than guessed at, so this waits for what the step
 * actually needs instead of for a root element having children.
 *
 * Makes no claim of its own: if `ready` never appears and the browser never
 * said the network moved, this returns and the caller's own assertion reports
 * what is wrong.
 */
export async function openTheApp(page: Page, url: string, ready: Locator): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const lost: string[] = []
    let sayItMoved = (): void => {}
    const moved = new Promise<'moved'>((resolve) => {
      sayItMoved = () => resolve('moved')
    })
    const watch = (request: Request) => {
      const said = request.failure()?.errorText ?? ''
      if (!THE_MACHINE_MOVED.test(said)) return
      lost.push(`${said} ${request.url()}`)
      sayItMoved()
    }
    page.on('requestfailed', watch)

    try {
      /*
       * `reload` rather than `goto` on the way round again: navigating to a URL
       * that differs from the current one only by its fragment is a
       * same-document navigation and would fetch nothing, leaving the broken
       * page in place.
       */
      const onTheApp = page.url().startsWith(new URL(url).origin)
      await (attempt > 0 && onTheApp ? page.reload() : page.goto(url))
      const drawn = ready.first()
        .waitFor({ state: 'visible', timeout: TO_DRAW })
        .then(() => 'drawn' as const)
        // Swallowed on purpose: the caller's own assertion on this same screen
        // is the failure worth reading.
        .catch(() => 'gave up' as const)
      if (await Promise.race([drawn, moved]) !== 'moved') return
    } catch (error) {
      /*
       * Losing the document itself throws out of the navigation instead,
       * worded by Playwright as an interruption rather than the network error
       * underneath, a sentence equally true of a server that has died. So the
       * browser's own `requestfailed` event is waited for, briefly: its
       * rejection can arrive before that event does.
       */
      if (!lost.length) {
        await Promise.race([moved, page.waitForTimeout(1_000)])
      }
      if (!lost.length) throw error
    } finally {
      page.off('requestfailed', watch)
    }

    if (attempt >= RELOADS) {
      throw new Error(
        `Loading ${url} was abandoned ${attempt + 1} times because this machine ` +
        'changed its network configuration mid-load. That is Docker, usually ' +
        "another checkout's AppHost starting or stopping: a container brings a " +
        'bridge and a veth pair up and Chromium abandons everything in flight ' +
        `(#448). What the browser reported:\n  ${lost.join('\n  ')}`,
      )
    }
    console.log(
      `[e2e] the machine changed its network while ${url} was loading, so the ` +
      `page is being loaded again (#448). Attempt ${attempt + 2}. What was ` +
      `abandoned:\n  ${lost.slice(0, 5).join('\n  ')}`,
    )
  }
}
