/**
 * The one line of red, and everything that can put something on it.
 *
 * Many screens write to it and three of them draw it: the two cameras show it
 * over the viewfinder, and the where-it-goes screen shows it on the page. That
 * is the whole reason it is shared rather than owned by a screen, and it is the
 * smallest piece of shared state in the app.
 *
 * **A fourth drew it under the app's own header until #451**, which is the one
 * nothing reached: the header had not been rendered since the last screen was
 * converted, so its copy of this line was never on a screen anybody could get
 * to. It went with the header.
 */

import {
  createContext, useContext, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from 'react'

export interface ErrorBanner {
  readonly error: string
  readonly setError: Dispatch<SetStateAction<string>>
}

const Context = createContext<ErrorBanner | null>(null)

export function ErrorBannerProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState('')
  return <Context.Provider value={{ error, setError }}>{children}</Context.Provider>
}

export function useErrorBanner(): ErrorBanner {
  const found = useContext(Context)
  if (!found) throw new Error('useErrorBanner was called outside ErrorBannerProvider')
  return found
}
