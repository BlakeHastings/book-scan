/**
 * Whether this browser has asked for the Agentation toolbar, via `?agentation=on` or `=off`.
 * Per browser and not "on in dev", because the e2e suite drives the same dev server and a
 * toolbar there would sit over the tab bar in every scenario.
 */
export const ANNOTATING_KEY = 'book-scan.agentation'

export function wantsAnnotating(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean {
  const asked = new URLSearchParams(search).get('agentation')
  try {
    if (asked === 'on') storage.setItem(ANNOTATING_KEY, 'on')
    if (asked === 'off') storage.removeItem(ANNOTATING_KEY)
    return storage.getItem(ANNOTATING_KEY) === 'on'
  } catch {
    // Storage can throw in a private window; the address bar still answers for this load.
    return asked === 'on'
  }
}
