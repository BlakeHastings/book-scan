/** Many screens write to this and three of them draw it: the two cameras show it over the viewfinder, and the where-it-goes screen shows it on the page. */

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
