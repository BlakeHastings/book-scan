/**
 * Checks structure only: the class, the tables, and the repeat variable. What
 * the animation actually does is answered in
 * `e2e/features/the-cat-is-alive.feature`, since rendered markup can't show it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Cat, type CatDoing, type CatPlay, type CatPose } from './Cat'

const POSES: CatPose[] = ['sitting', 'peeking', 'loaf', 'sleeping', 'lying']
const BEHAVIOURS: CatDoing[] = ['dozing']
const PLAYS: CatPlay[] = ['loop', 'once']

/** What the svg tag itself says, which is the whole of the component's contract. */
function tag(markup: string): string {
  return markup.slice(0, markup.indexOf('>') + 1)
}

describe('a cat nobody asked anything of', () => {
  it('wears the class it always wore, in every pose', () => {
    for (const pose of POSES) {
      expect(tag(renderToStaticMarkup(<Cat pose={pose} size={40} />)), `${pose} gained a class`)
        .toContain('class="wf-cat"')
    }
  })

  it('still takes a caller\'s own class beside it', () => {
    const markup = renderToStaticMarkup(<Cat pose="peeking" size={20} className="wf-perch__cat" />)
    expect(tag(markup)).toContain('class="wf-cat wf-perch__cat"')
  })

  it('draws each of the four it drew before at exactly the size it drew them', () => {
    // A caller picks a height and the width follows; a pose whose box moved
    // would shift the cat everywhere it's already placed.
    const drawn = (pose: CatPose, size: number) =>
      tag(renderToStaticMarkup(<Cat pose={pose} size={size} />))

    expect(drawn('sitting', 58)).toContain('width="43" height="58"')
    expect(drawn('peeking', 20)).toContain('width="29" height="20"')
    expect(drawn('loaf', 64)).toContain('width="104" height="64"')
    expect(drawn('sleeping', 40)).toContain('width="72" height="40"')
  })

  it('is decoration unless it is given words, in which case it is an image', () => {
    expect(tag(renderToStaticMarkup(<Cat pose="loaf" size={64} />))).toContain('aria-hidden="true"')

    const named = tag(renderToStaticMarkup(<Cat pose="loaf" size={64} label="Done" />))
    expect(named).toContain('role="img"')
    expect(named).toContain('aria-label="Done"')
    expect(named).not.toContain('aria-hidden')
  })
})

describe('a pose is a drawing', () => {
  it('draws something for every one of them', () => {
    for (const pose of POSES) {
      const markup = renderToStaticMarkup(<Cat pose={pose} size={40} />)
      expect(markup, `${pose} draws nothing at all`).toContain('wf-cat__fill')
      expect(markup.length, `${pose} draws almost nothing`).toBeGreaterThan(200)
    }
  })

  it('gives the lying one shut eyes and a tail long enough to leave him', () => {
    const markup = renderToStaticMarkup(<Cat pose="lying" size={92} />)

    expect(markup, 'the lying cat has his eyes open').toContain('wf-cat__shut')
    expect(markup, 'the lying cat has no tail to put behind anything')
      .toContain('wf-cat__sweep')
    expect(markup, 'nothing can ask where the lying cat ends').toContain('wf-cat__rest')
    // Twice as tall as he is: the top half is cat, the bottom half is tail, so
    // a screen positions the middle of this box on the shelf edge and lets
    // the rest hang behind it.
    expect(tag(markup)).toContain('width="102" height="92"')
  })

  it('adds no behaviour of its own, so a still screen stays still', () => {
    expect(tag(renderToStaticMarkup(<Cat pose="lying" size={92} />)))
      .toContain('class="wf-cat"')
  })
})

describe('a behaviour is what he is doing', () => {
  it('names itself on the drawing, and loops unless told otherwise', () => {
    for (const doing of BEHAVIOURS) {
      const markup = tag(renderToStaticMarkup(<Cat pose="lying" size={92} doing={doing} />))
      expect(markup, `${doing} is not on the drawing`).toContain(`wf-cat--${doing}`)
      expect(markup, `${doing} does not loop by default`).toContain('wf-cat--loop')
    }
  })

  it('loops or plays once, and that is the caller\'s to say', () => {
    for (const play of PLAYS) {
      const markup = tag(renderToStaticMarkup(
        <Cat pose="lying" size={92} doing="dozing" play={play} />,
      ))
      expect(markup, `${play} is not on the drawing`).toContain(`wf-cat--${play}`)
    }
  })

  it('says how often to repeat once, for every behaviour there will ever be', () => {
    const css = library()

    expect(css).toMatch(/\.wf-cat--loop\s*\{[^}]*--cat-repeat:\s*infinite/)
    expect(css).toMatch(/\.wf-cat--once\s*\{[^}]*--cat-repeat:\s*1/)

    for (const doing of BEHAVIOURS) {
      const rules = [...css.matchAll(
        new RegExp(`\\.wf-cat--${doing}[^{]*\\{([^}]*)\\}`, 'g'),
      )].map((one) => one[1] ?? '')

      expect(rules.length, `${doing} has no rules at all`).toBeGreaterThan(0)
      for (const rule of rules) {
        expect(rule, `${doing} hard-codes how often it repeats`)
          .toMatch(/animation:[^;]*var\(--cat-repeat\)/)
      }
    }
  })

  it('stops entirely for somebody who has asked for less motion', () => {
    const reduced = library().match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/,
    )?.[0] ?? ''

    expect(reduced, 'the design system honours nobody who asked for less motion')
      .not.toBe('')
    expect(reduced, 'the cat carries on moving for somebody who asked it not to')
      .toMatch(/\.wf-cat[^{]*\{[^}]*animation:\s*none/)
  })
})

function library(): string {
  // Read rather than imported, since the check is about what is literally
  // written in the stylesheet.
  const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  return readFileSync(join(here, 'library.css'), 'utf8')
}
