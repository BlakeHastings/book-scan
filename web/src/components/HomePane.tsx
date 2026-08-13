/**
 * Where the app opens: what is worth knowing, and nothing else.
 *
 * This is the first screen drawn with the design system rather than described
 * by it. Everything on it comes from `src/design`, the same components the
 * gallery draws `#/design/home` with, so the two are one screen with two sets
 * of numbers in it.
 *
 * ## What it stopped being
 *
 * Three tiles and a queue button. The owner took the camera off this screen by
 * name: "let's not even have the book scanning part here, let's just have
 * metrics, useful information. Like, for example, six are ready to shelve or
 * three books to carry." Photographing a book is one tap away in the tab bar,
 * from here and from everywhere else, so a card offering it was a second door
 * to a room the tabs already open, and it was taking the middle of the screen
 * somebody opens most often.
 *
 * ## Every number goes somewhere
 *
 * That is a pinned rule of the design system and it is the easy one to lose in
 * a conversion: a count nobody can act on is decoration, and decoration is
 * what a screen made of counts fills up with. Catalogued and checked out open
 * the library; ready to shelve and stuck open the queue; to carry opens the
 * library, which is where the list of books that are not where they belong
 * lives and where somebody says they have carried one.
 *
 * ## The collection leads (#283)
 *
 * "The collection" sat last, under everything asking for attention, and round
 * six moved it above "Needs you". The order within each block did not change,
 * only which block comes first, so the screen now opens with what is owned
 * rather than with what is asking.
 *
 * ## It holds no state, on purpose
 *
 * Everything it draws arrives as a prop, so it stays callable as a plain
 * function and its test can render it as markup. The two extra reads the
 * design asks for, the queue itself and the books that need carrying, are made
 * by `App` beside the two it already made.
 */

import type { ReactElement, ReactNode } from 'react'
import { Beside, Card, Nothing } from '../design/Card'
import { TopBar, type TabName } from '../design/Chrome'
import { Button } from '../design/Controls'
import { IconFind } from '../design/Icons'
import { List, Row, Stats } from '../design/List'
import { Phone } from '../design/Phone'
import type { Cloth } from '../design/Shelf'
import { filingName } from '../../shared/shelving'
import {
  captureName, draftFromCapture,
  type Capture, type Counts, type Misfile, type QueueCounts,
} from '../lib/api'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  /** The queue itself, so the ones ready to shelve can be named and opened. */
  queued: Capture[]
  /**
   * Books the shelving review says are not where they now belong. Null until
   * it has answered, which is a different thing from none: a count drawn from
   * a request that has not come back is a guess, so it is left out instead.
   */
  carrying: Misfile[] | null
  /** Photograph a book, which is what the fourth tab is for. */
  onAdd: () => void
  /** Hold a book you already have up to the camera, to find it. */
  onScan: () => void
  onLibrary: () => void
  onQueue: () => void
  onOpenReady: (capture: Capture) => void
}

/**
 * The bindings a placeholder thumbnail is drawn in.
 *
 * A row in the gallery wears a cloth because the wireframe has no photographs;
 * a row here wears one because `Row` has nowhere to put a photograph yet, and
 * giving it one belongs with the library screen, which draws hundreds of them.
 * Picked off the book's own id so a book is the same colour every time it is
 * drawn rather than a different one on every render.
 */
const CLOTHS: Cloth[] = ['moss', 'plum', 'sky', 'sun', 'wood', 'wood2']

function clothFor(id: number): Cloth {
  return CLOTHS[Math.abs(id) % CLOTHS.length]!
}

/**
 * A number as this screen says it.
 *
 * Grouped, because the collection reaches four digits and 1204 read as a year
 * at the size these are set. Written out rather than taken from
 * `toLocaleString`, so the same number is the same string wherever this runs.
 */
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** How many books are on the table, which is the whole queue. */
function waitingIn(queue: QueueCounts): number {
  return queue.pending + queue.ready + queue.failed
}

/**
 * The one sentence on the screen.
 *
 * The drawing spells its number out, because it is one number somebody typed.
 * This one is whatever the queue holds, so it is digits: spelling every number
 * a real queue can reach is a table nobody would keep true.
 */
function onTheTable(waiting: number): string {
  if (waiting === 0) return 'Nothing is waiting on the table.'
  if (waiting === 1) return 'One book is waiting on the table.'
  return `${grouped(waiting)} books are waiting on the table.`
}

/** What a queued book is called, and who this collection files it under. */
function nameOf(capture: Capture): { title: string; sub: string } {
  const draft = draftFromCapture(capture)
  const first = draft.authors.split(',')[0]?.trim() ?? ''
  return { title: captureName(capture).text, sub: first ? filingName(first) : '' }
}

export function HomePane({
  counts, queue, queued, carrying, onAdd, onScan, onLibrary, onQueue, onOpenReady,
}: Props) {
  const tabs: Record<TabName, () => void> = {
    home: () => {},
    library: onLibrary,
    scan: onAdd,
    queue: onQueue,
  }

  const top = (
    <TopBar
      title="Book scan"
      /*
       * Not in the drawing, and named in the pull request as a departure. The
       * gallery has one camera; this app has two, and the second one, the one
       * that finds a book you are already holding, has no other door in the
       * whole interface. It carries a word as its accessible name because
       * every glyph in a corner does.
       */
      action={{
        word: 'Find the book in your hand',
        icon: <IconFind />,
        onPress: onScan,
      }}
    />
  )

  // Nothing has come back yet. Drawing zeros would be saying something false
  // about somebody's collection for as long as the first request takes.
  if (!counts || !queue) return <Screen top={top} tabs={tabs} />

  const waiting = waitingIn(queue)
  const ready = queued.filter((capture) => capture.status === 'ready')

  return (
    <Screen top={top} tabs={tabs}>
      {counts.total === 0 && waiting === 0 ? (
        <Nothing said="Nothing is catalogued yet." />
      ) : (
        <Beside>{onTheTable(waiting)}</Beside>
      )}

      <p className="wf-heading wf-heading--flush">The collection</p>
      {/*
        Two counts where the drawing has three. The middle one is "9 added this
        week", and nothing the browser can ask answers it: a book carries no
        date it was added on the wire. Left out rather than approximated, and
        named in the pull request.
      */}
      <Stats
        items={[
          { n: grouped(counts.total), word: 'catalogued', onPress: onLibrary },
          { n: grouped(counts.checkedOut), word: 'checked out', onPress: onLibrary },
        ]}
      />

      <p className="wf-heading wf-heading--flush">Needs you</p>
      <Stats
        items={[
          { n: grouped(queue.ready), word: 'ready to shelve', onPress: onQueue },
          ...(carrying
            ? [{ n: grouped(carrying.length), word: 'to carry', onPress: onLibrary }]
            : []),
          { n: grouped(queue.failed), word: 'stuck', onPress: onQueue },
        ]}
      />

      {ready.length > 0 && (
        <Card title="Ready to shelve">
          <List label="Ready to shelve">
            {ready.slice(0, 3).map((capture) => {
              const named = nameOf(capture)
              return (
                <Row
                  key={capture.id}
                  title={named.title}
                  sub={named.sub}
                  cloth={clothFor(capture.id)}
                  onPress={() => onOpenReady(capture)}
                />
              )
            })}
          </List>
          <Button tone="quiet" onPress={onQueue}>
            All {grouped(waiting)}
          </Button>
        </Card>
      )}

      {carrying && carrying.length > 0 && (
        <Card title="Books to carry">
          <List label="Books to carry">
            {carrying.slice(0, 3).map((misfile) => (
              <Row
                key={misfile.book.id}
                title={misfile.book.title}
                sub={misfile.book.authorFiling}
                cloth={clothFor(misfile.book.id)}
                meta={`${misfile.from} to ${misfile.to}`}
                onPress={onLibrary}
              />
            ))}
          </List>
          <Button tone="quiet" onPress={onLibrary}>
            All {grouped(carrying.length)}
          </Button>
        </Card>
      )}
    </Screen>
  )
}

/**
 * The phone frame, with the token scope on it.
 *
 * `.wf` is where every colour, size and radius in the design system is
 * defined, so a screen drawn with these components has to sit inside one. The
 * app's own stylesheet keeps `:root` and is untouched by it: the one name both
 * files use is `--line`, and inside here the warm one wins.
 */
function Screen({
  top, tabs, children,
}: {
  top: ReactElement
  tabs: Record<TabName, () => void>
  children?: ReactNode
}) {
  return (
    <div className="wf">
      <Phone tab="home" onTab={(name) => tabs[name]()} top={top}>
        {children}
      </Phone>
    </div>
  )
}
