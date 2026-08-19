/**
 * The cat, as a component with two axes rather than as a picture (#410).
 *
 * Three things are checked and they are different in kind.
 *
 * **Nothing that was already drawn changed.** He is in the corner, in the
 * empty slot, on the confirmation and at the end of a run, and a component
 * gaining behaviour that quietly altered any of those would be found by
 * somebody opening a screen rather than by a red test. So the class attribute
 * of a cat nobody asked anything of is pinned exactly.
 *
 * **The tables are complete.** A fifth pose is one entry in `BOX` and one in
 * `DRAW`, which is the whole of what "we want to be able to expand it" asks
 * for, and the failure mode of that shape is a pose added to one table and not
 * the other. That is a typecheck today and a runtime hole the moment either
 * table stops being a `Record`, so it is checked here as well.
 *
 * **A behaviour is a class and a repeat, and nothing else.** What it does is a
 * fact about frames, and frames are watched in a browser:
 * `e2e/features/the-cat-is-alive.feature` is where "the tail moves" and "it
 * stops for somebody who asked for less motion" are answered. Rendering markup
 * cannot answer either, and a test that claimed to would be worse than none.
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
    // The proportions per pose, which is the one thing a caller relies on: it
    // picks a height and the width follows. A pose whose box moved would move
    // the cat in a shelf slot, on a confirmation and in the corner at once.
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
    // Twice as tall as he is, and that is the pose (#427): the top half is cat
    // and the bottom half is tail, so a screen puts the middle of this box on
    // the top edge of whatever he is lying on and the rest goes behind it.
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
    // `--cat-repeat` is the whole of loop-or-once, so a behaviour written next
    // year gets both answers without this file or `Cat` being touched. Checked
    // against the stylesheet because that is where the promise is kept.
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
    // The claim that this actually stops the drawing is answered by watching
    // frames in a browser. What is answered here is that the rule exists and
    // reaches every part of him, because it is the kind of rule that gets lost
    // in a stylesheet nobody re-reads.
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
  // Read rather than imported: this is a plain stylesheet, and the check is
  // about what is written in it.
  const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  return readFileSync(join(here, 'library.css'), 'utf8')
}
