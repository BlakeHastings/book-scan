/**
 * A book a rule change displaced is put back by the screen a new book is put
 * back by.
 *
 * > There needs to be a flow inside the application to look at all those books
 * > that are marked as needing to be moved and be able to go through and
 * > reshelve each one [...] the same way as whenever we're initially shelving
 * > them.
 *
 * The owner has said twice that he likes the where-it-goes screen, and #291 asks
 * for it rather than for a second one. The gallery obeys that structurally, with
 * one `Placing` called by both, and `design.test.tsx` pins the shape there. This
 * is the same pin on the app: `ShelveView` is what draws it, and both the screen
 * a scanned book reaches and the screen a carried book reaches call that one.
 *
 * The way that comes apart is somebody hand-building the carry version to add
 * one thing to it: a heading, a count, a button above the drawing. Then the two
 * drift for a year. So this checks both halves: that there is one component, and
 * that it draws the four things in the order the design fixed.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShelveView } from './ShelveView'
import type { PlacementResponse } from '../lib/api'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const read = (path: string) => readFileSync(join(HERE, '..', path), 'utf8')

/** Every file of the client, so a second implementation cannot hide in one. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const placement: PlacementResponse = {
  range: 'fiction',
  instruction: 'Between The City & the City and Cloud Atlas.',
  suggestedLocation: '2C',
  derivedLocation: '2C',
  predecessor: null,
  successor: null,
  authorFiling: 'Ishiguro, Kazuo',
  sortKey: 'ishiguro kazuo|never let me go',
  strip: {
    label: '2C',
    gapIndex: 1,
    placedIndex: null,
    books: [
      {
        id: 1, title: 'The City & the City', authorFiling: 'Miéville, China',
        pages: '312', spine: '', spineSlot: 'edge',
      },
      {
        id: 2, title: 'Cloud Atlas', authorFiling: 'Mitchell, David',
        pages: '544', spine: '', spineSlot: 'edge',
      },
    ],
  },
} as unknown as PlacementResponse

describe('a carried book is placed by the screen a new book is placed by', () => {
  it('is one component, called by both screens', () => {
    for (const screen of ['screens/ShelveScreen.tsx', 'screens/CarryingScreen.tsx']) {
      expect(read(screen), `${screen} does not call the where-it-goes screen`)
        .toMatch(/import \{ ShelveView \} from '\.\.\/components\/ShelveView'/)
    }
  })

  /*
   * The four marks of the drawn design, in order: the sentence naming the
   * neighbours, the area with the gap in it, the book in the hand under the
   * board, and the answer a person standing at the shelf gives. Anything that
   * reorders or drops one is a second implementation whatever it is spelled as.
   *
   * **They are the gallery's own marks now** (#387). This checked the app's
   * four class names against the gallery's four, which is two lists that have
   * to be kept in step by somebody remembering to; the placing strip is drawn
   * by `Shelf` now, so `design.test.tsx` and this file look for the same
   * strings and a change to one is caught in both.
   */
  it('draws the same four things in the same order, once', () => {
    const marks = ['wf-instruction', 'wf-gap', 'wf-shelf__inhand', 'wf-btn--primary']

    const markup = renderToStaticMarkup(
      <ShelveView
        placement={placement}
        stale={false}
        range="fiction"
        title="Never Let Me Go"
        saving={false}
        onShelved={() => {}}
        onBack={() => {}}
        onRefresh={async () => {}}
      />,
    )

    const at = marks.map((mark) => markup.indexOf(mark))
    expect(at, `one of ${marks.join(', ')} is not drawn`).not.toContain(-1)
    expect([...at].sort((a, b) => a - b), 'they are drawn in another order').toEqual(at)
  })

  /**
   * The other half of not forking it, and the whole of #429.
   *
   * One screen serving two journeys only works if each journey hands it what it
   * needs. The carry journey did not: the screen worked out for itself where the
   * book belonged *now*, from the rules, and with a second piece of furniture
   * claiming the same tag that is a different plank from the one the trip named.
   * Somebody did exactly what the app asked, no assignment named that plank, and
   * the trip came back forever.
   *
   * So the fix is an argument rather than a second screen, and this is what
   * stops it being quietly dropped: **the carry flow tells the placing preview
   * where this trip goes**, and the journey that has no trip does not.
   */
  it('is told where this trip goes rather than working it out', () => {
    expect(
      read('screens/CarryingScreen.tsx'),
      'the carry flow does not tell the placing screen where this trip goes',
    ).toMatch(/previewPlacement\([^)]*trip\.toAreaId/)

    expect(
      read('screens/ShelveScreen.tsx'),
      'a newly scanned book has no trip, so nothing may name one for it',
    ).not.toMatch(/toAreaId/)
  })

  it('has no second thing in the client drawing a placing strip with a gap', () => {
    const drawing = sources(HERE)
      .concat(sources(join(HERE, '..', 'screens')))
      .filter((path) => !/\.test\./.test(path))
      .filter((path) => /<ShelfStrip|placing\(/.test(readFileSync(path, 'utf8')))
      .map((path) => path.split(/[\\/]/).pop())

    expect(new Set(drawing), 'somebody has drawn a second placing strip')
      .toEqual(new Set(['ShelfStrip.tsx', 'ShelveView.tsx']))
  })
})
