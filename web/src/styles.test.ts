/**
 * What is allowed to be left in the app's own stylesheet.
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
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHEET = join(HERE, 'styles.css')
/** The browser journeys, which hold on to some of these by name. */
const JOURNEYS = join(HERE, '..', '..', 'e2e')

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

describe('the app stylesheet paints nothing nobody draws', () => {
  it('is true of every class it still defines a rule for', () => {
    const names = defined()
    expect(names.length, 'nothing was scanned at all').toBeGreaterThan(10)

    const text = [...files(HERE), ...files(JOURNEYS)]
      .filter((path) => path !== SHEET)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    const orphans = names.filter((name) => !text.includes(name))

    expect(orphans, 'these rules paint something no screen asks for').toEqual([])
  })
})
