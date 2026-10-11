/** Rendered as markup: the card holds no state of its own. */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResetsCard, type ResetPlans } from './ResetsCard'
import { resetDone, resetWords } from '../lib/resetWords'
import { RESET_PHRASES, confirms, isReset, type ResetName } from '../../shared/resets'

const FULL: ResetPlans = {
  unplace: { books: 288, pinned: 12, rows: 290 },
  history: { rows: 1400, books: 300, onShelves: 288 },
  furniture: { fixtures: 5, areas: 31, rules: 3, history: 1400 },
}

function drawn(over: {
  plans?: ResetPlans
  asking?: ResetName | null
  typed?: string
  busy?: boolean
  said?: string
} = {}): string {
  const nothing = () => {}
  return renderToStaticMarkup(
    <ResetsCard
      plans={over.plans ?? FULL}
      asking={over.asking ?? null}
      typed={over.typed ?? ''}
      busy={over.busy ?? false}
      said={over.said ?? ''}
      onAsk={nothing}
      onType={nothing}
      onConfirm={nothing}
      onKeep={nothing}
    />,
  )
}

/** The `disabled` of the button carrying this word, read off the markup. */
function off(markup: string, word: string, which = 0): boolean {
  const buttons = [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)]
    .filter((one) => one[1] === word)
  const button = buttons[which]
  if (!button) throw new Error(`no button ${word}`)
  return button[0].includes('disabled')
}

describe('the resets card', () => {
  it('says what each reset will change, with the server\'s counts in it', () => {
    const markup = drawn()
    expect(markup).toContain('288 books will be taken off their shelves, 12 of them pinned.')
    expect(markup).toContain('1400 placement records about 300 books will be deleted for good')
    expect(off(markup, 'Take every book off its shelf')).toBe(false)
    expect(off(markup, 'Erase where every book has been')).toBe(false)
  })

  it('will not remove the furniture while the history names it, and says why', () => {
    const markup = drawn()
    expect(markup).toContain('Erase where every book has been first: 1400 placement records still name this furniture.')
    expect(off(markup, 'Remove all the furniture')).toBe(true)

    const ready = drawn({ plans: { ...FULL, furniture: { fixtures: 5, areas: 31, rules: 3, history: 0 } } })
    expect(off(ready, 'Remove all the furniture')).toBe(false)
  })

  it('draws no button for a reset the server has not counted', () => {
    const markup = drawn({ plans: { unplace: FULL.unplace } })
    expect(markup).not.toContain('Remove all the furniture')
  })

  it('asks for the phrase and will not act until it is typed', () => {
    const asked = drawn({ asking: 'unplace' })
    expect(asked).toContain('role="dialog"')
    expect(asked).toContain(`Type &quot;${RESET_PHRASES.unplace}&quot; to do this`)
    expect(off(asked, 'Take every book off its shelf', 1)).toBe(true)

    const wrong = drawn({ asking: 'unplace', typed: RESET_PHRASES.history })
    expect(off(wrong, 'Take every book off its shelf', 1)).toBe(true)

    const typed = drawn({ asking: 'unplace', typed: 'Unplace every book' })
    expect(off(typed, 'Take every book off its shelf', 1)).toBe(false)
  })
})

describe('the words', () => {
  it('says one book in the singular', () => {
    expect(resetWords('unplace', { books: 1, pinned: 0, rows: 1 }).said)
      .toContain('1 book will be taken off its shelf')
  })

  it('has nothing to press when nothing is placed', () => {
    expect(resetWords('unplace', { books: 0, pinned: 0, rows: 0 }).blocked).toBe('No book is on a shelf.')
    expect(resetWords('history', { rows: 0, books: 0, onShelves: 0 }).blocked)
      .toBe('There is no placement history.')
    expect(resetWords('furniture', { fixtures: 0, areas: 0, rules: 0, history: 0 }).blocked)
      .toBe('There is no furniture.')
  })

  it('reports what was done from the same counts', () => {
    expect(resetDone('unplace', { books: 7, pinned: 1, rows: 7 })).toBe('Done. 7 books taken off the shelves.')
    expect(resetDone('furniture', { fixtures: 1, areas: 3, rules: 2, history: 0 }))
      .toBe('Done. 1 piece of furniture and 3 areas removed.')
  })
})

describe('the phrases', () => {
  it('are three different sentences', () => {
    expect(new Set(Object.values(RESET_PHRASES)).size).toBe(3)
  })

  it('forgive case and spacing and nothing else', () => {
    expect(confirms('history', '  Erase   Placement History ')).toBe(true)
    expect(confirms('history', 'erase placement histories')).toBe(false)
    expect(confirms('history', RESET_PHRASES.furniture)).toBe(false)
    expect(confirms('history', undefined)).toBe(false)
    expect(confirms('history', 42)).toBe(false)
  })

  it('name only the three resets', () => {
    expect(isReset('unplace')).toBe(true)
    expect(isReset('everything')).toBe(false)
    expect(isReset(undefined)).toBe(false)
  })
})
