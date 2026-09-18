/**
 * Whether this browser has asked for the Agentation toolbar.
 *
 * Agentation is a design-review aid: click anything on the page, say what is
 * wrong with it, and a Claude session listening on `agentation-mcp` picks the
 * note up and makes the change. See `docs/process/annotating.md`.
 *
 * It is a switch per browser and not per dev server, because the dev server is
 * also what the e2e suite drives. A toolbar that appeared whenever Vite was in
 * dev mode would sit over the tab bar in every scenario and turn the layout
 * features red. So the address bar turns it on and off, and the answer is kept
 * in this browser's storage until it is turned off again:
 *
 *   `?agentation=on`   shows it, here and on every later load
 *   `?agentation=off`  hides it again
 *
 * A browser that has never been told either way never loads the chunk.
 */
export const ANNOTATING_KEY = 'book-scan.agentation'

export function wantsAnnotating(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean {
  const asked = new URLSearchParams(search).get('agentation')
  try {
    if (asked === 'on') storage.setItem(ANNOTATING_KEY, 'on')
    if (asked === 'off') storage.removeItem(ANNOTATING_KEY)
    return storage.getItem(ANNOTATING_KEY) === 'on'
  } catch {
    // Storage can refuse outright in a private window. The address bar still
    // answers for this one load.
    return asked === 'on'
  }
}
