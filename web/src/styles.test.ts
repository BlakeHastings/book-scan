/**
 * What is allowed to be left in the app's own stylesheet, and whether it can be
 * read.
 *
 * The conversion ended with this file at a third of its size (#387), and the
 * way it got that big was not one bad decision: it was rules outliving the
 * screens they painted, one merge at a time, for long enough that nobody could
 * tell by reading it which of them still drew anything. Two rounds of this
 * conversion each found hundreds of lines of that, by measuring rather than by
 * reading, and the measurement is cheaper as a test than as an afternoon.
 *
 * So this is the measurement, kept. It is deliberately the weakest useful form
 * of it: a class survives if its name appears anywhere in the app's source or
 * in the browser journeys. That is enough to catch a whole block left standing
 * after the screen it painted went, which is the failure that actually
 * happened, and it does not go red over a name assembled at runtime or added
 * through `classList`.
 *
 * ## The name has to be a name, which is what #451 changed
 *
 * This was a substring search, and a short class name is a substring of
 * ordinary English. Counted over the tree the day #451 was worked, with the
 * app's own header still in it:
 *
 *     error   88 files    tab      136 files
 *     counts  76 files    app      207 files
 *
 * One of those files was the header component, and every other one was
 * `setError`, `onError`, `database`, `table`, `wf-tab`, `append`, a directory
 * called `app`, a variable called `counts`. So `.error`, `.tab`, `.counts` and
 * `.app` could not have been reported as orphans by any deletion: they were
 * vouched for by the word "database". #451 was raised believing the header kept
 * them alive by naming them, and that was true of exactly two, `.topbar` and
 * `.topbar__home`, which are the two nothing else in the tree spells.
 *
 * A name now counts only where it appears as a whole name, with no letter,
 * digit, dash or underscore either side of it. That is the same weakest useful
 * form and it keeps every property argued for above: `classList.add('tab')`
 * still saves `.tab`, a `.feature` file still saves what it names, and a name
 * assembled out of pieces at runtime was never findable by either version.
 * What it stops is a rule being kept by a word that has nothing to do with it.
 *
 * ## What it still cannot see, measured rather than hoped
 *
 * #451 expected that deleting the header would make this sweep "tell the truth
 * again by itself". It does not, and the number is worth writing down. With the
 * header deleted and its seven rules put back in the stylesheet, this sweep
 * reports three of them — `topbar`, `topbar__home` and `tab--on` — and passes
 * `app`, `error`, `tab` and `counts`, because those four are also the names of
 * a directory, a caught exception, a loop variable and a field on the summary.
 * The version before #451 reported two: `tab--on` hides inside `wf-tab--on`.
 *
 * So the honest description of this check is that it catches a rule whose name
 * is peculiar to it, which is most of this stylesheet — `cam__sheet-meta`,
 * `queued__shot`, `queue__row` — and cannot catch one named after an ordinary
 * word. **No search of the source can.** The question underneath is whether the
 * class is on a screen somebody can reach, and the text of a file does not
 * contain the answer; a rendered screen does. That is a different instrument
 * from this one and it would have to be added beside it rather than instead of
 * it, because this one deliberately sees names a rendered screen never shows.
 *
 * ## And the second measurement, which is about the paint rather than the rules
 *
 * Every rule left here predates the token conversion and carries its own paint.
 * Two of them painted a dark panel and set no colour at all, so the words on
 * them came from whatever the page around them was written in: `--ink`, which is
 * a warm off-white at night and a dark brown in daylight. One of the two is the
 * app's only signal that a photograph failed to read, and it was invisible in a
 * bright room, which is the room somebody photographs books in (#432).
 *
 * So the ratio is computed from the values in the files rather than read off
 * them, over the two extremes a camera can put behind a panel that is not quite
 * opaque. WCAG 2.1 AA for body text is 4.5 to 1, and every one of these is set
 * below 18.66px, so that is the threshold rather than the 3 to 1 large-text one.
 *
 * **The third one is a different defect wearing the same number** (#451), and
 * it is the reason this is a list rather than a pair. `.cam__sheet-meta` did
 * not leave its ink to the page; it wrote in a hardcoded white at four tenths
 * opacity, which follows no theme, so it was 3.83 to 1 in daylight and 3.83 to
 * 1 at night. The first two were found by switching themes and looking. Nothing
 * about this one changes when the theme does, so nobody was ever going to
 * notice it that way, and only the arithmetic finds it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHEET = join(HERE, 'styles.css')
/**
 * This file, which is scanned by the sweep below and must not be.
 *
 * It sits under `src`, so it was in its own corpus, and it names classes in its
 * own prose: the paragraph above naming `.topbar` was enough to keep `.topbar`
 * alive on its own, after the component that drew it had gone. Found by
 * tripping it while proving the sweep could see the frame #451 deleted, which
 * is the only way anybody was going to find it — a test that vouches for what
 * it is measuring reports nothing and looks fine.
 */
const SELF = join(HERE, 'styles.test.ts')
/** The browser journeys, which hold on to some of these by name. */
const JOURNEYS = join(HERE, '..', '..', 'e2e')
/** Where the colours a rule may reach for are defined, both themes in one file. */
const TOKENS = join(HERE, 'design', 'tokens.css')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'runs') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(tsx?|mjs|feature|html)$/.test(entry.name) ? [path] : []
  })
}

/** Every class this stylesheet defines a rule for, comments stripped. */
function defined(): string[] {
  const css = readFileSync(SHEET, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const names = new Set<string>()
  for (const rule of css.matchAll(/(?:^|\})([^{}]+)\{/g)) {
    for (const found of rule[1]!.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
      names.add(found[1]!)
    }
  }
  return [...names]
}

/**
 * Whether the app spells this name, as a name rather than as a run of letters
 * inside a longer word.
 *
 * The extractor above only ever produces `[A-Za-z][A-Za-z0-9_-]*`, so there is
 * nothing here that needs escaping before it goes into a pattern, and a name
 * that stopped being of that shape would stop being extracted first.
 */
function spelled(name: string, text: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${name}(?![A-Za-z0-9_-])`).test(text)
}

describe('the app stylesheet paints nothing nobody draws', () => {
  it('is true of every class it still defines a rule for', () => {
    const names = defined()
    expect(names.length, 'nothing was scanned at all').toBeGreaterThan(10)

    const text = [...files(HERE), ...files(JOURNEYS)]
      .filter((path) => path !== SHEET && path !== SELF)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    const orphans = names.filter((name) => !spelled(name, text))

    expect(orphans, 'these rules paint something no screen asks for').toEqual([])
  })

  /*
   * The other half of #451, and the reason the change above is worth having.
   *
   * A test that cannot fail proves nothing, and this one could not: `.error`
   * and `.tab` were spelled inside `setError` and `database`, so no deletion
   * anywhere in the app could have made them orphans. This asks the check
   * itself, against a name that is a substring of a word the tree is full of
   * and of nothing else, so it goes red the day somebody puts the substring
   * search back.
   */
  it('does not accept a name it only found inside a longer word', () => {
    const text = `import { useErrorBanner } from './errorBanner'\nawait database.query()`
    expect(spelled('tab', text), '"database" vouched for .tab').toBe(false)
    expect(spelled('error', text), '"errorBanner" vouched for .error').toBe(false)
    expect(spelled('database', text), 'a whole name is still a name').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// What floats on the camera, measured
// ---------------------------------------------------------------------------

const AA_BODY_TEXT = 4.5

type Rgb = [number, number, number]

/** One rule's declarations, by property. */
function rule(selector: string): Record<string, string> {
  const css = readFileSync(SHEET, 'utf8')
  const escaped = selector.replace(/\./g, '\\.')
  const found = css.match(
    new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'),
  )
  if (!found) throw new Error(`${selector} is not in the stylesheet`)

  return Object.fromEntries(
    found[2]!.split(';')
      .map((line) => line.split(/:(.*)/s))
      .filter((pair) => pair.length > 1)
      .map(([name, value]) => [name!.trim(), value!.trim()]),
  )
}

/** Every definition of a custom property, light block and dark blocks alike. */
function tokenValues(name: string): string[] {
  const css = readFileSync(TOKENS, 'utf8')
  return [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))].map((m) => m[1]!.trim())
}

function parse(colour: string): { rgb: Rgb; alpha: number } {
  const hex = colour.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const digits = hex[1]!.length === 3
      ? hex[1]!.split('').map((c) => c + c).join('')
      : hex[1]!
    return {
      rgb: [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
    }
  }

  const rgba = colour.match(/^rgba?\(([^)]+)\)$/)
  if (!rgba) throw new Error(`${colour} is not a colour this test can measure`)
  const parts = rgba[1]!.split(',').map((one) => Number(one.trim()))
  return { rgb: parts.slice(0, 3) as Rgb, alpha: parts[3] ?? 1 }
}

const channel = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const over = (top: { rgb: Rgb; alpha: number }, under: Rgb): Rgb =>
  top.rgb.map((c, i) => c * top.alpha + under[i]! * (1 - top.alpha)) as Rgb

/**
 * What the camera can put behind a panel that is not quite opaque.
 *
 * A white page and a black paperback are both books somebody photographs, and a
 * panel at 94 per cent lets 6 per cent of either through. Measuring against both
 * is what says the answer does not depend on where the lens is pointed.
 */
const BEHIND: Rgb[] = [[0, 0, 0], [255, 255, 255]]

/** The ink a rule writes in, which must be a token and must not be missing. */
function inkOf(selector: string): { rgb: Rgb; alpha: number } {
  const colour = rule(selector).color
  expect(colour, `${selector} paints a background and leaves the ink to the page`)
    .toBeTruthy()

  const token = colour!.match(/^var\((--[a-z0-9-]+)\)$/)
  expect(token, `${selector} writes in ${colour} rather than in one of the tokens`)
    .toBeTruthy()

  const values = tokenValues(token![1]!)
  expect(values, `${token![1]} is not defined in tokens.css`).not.toHaveLength(0)
  /*
   * One value and no second one under a dark block, which is the property being
   * relied on rather than a coincidence. What is behind these panels is a
   * photograph rather than a page, so a colour that followed the phone's theme
   * would disappear on somebody's black paperback exactly as `--ink` disappeared
   * on the panel itself.
   */
  expect(new Set(values).size, `${token![1]} changes with the theme`).toBe(1)
  return parse(values[0]!)
}

/*
 * What is measured, and what each one is written on.
 *
 * `on` is here because the two #432 found each painted their own panel, and the
 * one #451 found does not: `.cam__sheet-meta` is a line inside the sheet, so
 * what is behind it is the sheet's paint rather than its own. Reading the
 * background off the rule under test would have thrown rather than measured,
 * and a rule that only measures the rules that happen to paint themselves is a
 * rule that stops at the panels and never reaches the words on them.
 */
const FLOATING = [
  {
    ink: '.cam__error',
    on: '.cam__error',
    what: 'the one line that says a photograph could not be read',
  },
  {
    ink: '.cam__sheet-body',
    on: '.cam__sheet-body',
    what: 'the camera settings sheet',
  },
  {
    ink: '.cam__sheet-meta',
    on: '.cam__sheet-body',
    what: 'what the camera is doing, written on the sheet',
  },
]

describe('what floats on the camera can be read in either theme', () => {
  it.each(FLOATING)('$ink: $what', ({ ink: selector, on }) => {
    const panel = parse(rule(on).background!)
    const ink = inkOf(selector)

    for (const behind of BEHIND) {
      const bed = over(panel, behind)
      const ratio = contrast(over(ink, bed), bed)
      expect(
        ratio,
        `${selector} is ${ratio.toFixed(2)} to 1 over rgb(${behind.join(',')})`,
      ).toBeGreaterThanOrEqual(AA_BODY_TEXT)
    }
  })
})
