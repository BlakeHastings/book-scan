import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { GateProvider } from './app/gate'
import { galleryRoute } from './design/gallery/route'
import { wantsAnnotating } from './annotating'
import './styles.css'
/*
 * Every rule in the design system is `.wf` or `wf-` prefixed and no design system class name
 * appears in `styles.css`, so nothing here can be redefined from over there. The one deliberate
 * exception is the shelf drawing block at the foot of `styles.css`. See the header of
 * `design/tokens.css` for the `--line` custom property both sides redefine.
 */
import './design/tokens.css'
import './design/library.css'

/** Lazy so the working app does not carry the redesign's screens in its bundle. */
const Gallery = lazy(() => import('./design/gallery/Gallery'))

/** The Agentation toolbar. Vite replaces `import.meta.env.DEV` at build time, so the production bundle never carries the package. See `docs/process/annotating.md`. */
const Annotating =
  import.meta.env.DEV && wantsAnnotating(window.location.search, window.localStorage)
    ? lazy(() =>
        import('agentation').then(({ Agentation }) => ({
          default: () => <Agentation endpoint={import.meta.env.VITE_AGENTATION_ENDPOINT ?? 'http://localhost:4747'} />,
        })),
      )
    : null

/** A hash is enough: the server never sees it, and the phone's back button walks the gallery for free because the browser keeps a history of hashes. */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const read = () => setHash(window.location.hash)
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  const route = galleryRoute(hash)
  // The gate is around the app and not around the gallery: the gallery is a drawing that fetches nothing and holds nobody's rows. See `docs/the-gate.md`.
  if (!route) {
    return (
      <GateProvider>
        <App />
      </GateProvider>
    )
  }

  return (
    <Suspense fallback={null}>
      <Gallery
        screen={route.screen}
        onLeave={() => {
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          setHash('')
        }}
      />
    </Suspense>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <Root />
    {Annotating && (
      <Suspense fallback={null}>
        <Annotating />
      </Suspense>
    )}
  </StrictMode>,
)
