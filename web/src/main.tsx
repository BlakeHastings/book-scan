import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { galleryRoute } from './design/gallery/route'
import './styles.css'
/*
 * The design system, which the app wears on the screens that have been
 * converted to it and the gallery draws every screen with (#303). Eager, and
 * after `styles.css`: it is the app's own stylesheet now, not the gallery's.
 *
 * Every rule in the design system is `.wf` or `wf-` prefixed and no design
 * system class name appears in `styles.css`, so nothing here can be redefined
 * from over there. What crosses the other way is deliberate and there is one
 * block of it, at the foot of `styles.css`: the shelf drawing is one component
 * on two screens, one converted and one not, so its colours are scoped `.wf`
 * and the shapes are shared. That block says so and says when it goes.
 *
 * The rest of the overlap is one custom property, `--line`, which the app
 * defines on `:root` and the design system redefines on `.wf`. Inside a
 * converted screen the warm one wins by inheritance; everywhere else the app's
 * is untouched. See the header of `design/tokens.css`.
 */
import './design/tokens.css'
import './design/library.css'

/**
 * The wireframe gallery, and the only thing that reaches it.
 *
 * Lazy on purpose. The working app is what somebody is holding a book up to,
 * and it should not carry the redesign's screens in its bundle to get there.
 * `galleryRoute` is the only part of the design work the app loads eagerly,
 * and it is twenty lines with no imports. The two stylesheets are no longer
 * part of that bargain: they are above, because the app draws with them.
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
