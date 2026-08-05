/**
 * What the first screen says is waiting.
 *
 * #148: it said "9 need an ISBN by hand" when five of those nine already had a
 * valid ISBN off a barcode, and what those five actually needed was somebody
 * to fill in details no catalogue could supply. Home is where the work gets
 * sorted, so a wrong count here mis-sorts it before anybody picks up a book.
 *
 * Rendered as a tree and read as markup rather than driven in a browser, the
 * way `QueuePane.test.tsx` does it: this project has no DOM in its test setup,
 * and `HomePane` holds no state, so it stays callable as a plain function.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { HomePane } from './HomePane'
import type { Counts, QueueCounts } from '../lib/api'
import { noFailures } from '../../shared/captureFailure'

const counts: Counts = { total: 12, fiction: 8, nonfiction: 4, checkedOut: 0 }

function queue(over: Partial<QueueCounts> = {}): QueueCounts {
  return { pending: 0, ready: 0, failed: 0, done: 0, failures: noFailures, ...over }
}

function home(q: QueueCounts | null): string {
  return renderToStaticMarkup(HomePane({
    counts,
    queue: q,
    onAdd: () => {},
    onScan: () => {},
    onLibrary: () => {},
    onQueue: () => {},
  }) as ReactElement)
}

describe('what the queue button says is wrong', () => {
  it('does not ask for an ISBN that was read off a barcode and is correct', () => {
    // The reported case exactly: nine failed, five of them holding a good ISBN
    // no catalogue has.
    const html = home(queue({
      failed: 9,
      failures: { noIsbn: 4, uncatalogued: 5, errored: 0 },
    }))
    expect(html).not.toContain('9 need an ISBN')
    expect(html).toContain('4 need an ISBN by hand.')
    expect(html).toContain('5 need details by hand. No catalogue has their ISBN.')
  })

  it('says which of the three each failure is', () => {
    const html = home(queue({
      ready: 2, pending: 1, failed: 3,
      failures: { noIsbn: 1, uncatalogued: 1, errored: 1 },
    }))
    expect(html).toContain('2 ready to confirm.')
    expect(html).toContain('1 still reading.')
    expect(html).toContain('1 need an ISBN by hand.')
    expect(html).toContain('1 need details by hand.')
    expect(html).toContain('1 hit an error while being read.')
  })

  it('says nothing about a kind of failure the queue does not have', () => {
    const html = home(queue({ failed: 2, failures: { noIsbn: 0, uncatalogued: 2, errored: 0 } }))
    expect(html).not.toContain('need an ISBN by hand')
    expect(html).not.toContain('hit an error')
  })

  it('still counts every failure in the badge, whatever kind it is', () => {
    // The badge is "how much is waiting" and that has not changed: splitting
    // the reasons must not lose one out of the total.
    const html = home(queue({
      pending: 1, ready: 2, failed: 3,
      failures: { noIsbn: 1, uncatalogued: 1, errored: 1 },
    }))
    expect(html).toContain('>6</span>')
  })

  it('hides the queue entirely when there is nothing in it', () => {
    expect(home(queue())).not.toContain('home__queue')
    expect(home(null)).not.toContain('home__queue')
  })
})
