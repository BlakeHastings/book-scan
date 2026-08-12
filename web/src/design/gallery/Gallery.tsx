/**
 * The wireframe gallery.
 *
 * Reachable at `#/design` in the running app, behind a lazy import, so the
 * working app neither loads this code nor loads its stylesheets until
 * somebody asks for it by name. That is what "additive" means here: not just
 * that nothing existing changed, but that nothing existing got heavier.
 *
 * Two things this owns and no screen does: which theme is being looked at,
 * and the strip at the top that says you are in the viewer rather than in the
 * app.
 */

import { useEffect, useRef, useState } from 'react'
import { GROUPS, SCREENS } from './screens'
import { hashFor } from './route'
import { Cat } from '../Cat'
import { IconBack, IconOnward } from '../Icons'
import '../tokens.css'
import '../library.css'

/** Light, dark, or whatever the phone is set to. */
type Theme = 'light' | 'dark' | 'phone'

const THEME_KEY = 'bookscan.wireframe.theme'

export default function Gallery({
  screen,
  onLeave,
}: {
  /** Null on the index. */
  screen: string | null
  /** Back to the working app. */
  onLeave: () => void
}) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'phone',
  )
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  /*
   * The app's own stylesheet paints `body` a cold dark blue-grey, and that
   * shows either side of the phone column on a wide screen and under an
   * overscroll bounce on the phone itself: a warm light page with a cold dark
   * band above it when you pull down. Found by pulling down on it.
   *
   * The colour is copied off whatever the tokens resolved to rather than
   * written here, so there is still exactly one place a background is decided,
   * and it is put back when the gallery closes.
   */
  useEffect(() => {
    const was = document.body.style.background
    if (root.current) {
      document.body.style.background = getComputedStyle(root.current).backgroundColor
    }
    return () => {
      document.body.style.background = was
    }
  }, [theme])

  const found = screen ? SCREENS.find((s) => s.id === screen) : null
  const go = (id: string) => {
    window.location.hash = hashFor(id)
    window.scrollTo(0, 0)
  }

  const at = found ? SCREENS.indexOf(found) : -1
  const next = at >= 0 ? SCREENS[(at + 1) % SCREENS.length] : null

  return (
    <div className="wf" ref={root} data-theme={theme === 'phone' ? undefined : theme}>
      <div className="wf-frame">
        {found ? (
          <button
            type="button"
            className="wf-frame__home"
            onClick={() => {
              window.location.hash = hashFor()
              window.scrollTo(0, 0)
            }}
          >
            <IconBack size={16} />
            Index
          </button>
        ) : (
          <button type="button" className="wf-frame__home" onClick={onLeave}>
            <IconBack size={16} />
            App
          </button>
        )}

        <span className="wf-frame__name">{found ? found.name : 'Wireframe'}</span>

        <div className="wf-frame__theme" role="group" aria-label="Theme">
          {(['light', 'phone', 'dark'] as Theme[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => setTheme(option)}
            >
              {option === 'phone' ? 'Auto' : option === 'light' ? 'Day' : 'Night'}
            </button>
          ))}
        </div>
      </div>

      {found ? (
        <>
          {found.render(go)}
          {next && (
            <button type="button" className="wf-next" onClick={() => go(next.id)}>
              <span>Next: {next.name}</span>
              <IconOnward size={18} />
            </button>
          )}
        </>
      ) : (
        <Index go={go} />
      )}
    </div>
  )
}

function Index({ go }: { go: (id: string) => void }) {
  return (
    <div className="wf-index">
      <div className="wf-index__hello">
        <Cat pose="sitting" size={76} label="The mascot, a black cat" />
        <h1 className="wf-index__title">Book scan, redesigned</h1>
        <p className="wf-index__note">
          A first pass. Every screen is static: nothing here fetches, saves or
          moves a book. Day and night are drawn separately, so switch between
          them above.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group} style={{ display: 'grid', gap: 8 }}>
          <h2 className="wf-index__group">{group}</h2>
          <div className="wf-list">
            {SCREENS.filter((s) => s.group === group).map((s) => (
              <button key={s.id} type="button" className="wf-row" onClick={() => go(s.id)}>
                <span className="wf-place wf-place--quiet">
                  {String(SCREENS.indexOf(s) + 1).padStart(2, '0')}
                </span>
                <span className="wf-row__text">
                  <span className="wf-row__title">{s.name}</span>
                  <span className="wf-row__sub">#/design/{s.id}</span>
                </span>
                <span className="wf-row__meta">
                  <IconOnward size={18} />
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
