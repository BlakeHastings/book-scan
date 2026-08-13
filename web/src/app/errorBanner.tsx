/**
 * The one line of red, and everything that can put something on it.
 *
 * Every screen writes to it and two of them draw it: the scrolling pages show
 * it under the header, the camera shows it over the viewfinder. That is the
 * whole reason it is shared rather than owned by a screen, and it is the
 * smallest piece of shared state in the app.
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
