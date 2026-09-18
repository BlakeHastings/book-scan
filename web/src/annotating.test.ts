import { describe, expect, it } from 'vitest'
import { ANNOTATING_KEY, wantsAnnotating } from './annotating'

function memory(): Storage {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
    clear: () => rows.clear(),
    key: () => null,
    get length() {
      return rows.size
    },
  }
}

describe('wantsAnnotating', () => {
  it('stays off in a browser that has never been asked', () => {
    expect(wantsAnnotating('', memory())).toBe(false)
  })

  it('turns on from the address bar and remembers it', () => {
    const storage = memory()
    expect(wantsAnnotating('?agentation=on', storage)).toBe(true)
    expect(wantsAnnotating('', storage)).toBe(true)
    expect(storage.getItem(ANNOTATING_KEY)).toBe('on')
  })

  it('turns off again from the address bar', () => {
    const storage = memory()
    wantsAnnotating('?agentation=on', storage)
    expect(wantsAnnotating('?agentation=off', storage)).toBe(false)
    expect(wantsAnnotating('', storage)).toBe(false)
  })

  it('still answers for one load when storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(wantsAnnotating('?agentation=on', refusing)).toBe(true)
    expect(wantsAnnotating('', refusing)).toBe(false)
  })
})
