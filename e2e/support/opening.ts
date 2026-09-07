/**
 * Opening the app, and not mistaking the machine for the app.
 *
 * ## What #448 turned out to be
 *
 * `leaving-books-where-they-are.feature` was reported as failing differently
 * every run, with a race inside a step named as the likely site. Measured on a
 * machine with memory to spare, the failure is always the same one and it is
 * none of the three things it looked like. The browser says so itself, once
 * something is listening:
 *
 *     request failed: net::ERR_NETWORK_CHANGED https://localhost:44873/src/main.tsx
 *     console error: Failed to load resource: net::ERR_NETWORK_CHANGED
 *     request failed: net::ERR_NETWORK_CHANGED https://localhost:44873/@react-refresh
 *
 * `/src/main.tsx` is the application's entry module. When it is lost the page
 * stays white, nothing mounts, and the only thing the scenario can report is
 * that some element was not visible.
 *
 * `net::ERR_NETWORK_CHANGED` is Chromium abandoning every request that is in
 * flight because the **host's** network configuration changed underneath it. It
 * is not the server refusing, not the page being slow, and not this machine
 * running out of anything.
 *
 * ## What changes the network, and why it looked like the scenarios
 *
 * Docker. Starting a container creates a bridge and a veth pair and removing it
 * takes them away, and this repository's own AppHost does both on every
 * `aspire start` and `aspire stop`. Several agents work on one machine, so
 * somebody else's environment coming up is an interface appearing while this
 * suite's browser is fetching the two hundred modules a Vite dev server serves
 * for one page.
 *
 * Which scenario is loading a page at that moment is a coin toss. **That is the
 * whole of "a different scenario fails each run"**, and it is why it read as
 * scenarios interfering with each other: the interference is real, and it is
 * between agents rather than between scenarios.
 *
 * Demonstrated rather than argued, with no suite involved. Against one
 * already-running app, opening the first screen sixty times over lost one of
 * them this way. Repeated while deliberately creating and removing a Docker
 * network every three seconds, five of forty were lost, every one with the same
 * error on a module request.
 *
 * ## Why this is not the retry the issue forbids
 *
 * #448 says not to answer this with a retry, and it is right: a retry that goes
 * green makes a flaky suite look solid and leaves the gate arbitrary. This is
 * not that, and the difference is that it cannot fire on a failure.
 *
 * It waits for **either** the screen the caller is about to make a claim about
 * **or** the browser saying a request was abandoned because the network moved,
 * and it loads the page again only for the second. An app that is genuinely
 * broken produces no such error, so this returns and the caller's own assertion
 * fails with its own words at its own speed. Nothing here invents a failure
 * except the one case where the page was abandoned three times over, and that
 * one says exactly what happened.
 *
 * And it says so out loud every time it fires, so a machine that is doing this
 * constantly shows up as a pile of lines in the log rather than as silence.
 */

import type { Locator, Page, Request } from '@playwright/test'

/**
 * The errors that mean "the host's network moved", and nothing else.
 *
 * Deliberately two names and not a pattern that would grow. Everything else the
 * network layer can say — refused, reset, timed out, name not resolved — is
 * something about the app or about the server under it, and loading the page
 * again for one of those is how a real failure gets waved through.
 */
const THE_MACHINE_MOVED = /net::ERR_NETWORK_CHANGED|net::ERR_NETWORK_IO_SUSPENDED/

/**
 * How many times the page is loaded again before that is the answer.
 *
 * Two, which is what "this machine is not usable for a browser suite right now"
 * looks like: one interface event during one page load is ordinary where agents
 * share a machine, three in a row is not something to keep trying through.
 */
const RELOADS = 2

/**
 * How long the screen is given before the caller is left to complain about it.
 *
 * The same thirty seconds `playwright.config.ts` gives an assertion, because
 * this waits for the same thing the caller's next line does. A page that loads
 * takes about a second, and an abandoned request is noticed as it happens
 * rather than by this expiring, so nothing green ever spends this.
 */
const TO_DRAW = 30_000

/**
 * Load the page and wait for the screen the caller is about to assert on.
 *
 * `ready` is that screen, passed in rather than guessed at here, so this waits
 * for the thing the step actually needs instead of for a root element having
 * children — which mounts perfectly well while the request carrying the
 * collection's counts is the one that was abandoned.
 *
 * This makes no claim of its own. If `ready` never appears and the browser
 * never said the network moved, it returns and the caller's assertion says what
 * is wrong, in the words that step chose.
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
       * `reload` rather than `goto` on the way round again, because one of the
       * three callers opens `…#/design/library` and navigating to a URL that
       * differs from the current one only by its fragment is a same-document
       * navigation: it would fetch nothing and the page would still be the
       * broken one. `goto` is right the first time and whenever the browser is
       * not on this app at all, which is what a document abandoned inside the
       * first `goto` leaves behind.
       */
      const onTheApp = page.url().startsWith(new URL(url).origin)
      await (attempt > 0 && onTheApp ? page.reload() : page.goto(url))
      const drawn = ready.first()
        .waitFor({ state: 'visible', timeout: TO_DRAW })
        .then(() => 'drawn' as const)
        // Swallowed on purpose: the caller asserts on this same screen next, so
        // its failure is the one worth reading. All that is wanted here is to
        // stop racing.
        .catch(() => 'gave up' as const)
      if (await Promise.race([drawn, moved]) !== 'moved') return
    } catch (error) {
      /*
       * Losing the **document** the same way throws out of the navigation
       * instead, and Playwright words it as an interruption rather than as the
       * network error underneath:
       *
       *     page.goto: Navigation to "https://localhost:46287/" is interrupted
       *     by another navigation to "chrome-error://chromewebdata/"
       *
       * That sentence is true of a server that has died as well, so it is not
       * enough on its own to decide by. What decides is whether the browser
       * says a request was abandoned because the network moved, and the one
       * thing that cannot be assumed is that it has said it **yet**: the
       * navigation's rejection and the request's failure are two events and
       * this is the ordering where the rejection wins.
       *
       * So the answer is waited for rather than read, bounded, and only on a
       * path that has already failed. A second is far longer than the gap
       * between those two events and is spent only where the alternative is
       * reporting a machine's network as a broken app.
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
