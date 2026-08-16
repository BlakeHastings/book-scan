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
 * carry list, which is where the trips are and where somebody says they have
 * carried a book. That last one went to the library until #314 built the flow.
 *
 * ## The collection leads (#283)
 *
 * "The collection" sat last, under everything asking for attention, and round
 * six moved it above "Needs you". The order within each block did not change,
 * only which block comes first, so the screen now opens with what is owned
 * rather than with what is asking.
 *
 * ## The one thing on it that is not work (#311)
 *
 * A card at the top saying the collection has stopped being backed up. It is
 * the only thing on this screen nobody can act on from the phone, and it is
 * here because the alternative was a log: the nightly backup has stopped twice,
 * for two unrelated reasons, and both times the only thing that knew was a file
 * on a disk and it took days for somebody to happen to look.
 *
 * The owner looks at this app. So the app is what says it, on the screen that
 * already exists to tell him what needs him, and it says it about the artefact
 * rather than about the job: the job started on both of those nights.
 *
 * **It draws nothing at all when there is nothing wrong**, and nothing when no
 * directory is being watched, which is every development checkout. There is no
 * reassuring version of this card, on purpose: a line saying backups are fine
 * is a line that can be printed over a disk nobody read.
 *
 * ## The one door on it, which is a thing that was taken away by accident (#355)
 *
 * The paragraph above about the camera card is still true and this is not it.
 * That card offered the camera the tab bar opens, which is the one that
 * catalogues a book nobody has yet. This is the other camera: the one you
 * point at a book you already own, which no tab reaches and which had this
 * screen's corner until the corner became the profile icon.
 *
 * Nobody chose what that cost. The owner asked for a profile icon and got one;
 * he did not ask for the thing this app is for, standing in a room holding a
 * book and wondering whether you already own it, to go from **one press to
 * three**. It is one press again, and the corner is not taken back: the corner
 * is spoken for and the reason it is spoken for is good.
 *
 * It sits under the collection's counts rather than above them, so nothing the
 * owner has already approved moves, and it is drawn as a door rather than a
 * tile because it is not a count and the screen must not read as though it
 * were. **It is not drawn on the day there is nothing at all**: no catalogue
 * and nothing on the table is a camera that can answer nothing, and a spare
 * screen does not carry a door to an empty room. A book on the table counts,
 * and that is not a technicality: holding up a book somebody else has already
 * photographed is how the second capture of it does not get made (#122).
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
import { Button, InHand } from '../design/Controls'
import { List, Row, Stats } from '../design/List'
import { Phone } from '../design/Phone'
import { Trouble } from '../design/Trouble'
import { clothFor } from '../lib/bookLook'
import { troubleWith } from '../lib/backupWords'
import { grouped } from '../lib/say'
import { filingName } from '../../shared/shelving'
import {
  captureName, draftFromCapture,
  type BackupWatch, type CarryItem, type Capture, type Counts, type QueueCounts,
} from '../lib/api'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  /** The queue itself, so the ones ready to shelve can be named and opened. */
  queued: Capture[]
  /**
   * Books that are not where they now belong. Null until the read has
   * answered, which is a different thing from none: a count drawn from a
   * request that has not come back is a guess, so it is left out instead.
   */
  carrying: CarryItem[] | null
  /**
   * Whether the collection has a backup anybody has proved restores (#311).
   *
   * Null until the read answers, and null if it failed, and both of those draw
   * nothing. So does a backup that is fine, and so does a checkout that watches
   * no directory at all: this card is only ever on the screen when there is
   * something wrong that nothing else was going to mention.
   */
  backup: BackupWatch | null
  /** Photograph a book, which is what the fourth tab is for. */
  onAdd: () => void
  /**
   * The other camera: hold a book you already own up to it (#355).
   *
   * **Not `onAdd` and never the same handler.** One of these two catalogues a
   * book the collection has never seen and the other identifies one it
   * already has, and landing on the wrong one from here means somebody
   * photographing a book they own into a second record.
   */
  onInHand: () => void
  /**
   * The one action in the corner, which is the way to your own room (#350).
   *
   * Handed in rather than built here, and the sheet it opens with it, because
   * the same corner is on the library screen and one of them written out twice
   * is two corners that agree until one is edited. `components/RoomMenu.tsx`
   * is where it is decided; this screen only has a top right.
   */
  corner: { word: string; icon: ReactNode; onPress: () => void }
  /** That menu, while it is open. */
  menu?: ReactElement
  onLibrary: () => void
  onQueue: () => void
  /**
   * Go and carry them, which is a flow of its own since #314 and used to be the
   * library's needs-attention list. Both counts on this card open it, because
   * both are about the same books.
   */
  onCarry: () => void
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
/*
 * Both of these were written here first and both moved out when the library
 * screen needed them: a book has to be the same colour on this screen and on
 * that one, and a number has to be said the same way on both. `lib/bookLook.ts`
 * and `lib/say.ts`.
 */

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
  counts, queue, queued, carrying, backup,
  onAdd, onInHand, corner, menu, onLibrary, onQueue, onCarry, onOpenReady,
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
       * The profile icon, and the reason this is where it matters most: this is
       * the screen somebody who has never seen the app is standing on when they
       * go looking for the thing they cannot find.
       *
       * It replaced "Find the book in your hand", which was in this corner and
       * is not in the drawing at all: the gallery has one camera and this app
       * has two. That camera did not lose its door, it moved to the screen
       * about finding a book, which is where it belonged once finding stopped
       * being a corner action. See `FindPane`.
       */
      action={corner}
    />
  )

  /*
   * Worked out before the counts are waited for, and drawn on that screen too.
   *
   * The two answers are independent: this one comes off a disk and the counts
   * come out of the catalogue, so a catalogue that is slow or down must not be
   * able to hide the news that nothing has been backed up. That combination is
   * not far-fetched, it is the morning after the worst kind of night.
   */
  const trouble = troubleWith(backup)
  const news = trouble && (
    <Trouble kind="Backups" title={trouble.title}>{trouble.said}</Trouble>
  )

  // Nothing has come back yet. Drawing zeros would be saying something false
  // about somebody's collection for as long as the first request takes.
  if (!counts || !queue) return <Screen top={top} tabs={tabs} over={menu}>{news}</Screen>

  const waiting = waitingIn(queue)
  const ready = queued.filter((capture) => capture.status === 'ready')

  return (
    <Screen top={top} tabs={tabs} over={menu}>
      {news}
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

      {/*
        The way to the book in your hand, closing the collection block (#355).

        Drawn once there is anything to hold a book against, which is the
        catalogue **or** the table, and not only the catalogue. A book waiting
        on the table is one this collection already has a start on: holding its
        twin up is how somebody finds the capture a housemate made instead of
        photographing it a second time, which is the whole of #122 and is a
        journey. That is the same emptiness the sentence above draws `Nothing`
        for, and on that day this door leads to a camera that can answer
        nothing about a book.
      */}
      {(counts.total > 0 || waiting > 0) && <InHand onPress={onInHand} />}

      <p className="wf-heading wf-heading--flush">Needs you</p>
      <Stats
        items={[
          { n: grouped(queue.ready), word: 'ready to shelve', onPress: onQueue },
          ...(carrying
            ? [{ n: grouped(carrying.length), word: 'to carry', onPress: onCarry }]
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
            {carrying.slice(0, 3).map((one) => (
              <Row
                key={one.book.id}
                title={one.book.title}
                sub={one.book.authorFiling}
                cloth={clothFor(one.book.id)}
                meta={`${one.from} to ${one.to}`}
                onPress={onCarry}
              />
            ))}
          </List>
          <Button tone="quiet" onPress={onCarry}>
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
  top, tabs, over, children,
}: {
  top: ReactElement
  tabs: Record<TabName, () => void>
  /** The corner's menu, when it is open, drawn over the screen it came out of. */
  over?: ReactElement
  children?: ReactNode
}) {
  return (
    <div className="wf">
      <Phone tab="home" onTab={(name) => tabs[name]()} top={top} over={over}>
        {children}
      </Phone>
    </div>
  )
}
