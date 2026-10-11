/**
 * The three resets on the Settings screen, and the words that let each one
 * happen. The server checks the words and the screen asks for them, so they are
 * spelled once. Any enabled user may press these: the typing is the protection,
 * not a role.
 */

export const RESETS = ['unplace', 'history', 'furniture'] as const

export type ResetName = (typeof RESETS)[number]

/** Different for each reset, so typing one cannot carry on into the next by habit. */
export const RESET_PHRASES: Record<ResetName, string> = {
  unplace: 'unplace every book',
  history: 'erase placement history',
  furniture: 'remove all furniture',
}

export function isReset(name: unknown): name is ResetName {
  return typeof name === 'string' && (RESETS as readonly string[]).includes(name)
}

/**
 * Whether what somebody typed is the phrase for this reset. Case and runs of
 * spaces are forgiven, because a phone capitalises the first letter on its own;
 * a different word is not.
 */
export function confirms(name: ResetName, typed: unknown): boolean {
  if (typeof typed !== 'string') return false
  const said = typed.trim().replace(/\s+/g, ' ').toLowerCase()
  return said === RESET_PHRASES[name]
}
