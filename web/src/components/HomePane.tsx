/**
 * Where the app opens: what is worth knowing, and what to do about it.
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
 * ## What round eight took off it, and it is a third of what was here (#361)
 *
 * Two headings, one sentence and two lists of books. The owner walked it and
 * named the fault before he named the fix:
 *
 * > At the top we have "forty books are waiting on the table", and then we show
 * > them again, like the "needs you". So I don't know if we need that. And then
 * > we have "ready to shelve" again.
 *
 * **How many books are ready to shelve was on this screen three times**: in the
 * sentence at the top, in a count in the middle, and as a card at the bottom
 * naming two of them. The count is the one that stays. The queue is one press
 * away in the tab bar and is the screen whose whole job is that list, so the
 * card was a worse copy of it drawn on the screen somebody opens most often.
 * The same argument takes the carry card, and it is the argument that took the
 * camera card off two rounds ago.
 *
 * What genuinely left with the sentence is the count of books still being
 * looked up: they are neither ready nor stuck, so no count here holds them.
 * They are on the queue, which is one press, and they stop being pending on
 * their own within about a minute.
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
 * Five counts and five destinations, and the headings they used to sit under
 * are gone: "the collection" and "needs you" were the shape #283 gave this
 * screen and #361 took away, because a person reading five numbers does not
 * need to be told which two of them are about the shelf.
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
 * ## The three doors, and what is deliberately not one
 *
 * **The book in your hand** (#355) is the camera you point at a book you
 * already own, which no tab reaches and which had this screen's corner until
 * the corner became the profile icon. Nobody chose what that cost: the owner
 * asked for a profile icon and got one; he did not ask for the thing this app
 * is for, standing in a room holding a book and wondering whether you already
 * own it, to go from **one press to three**. It is one press again, and the
 * corner is not taken back.
 *
 * **Carrying** is the second, and it is here because nothing else reaches it
 * either: a rule change can displace fifty books in an afternoon, the carry
 * list is a flow of its own since #314, and the tab bar opens four rooms of
 * which it is not one.
 *
 * **The books no rule claims** is the third and last (#341), and its argument
 * is stronger than either. A book with no genre tag is the honest outcome
 * whenever no catalogue states one, which is what #304 settled, and such a book
 * appears in no range listing, in neither misfile review, in none of these five
 * counts and on no area's claimed-by-nothing card, because that card reads the
 * area a book has and this book has none. It stands where somebody left it and
 * no plan will ever move it. So without this row the app mentions the books
 * most in need of a person less than it mentions any other kind, which is the
 * whole of the complaint that issue makes.
 *
 * Three is the ceiling and this reaches it. The next thing that wants a row
 * here takes one of these off.
 *
 * What is not here is anything with a tab: photographing a book, the queue and
 * the library are all one press already. Nor finding a book by name, which is
 * one press from the row above the books on every library screen and would put
 * a second row saying "find" next to this one, on the single screen where two
 * ways of finding must not be confused.
 *
 * **Neither door is drawn when it can do nothing.** The camera needs something
 * to hold a book against, which is the catalogue **or** the table: holding up
 * the twin of a book waiting on the table is how somebody finds the photograph
 * a housemate took instead of making a second one, which is the whole of #122.
 * The carry door needs something to carry.
 *
 * ## It holds no state, on purpose
 *
 * Everything it draws arrives as a prop, so it stays callable as a plain
 * function and its test can render it as markup. The extra read the design asks
 * for, the books that need carrying, is made by `App` beside the two it already
 * made.
 */

import type { ReactElement, ReactNode } from 'react'
import { TopBar, type TabName } from '../design/Chrome'
import { CarryBooks, Doors, InHand, SayWhat } from '../design/Controls'
import { Stats } from '../design/List'
import { Phone } from '../design/Phone'
import { Trouble } from '../design/Trouble'
import { troubleWith } from '../lib/backupWords'
import { grouped } from '../lib/say'
import type { BackupWatch, CarryItem, Counts, QueueCounts } from '../lib/api'

interface Props {
  counts: Counts | null
  queue: QueueCounts | null
  /**
   * Books that are not where they now belong. Null until the read has
   * answered, which is a different thing from none: a count drawn from a
   * request that has not come back is a guess, so it is left out instead.
   */
  carrying: CarryItem[] | null
  /**
   * How many books no rule claims (#341). Null until the read has answered.
   *
   * The count and not the books, because this screen never names them: that is
   * the deletion round eight made twice over, and the list is one press away on
   * the screen whose whole job it is. Null draws no door at all, which is the
   * same discipline `carrying` keeps and for the same reason: "none" and
   * "nobody answered" are different things to say to somebody deciding whether
   * there is work waiting.
   */
  unclaimed: number | null
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
   * library's needs-attention list. The count and the door both open it,
   * because they are two different things said about the same books: how many
   * there are, and what somebody is being invited to do about them.
   */
  onCarry: () => void
  /**
   * Go and say what the books no rule claims are (#341).
   *
   * The one door here with no count above it, and that is the point rather than
   * an omission: the five counts are the five the owner named and both suites
   * pin the list, so this job's only way of being on this screen at all is the
   * row that says what to do about it.
   */
  onUnclaimed: () => void
}

/** How many books are on the table, which is the whole queue. */
function waitingIn(queue: QueueCounts): number {
  return queue.pending + queue.ready + queue.failed
}

export function HomePane({
  counts, queue, carrying, unclaimed, backup,
  onAdd, onInHand, corner, menu, onLibrary, onQueue, onCarry, onUnclaimed,
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
       * is a row on the screen now. The gallery has one camera and this app has
       * two; that camera did not lose its door, it moved down the screen and
       * onto the screen about finding a book. See `FindPane`.
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
  /*
   * Nothing owned and nothing photographed, which is a real evening rather than
   * a state to be defended against: it is the first one. The cat sleeps through
   * it instead of the screen saying "nothing is catalogued yet" over a tile
   * that reads nought catalogued, which is the same fact twice and is what this
   * round took off the screen everywhere else.
   */
  const bare = counts.total === 0 && waiting === 0

  return (
    <Screen top={top} tabs={tabs} over={menu}>
      {news}

      {/*
        The cat, and since #410 he lies across this screen rather than standing
        at the end of a row of it.

        > I'd like the actions that we have available to be scooted down, and
        > then the cat laying down sleeping with its tail going behind those
        > buttons, and the tail slightly moving, and the cat's eyes sometimes
        > slowly opening a little bit and then closing.

        `lying` is the pose that reaches, `Stats` brings the scoot with it, and
        the doors paint over the tail. **The first evening keeps the loaf**: it
        draws no doors at all, and a tail reaching behind buttons that are not
        there is a tail in mid-air, so the two days stay two drawings the way
        round eight left them.
      */}
      <Stats
        cat={bare ? 'sleeping' : 'lying'}
        items={[
          { n: grouped(counts.total), word: 'catalogued', onPress: onLibrary },
          { n: grouped(counts.checkedOut), word: 'checked out', onPress: onLibrary },
          { n: grouped(queue.ready), word: 'ready to shelve', onPress: onQueue },
          ...(carrying
            ? [{ n: grouped(carrying.length), word: 'to carry', onPress: onCarry }]
            : []),
          { n: grouped(queue.failed), word: 'stuck', onPress: onQueue },
        ]}
      />

      {/*
        The things to do, under the numbers they are about.

        Each is drawn only on a day it can do something, which is why there is
        no `Doors` at all on the first evening: a screen whose whole argument is
        that everything on it earns its place cannot carry a door to an empty
        room. The camera answers a book against the catalogue **or** the table,
        and the second half of that is not a technicality (#122).
      */}
      {(counts.total > 0 || waiting > 0
        || (carrying && carrying.length > 0)
        || (unclaimed !== null && unclaimed > 0)) && (
        <Doors>
          {(counts.total > 0 || waiting > 0) && <InHand onPress={onInHand} />}
          {carrying && carrying.length > 0 && <CarryBooks onPress={onCarry} />}
          {/*
            The books no rule claims (#341), and this row is the whole of what
            this screen says about them. There is no count above it and there
            cannot be: the five are the five the owner named. A person who never
            walks the furniture would otherwise never learn that a dozen of
            their books stand where nothing will ever move them, which is the
            complaint that issue is.
          */}
          {unclaimed !== null && unclaimed > 0 && <SayWhat onPress={onUnclaimed} />}
        </Doors>
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
