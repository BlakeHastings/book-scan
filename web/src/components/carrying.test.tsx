/**
 * Guards against `ShelveView` being hand-forked for the carry flow: both the
 * scan and carry journeys must call the one component, and it must draw the
 * same four things in the same order.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShelveView } from './ShelveView'
import { emptyCascade } from '../lib/cascade'
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

  // These are the gallery's own class names, not a separate list to keep in
  // step: `design.test.tsx` checks the same strings, so a change to one is
  // caught in both.
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
        cascade={emptyCascade}
        setCascade={() => {}}
        onRefresh={async () => {}}
      />,
    )

    const at = marks.map((mark) => markup.indexOf(mark))
    expect(at, `one of ${marks.join(', ')} is not drawn`).not.toContain(-1)
    expect([...at].sort((a, b) => a - b), 'they are drawn in another order').toEqual(at)
  })

  // The carry flow must tell the placing preview where the trip goes rather
  // than letting it derive the destination from the rules: a second
  // furniture piece claiming the same tag could otherwise recompute a
  // different plank than the one the trip named.
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
