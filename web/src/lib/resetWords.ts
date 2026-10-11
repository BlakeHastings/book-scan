/**
 * What each reset in Settings says, built from the counts the server read. The
 * sentence before the press and the sentence after it come from the same
 * numbers, so the screen cannot promise one thing and report another.
 */

import type { ResetCounts } from './api'
import type { ResetName } from '../../shared/resets'

const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`

export const RESET_TITLE: Record<ResetName, string> = {
  unplace: 'Take every book off its shelf',
  history: 'Erase where every book has been',
  furniture: 'Remove all the furniture',
}

export interface ResetWords {
  /** What pressing it will change, with the counts in it. */
  said: string
  /** Why it cannot be pressed now, or '' when it can. */
  blocked: string
}

export function resetWords<Name extends ResetName>(
  name: Name,
  counts: ResetCounts[Name],
): ResetWords {
  switch (name) {
    case 'unplace': {
      const { books: placed, pinned, rows } = counts as ResetCounts['unplace']
      return {
        said: `${books(placed)} will be taken off ${placed === 1 ? 'its shelf' : 'their shelves'}, ` +
          `${pinned} of them pinned. Checked out and given away books stay as they are, ` +
          'and where every book has been is kept.',
        blocked: rows === 0 ? 'No book is on a shelf.' : '',
      }
    }
    case 'history': {
      const { rows, books: about, onShelves } = counts as ResetCounts['history']
      return {
        said: `${many(rows, 'placement record', 'placement records')} about ${books(about)} ` +
          `will be deleted for good, and ${books(onShelves)} taken off the shelves. ` +
          'Only a backup brings them back.',
        blocked: rows === 0 ? 'There is no placement history.' : '',
      }
    }
    case 'furniture': {
      const { fixtures, areas, rules, history } = counts as ResetCounts['furniture']
      const empty = fixtures === 0 && areas === 0 && rules === 0
      return {
        said: `${many(fixtures, 'piece of furniture', 'pieces of furniture')}, ` +
          `${many(areas, 'area', 'areas')} and ${many(rules, 'rule', 'rules')} will be deleted, ` +
          'so the room is set up again from empty.',
        blocked: history > 0
          ? `Erase where every book has been first: ${many(history, 'placement record still names', 'placement records still name')} this furniture.`
          : empty ? 'There is no furniture.' : '',
      }
    }
  }
  return { said: '', blocked: '' }
}

/** What happened, said once it has. */
export function resetDone<Name extends ResetName>(name: Name, done: ResetCounts[Name]): string {
  switch (name) {
    case 'unplace': {
      const { books: placed } = done as ResetCounts['unplace']
      return `Done. ${books(placed)} taken off the shelves.`
    }
    case 'history': {
      const { rows } = done as ResetCounts['history']
      return `Done. ${many(rows, 'placement record', 'placement records')} erased.`
    }
    case 'furniture': {
      const { fixtures, areas } = done as ResetCounts['furniture']
      return `Done. ${many(fixtures, 'piece of furniture', 'pieces of furniture')} and ${many(areas, 'area', 'areas')} removed.`
    }
  }
  return ''
}
