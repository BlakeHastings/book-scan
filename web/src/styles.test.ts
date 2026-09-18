/**
 * What is allowed to be left in the app's own stylesheet, and whether it
 * can be read.
 *
 * A class survives if its name appears anywhere in the app's source or in
 * the browser journeys, matched as a whole name only (no letter, digit,
 * dash or underscore on either side), so `classList.add('tab')` still
 * saves `.tab` but a substring inside `setError` or `database` does not
 * vouch for `.error` or `.tab` any more.
 *
 * This still cannot tell a class that is reachable from one that merely
 * shares a name with a directory, a caught exception, or a loop variable:
 * no search of the source can, since the question is whether the class is
 * on a screen somebody can reach, and only a rendered screen answers that.
 *
 * The second half measures contrast rather than reachability. Every rule
 * here predates the token conversion and carries its own paint; two paint
 * no background and rely on the page's `--ink` showing through, so the
 * ratio is computed over the two extremes a camera can put behind a panel
 * that is not quite opaque, against the AA body-text threshold (4.5:1),
 * since every one of these is set below 18.66px. The same sum lives in
 * `design/contrast.ts` for the design system's own use; a drifted copy
 * here would be a green test asserting the wrong number.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AA_BODY_TEXT,
  BEHIND,
  contrast,
  over,
  parse,
  type Paint,
} from './design/contrast'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHEET = join(HERE, 'styles.css')
/** Excluded from the sweep below: this file names classes in its own prose, so it would vouch for them. */
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
 * Whether the app spells this name, as a name rather than as a run of
 * letters inside a longer word. Nothing here needs escaping before it
 * goes into a pattern, since the extractor above only ever produces
 * `[A-Za-z][A-Za-z0-9_-]*`.
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
   * A test that cannot fail proves nothing: `.error` and `.tab` are
   * spelled inside `setError` and `database`, so no deletion anywhere in
   * the app could make them orphans under a substring search. This checks
   * the check itself against exactly that case.
   */
  it('does not accept a name it only found inside a longer word', () => {
    const text = `import { useErrorBanner } from './errorBanner'\nawait database.query()`
    expect(spelled('tab', text), '"database" vouched for .tab').toBe(false)
    expect(spelled('error', text), '"errorBanner" vouched for .error').toBe(false)
    expect(spelled('database', text), 'a whole name is still a name').toBe(true)
  })
})

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

/** The ink a rule writes in, which must be a token and must not be missing. */
function inkOf(selector: string): Paint {
  const colour = rule(selector).color
  expect(colour, `${selector} paints a background and leaves the ink to the page`)
    .toBeTruthy()

  const token = colour!.match(/^var\((--[a-z0-9-]+)\)$/)
  expect(token, `${selector} writes in ${colour} rather than in one of the tokens`)
    .toBeTruthy()

  const values = tokenValues(token![1]!)
  expect(values, `${token![1]} is not defined in tokens.css`).not.toHaveLength(0)
  /*
   * One value and no second one under a dark block: what is behind these
   * panels is a photograph rather than a page, so a colour that followed
   * the phone's theme would disappear on somebody's black paperback
   * exactly as `--ink` disappeared on the panel itself.
   */
  expect(new Set(values).size, `${token![1]} changes with the theme`).toBe(1)
  return parse(values[0]!)
}

/*
 * What is measured, and what each one is written on. `on` differs from
 * `ink` when a rule is a line inside another element's paint rather than
 * painting its own panel, so its background has to be read off that
 * element instead.
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
