import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { galleryRoute } from './design/gallery/route'
import './styles.css'

/**
 * The wireframe gallery, and the only thing that reaches it.
 *
 * Lazy on purpose. The working app is what somebody is holding a book up to,
 * and it should not carry the redesign's components or its two stylesheets in
 * its bundle to get there. `galleryRoute` is the only part of the design work
 * the app loads eagerly, and it is twenty lines with no imports.
 */
const Gallery = lazy(() => import('./design/gallery/Gallery'))

/**
 * Which of the two the address bar is asking for.
 *
 * The app has no router and this does not add one: a hash is enough, the
 * server never sees it, and the phone's back button walks the gallery for
 * free because the browser already keeps a history of hashes.
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const read = () => setHash(window.location.hash)
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  const route = galleryRoute(hash)
  if (!route) return <App />

  return (
    <Suspense fallback={null}>
      <Gallery
        screen={route.screen}
        onLeave={() => {
          // Drop the hash without a reload, so leaving the wireframe puts the
          // app back on a clean URL rather than one ending in `#`.
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
  </StrictMode>,
)
