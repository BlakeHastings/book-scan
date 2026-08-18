/**
 * The screens, drawn with the component library and nothing else.
 *
 * Static content, deliberately. Nothing here fetches, and no screen holds
 * state beyond what the gallery hands it: this is about form, and a wireframe
 * that talks to a server is a second implementation of the app that has to be
 * kept in step with the first one.
 *
 * The books are real books and the numbers are plausible, because a wireframe
 * full of "Lorem" tells you nothing about whether a title wraps.
 *
 * Each screen is a whole phone screen: its own top bar, its own scrolling
 * body, its own tab bar. The tab bar and most buttons are wired to `go`, so
 * the owner can walk a journey on the phone rather than tapping back to the
 * index between every screen.
 *
 * ## No word here comes out of the model
 *
 * The owner read the library screen and stopped at one word:
 *
 * > A run doesn't make any sense to the user. We shouldn't expose that as a
 * > user translation of concepts.
 *
 * He is right about "run" and the same is true of every other word this
 * codebase says to itself. A person owns bookcases, each holding areas, each
 * holding books; they do not own runs, ranges, planks, separators, sort keys
 * or captures. `design.test.tsx` pins the list, so the next screen cannot
 * quietly reintroduce one.
 */

import type { ReactElement, ReactNode } from 'react'
import { Actions, Head, Part, Tagged, Tagging, Where } from '../Book'
import { Viewfinder } from '../Camera'
import { Card, Confirmation, Instruction, Nothing, Said } from '../Card'
import { Trip, Trips } from '../Carrying'
import { Cat } from '../Cat'
import {
  Button, CarryBooks, Choice, Doors, Field, InHand, IN_HAND, SayWhat, Segmented,
} from '../Controls'
import { Covers, covers } from '../Covers'
import {
  Filter,
  SearchField,
  Suggestion,
  Suggestions,
  TagGroup,
  TagPick,
  type Look,
} from '../Finding'
import { AddBox, AreaBox, Claim, Nest, Order } from '../Furniture'
import {
  FilterRule, MoveBooks, SortRule, WouldHappen,
  type OrderEnds, type RuleEditing, type RuleSaid, type WouldMove,
} from '../Rules'
import { IconCamera, IconEdit, IconInHand } from '../Icons'
import { AddTag, List, Place, Row, Stats, Tag, Tags } from '../List'
import { Make, Naming } from '../Naming'
import { Phone as Frame } from '../Phone'
import { Queued } from '../Queue'
import { Shelf, spines, type Cloth, type ShelfItem } from '../Shelf'
import { Shots, threeSlots, type Shot } from '../Shots'
import { Sure } from '../Sure'
import { Trouble } from '../Trouble'
import { Corner, FIXTURES_WORD, Portrait, TopBar, type TabName } from '../Chrome'

/** Move to another screen of the gallery. */
export type Go = (screen: string) => void

export interface Screen {
  id: string
  /** What it is called in the index and in the gallery's own bar. */
  name: string
  /** The heading it files under in the index. */
  group: string
  render: (go: Go) => ReactElement
}

/**
 * The corner, on every screen a person lives on.
 *
 * Six of them draw it: the first screen, the three library screens, and the
 * queue in both its states. Those are exactly the screens with no back arrow,
 * which is the rule rather than a list: a corner action is the one thing a
 * screen offers, and a screen you arrived at already has one (Edit, on a
 * book). Somewhere you live has the same corner wherever you are, which is
 * what makes it worth learning, and it is why the furniture is now reachable
 * from anywhere rather than from the foot of one screen.
 *
 * It is a function because the icon is an element and the name and the
 * destination are the same on all six: written out per screen it would be six
 * chances for one of them to say something slightly different.
 */
function you(go: Go, open = false) {
  return {
    word: FIXTURES_WORD,
    icon: <Portrait />,
    onPress: () => go(open ? 'home' : 'menu'),
  }
}

/**
 * Which screen each of the four tabs opens, in the gallery.
 *
 * Exported so `design.test.tsx` can ask whether a door on the first screen goes
 * somewhere a tab already goes, against this table rather than against a copy
 * of it that would stop being true the day a tab changed.
 */
export const TAB_SCREENS: Record<TabName, string> = {
  home: 'home',
  library: 'library',
  scan: 'camera',
  queue: 'queue',
}

/**
 * Every screen wears the same frame, so no screen has to remember to.
 *
 * The frame itself is `Phone` in the design system, imported here as `Frame`
 * so this file can keep the name its thirty-six screens already call. It moved
 * out because `src/components` draws the first screen with the same one, and a
 * frame written twice is two frames that agree until one of them is edited.
 * This wrapper is the gallery's way of calling it: a tab goes to a screen of
 * the gallery rather than to a journey.
 */
function Phone({
  children,
  tab,
  go,
  top,
  over,
}: {
  /*
   * `ReactNode` rather than one element or an array of them, since #311: a
   * screen that draws something only on the day it has bad news has an
   * `undefined` in among its children on every other day, and the frame this
   * hands off to has always taken exactly this.
   */
  children: ReactNode
  tab: TabName
  go: Go
  top: ReactElement
  over?: ReactElement
}) {
  return (
    <Frame tab={tab} onTab={(name) => go(TAB_SCREENS[name])} top={top} over={over}>
      {children}
    </Frame>
  )
}

/* --- Every day ---------------------------------------------------------- */

/**
 * The first screen: the numbers, then the things you can do about them.
 *
 * ## What round eight took off it (#361)
 *
 * Two headings, a sentence and three cards. The owner walked it and said what
 * was wrong with it in one breath:
 *
 * > At the top we have "forty books are waiting on the table", and then we show
 * > them again, like the "needs you". So I don't know if we need that. And then
 * > we have "ready to shelve" again. I think we need to decide what's the most
 * > meaningful things to show on this screen and then choose to show those.
 *
 * and then said what he wanted instead:
 *
 * > So we get rid of the collection, and we get rid of "needs you", and instead
 * > we just have those numbers there: catalogued, checked out, ready to shelve,
 * > to carry, stuck. And we get rid of "forty books are waiting on the table".
 * > We still should have the cat icon on this screen though, because it's cute.
 * > And then underneath those, we have the button for "find the book in your
 * > hand", and that should have an icon. And any of the other most meaningful
 * > actions in the application.
 *
 * **One fact was being told three times.** How many books are ready to shelve
 * was a sentence at the top, a count in the middle and a card at the bottom
 * with two of them named in it, and the cards are the third telling. So the
 * sentence is gone, the count is what stays, and the queue is what says which
 * books: it is one press away in the tab bar and it is the screen whose whole
 * job is that list. The same argument takes the carry card, and it is the same
 * argument that took the camera card off this screen two rounds ago.
 *
 * ## Five counts, ungrouped, and every one of them still goes somewhere
 *
 * Catalogued and checked out open the library, ready to shelve and stuck open
 * the queue, to carry opens the carry list. That is the pinned rule and it
 * survives losing the headings: a number nobody can act on is decoration, and
 * decoration is what a screen made of counts fills up with.
 *
 * Two the catalogue can answer are deliberately not here. How many books have
 * no photograph, and how many carry a genre nobody confirmed, are both true and
 * neither leads anywhere a person can do anything about today.
 *
 * ## Three actions, and the argument is about what is not on it
 *
 * **Find the book in your hand**, which is the camera no tab opens and which
 * this screen owes a press to (#355); **carry books where they belong**, which
 * is the one job in this app that has a flow of its own and no door in the tab
 * bar; and **say what the books nothing files are** (#341), which is the other
 * one, and which nothing on this screen mentioned at all until it was added.
 *
 * That third one is the ceiling reached rather than a fourth thing sneaking on.
 * It earns the row on the argument the other two earn theirs on: no tab opens
 * it, and no count here holds those books. They are not the collection, not the
 * table and not the carry list, so a person could open this app every day and
 * never learn they exist, which is exactly what #341 says happened.
 *
 * Photographing a book, the queue and the library are all tabs, one press from
 * here and from everywhere else, and a button for a room the tab bar already
 * opens earns nothing: that is what the camera card was. Finding a book by its
 * name is one press from the row above the books on every library screen and is
 * pinned there; a second door to it here would also be a row saying "find" next
 * to another row saying "find", on the one screen where two ways of finding
 * must not be confused. Your furniture and settings are what the corner is for.
 *
 * ## The cat sits at the end of the counts, and since #410 he lies down in it
 *
 * He was beside the sentence, the sentence has gone, and the sixth cell of a
 * five-count grid is somewhere he already belongs: closing a run is one of the
 * three jobs he has. See `Stats`.
 *
 * > I'd like the actions that we have available to be scooted down, and then
 * > the cat laying down sleeping with its tail going behind those buttons, and
 * > the tail slightly moving, and the cat's eyes sometimes slowly opening a
 * > little bit and then closing.
 *
 * That is what this screen draws now, and the two halves of it belong to two
 * different things. **The cat is a pose and a behaviour**: `lying`, `dozing`,
 * and both are `Cat`'s, so the same cat can be put on any other screen without
 * this one being consulted. **The scoot and the covering are the layout's**:
 * the counts take a bottom margin and the doors paint over him, so the tail
 * leaves his row, crosses the gap and disappears under the first door.
 *
 * Nothing about the doors changed. There are three, they say what they said,
 * and each is still drawn only on a day it can do something. What moved is
 * where they start.
 *
 * ## The corner, and the menu drawn over this screen (#329)
 *
 * This screen had nothing in its top right and now has the portrait, because
 * this is where somebody who has never seen the app is standing when they go
 * looking for the thing they cannot find. The menu is drawn over this one for
 * the same reason: the walk that had no beginning is Today, the corner, your
 * furniture, and it is now three taps that can be followed by somebody who has
 * been told none of them.
 *
 * It is one function drawing both, the way `AreaScreen` draws an area and the
 * three states of being asked to remove one. A second copy of this screen with
 * a sheet on it would be five counts to keep in step.
 *
 * ## And the same function draws the two days it goes wrong (#311)
 *
 * `trouble` is drawn above everything, on the two screens below this one and on
 * no ordinary day. The nightly copy of the collection has stopped twice now and
 * both times the only thing that knew was a file on a disk, so the app is what
 * says it, here, where the owner already looks for what needs him.
 *
 * **Above the counts rather than among them**, which is the one arrangement
 * decision in it, and it survives the headings going: the counts are work
 * somebody can walk over and do, and this is news nobody can do anything about
 * from a phone.
 */
function Home(go: Go, over?: ReactElement, trouble?: ReactElement) {
  return (
    <Phone
      tab="home"
      go={go}
      over={over}
      top={<TopBar title="Book scan" action={you(go, over !== undefined)} />}
    >
      {trouble}

      {/* Fifty-three to carry, which is what the number looks like the week
          after a rule changed. It was three, and three is the number this
          screen shows on an ordinary day; the carry screens are drawn at the
          size the job actually reaches, so this one says so too. A count that
          only ever reads "3" would have let the whole flow be designed for a
          list that fits on one screen. */}
      <Stats
        cat="lying"
        items={[
          { n: '1,204', word: 'catalogued', onPress: () => go('library') },
          { n: '2', word: 'checked out', onPress: () => go('listing') },
          { n: '6', word: 'ready to shelve', onPress: () => go('queue') },
          { n: '53', word: 'to carry', onPress: () => go('carry') },
          { n: '3', word: 'stuck', onPress: () => go('queue') },
        ]}
      />

      {/* Three, which is the ceiling, and the third is #341's. The books no
          rule claims had a card on this screen in the drawing that answered
          that issue's question; round eight took every card off this screen for
          saying a second time what a count said, and this one is not that: no
          count here holds these books and none can, because they are not the
          collection, not the table and not the carry list. So it is a door, in
          the row round eight made for exactly this, and it is drawn only on a
          day it can do something. */}
      <Doors>
        <InHand onPress={() => go('inhand')} />
        <CarryBooks onPress={() => go('carry')} />
        <SayWhat onPress={() => go('unclaimed')} />
      </Doors>
    </Phone>
  )
}

/**
 * The first evening, when there is nothing to count and nothing to do.
 *
 * Drawn because a design that only draws the middle case is a design that will
 * be rebuilt, and because this is the state the change of round eight most
 * obviously reaches: a screen that was a sentence and two lists is now five
 * numbers, and five zeros is what a new collection makes of it.
 *
 * **The cat is asleep and there is no sentence.** "Nothing is catalogued yet"
 * over a tile reading nought catalogued is the same fact told twice, which is
 * the thing this round took off the screen; a sleeping cat says the collection
 * is new rather than broken and costs no line. Neither door is drawn: the
 * camera has nothing to compare a book against, and there is nothing to carry.
 * The way to start is the tab in the bar with the camera on it, which is one
 * press from here and is the reason no card offers it.
 */
function FirstDay(go: Go) {
  return (
    <Phone
      tab="home"
      go={go}
      top={<TopBar title="Book scan" action={you(go)} />}
    >
      <Stats
        cat="sleeping"
        items={[
          { n: '0', word: 'catalogued', onPress: () => go('library') },
          { n: '0', word: 'checked out', onPress: () => go('listing') },
          { n: '0', word: 'ready to shelve', onPress: () => go('queue') },
          { n: '0', word: 'to carry', onPress: () => go('carry') },
          { n: '0', word: 'stuck', onPress: () => go('queue') },
        ]}
      />
    </Phone>
  )
}

/**
 * The day the collection stopped being copied anywhere, and nothing said so.
 *
 * > the backup stopped, the failure was loud, in a file nobody reads,
 * > everything else looked fine, and it was found by somebody happening to look,
 * > days later
 *
 * That has now happened twice, for two different reasons, which is what makes
 * it a property of this system rather than an accident. So the drawing is of the
 * app noticing: not that the nightly job started, which it did both times, but
 * that there is no copy of the collection on the other disk that anybody has
 * proved restores.
 *
 * **The date is in it and the age is in the title.** "Three days old" is what
 * somebody reacts to; "taken on 11 Aug" is what they check against what they
 * remember doing. A card that said only "backups are out of date" is the log
 * nobody reads, written on a screen.
 */
function Unbacked(go: Go) {
  return Home(
    go,
    undefined,
    <Trouble kind="Backups" title="The last proved backup is three days old">
      It was taken on 11 Aug. The collection is added to most days, so
      everything since then exists in one place only.
    </Trouble>,
  )
}

/**
 * The other disk is not there, which must never read as everything being fine.
 *
 * The backups are on a second physical disk, which is the right place for them
 * and is also a thing that can be unplugged, and the failure this whole card
 * exists to catch is a check that quietly passes when it could not look. So the
 * drawing says the app could not look, in the same weight as it says the news
 * is bad, because to somebody standing here they mean the same thing: nobody
 * knows whether the collection is safe.
 */
function NoDisk(go: Go) {
  return Home(
    go,
    undefined,
    <Trouble kind="Backups" title="The backups cannot be read">
      Where the backups are kept did not answer, so nothing can say whether
      there is a copy of the collection. If it is a disk, it may be unplugged.
    </Trouble>,
  )
}

/* --- The library, and the three ways of looking at it --------------------- */

/**
 * Which of the three views a library screen is drawing.
 *
 * All three stay, and the owner said so plainly: "the user should be able to
 * switch between gallery, list, and shelf views. Let's still keep that." The
 * words on the control are not those three, because one of them is a word this
 * interface does not say. Covers, a list, and the books standing up.
 */
type View = Look

/**
 * Which screen each of the three is, here.
 *
 * The gallery walks between three screens and the app redraws one, which is the
 * only difference between them. The row itself is `Filter` in the design system
 * and is called by both, because a row written twice is two rows that agree
 * until one of them is edited.
 */
const VIEW_SCREENS: Record<View, string> = {
  covers: 'covers',
  list: 'listing',
  spines: 'library',
}

/**
 * What every library screen wears above its books, which is `Filter` and the
 * three screens above wired to it.
 *
 * The row itself, the argument for it being one row, and which of the two things
 * a cycling button can say it says, are all in `Finding.tsx` with the component.
 * What is here is the only part that is about the gallery: pressing it walks to
 * another screen, where in the app it redraws this one.
 */
function LibraryTop({
  go,
  view,
  tags,
  note,
}: {
  go: Go
  view: View
  tags?: string[]
  note: string
}) {
  return (
    <Filter
      tags={tags}
      note={note}
      onTags={() => go('tags')}
      onFind={() => go('find')}
      look={view}
      onLook={(next) => go(VIEW_SCREENS[next])}
    />
  )
}

/**
 * ## One row is one area, and there is no split inside a row
 *
 * The first pass drew bookcase 1 as a single row labelled `1A` with a divider
 * partway along it and two areas either side. The owner read it and said what
 * was wrong:
 *
 * > A is an area itself, so it really would be bookcase one, 1A, and then
 * > underneath that would be another row that's 1B. You wouldn't have this
 * > actual physical split like you have there.
 *
 * He is right, and it is the model's own vocabulary. An area is the unit a
 * person owns and the unit a book is placed in, so a row of books is one area
 * and the next area is the next row. Drawing two areas inside `1A` claimed that
 * `1A` contains areas, which is false, and it contradicted the furniture
 * screens, where a piece holds areas and an area holds books.
 *
 * The label is derived and never stored: the piece's name and the area's
 * position, `1A` then `1B`. `design.test.tsx` pins the rest of it, because a
 * divider is exactly the kind of drawing that comes back looking helpful.
 */
function Library(go: Go) {
  const oneA: ShelfItem[] = spines([
    'Adams, Douglas',
    'Atwood, Margaret',
    'Banks, Iain M.',
    'Bradbury, Ray',
  ])
  const oneB: ShelfItem[] = [
    ...spines(['Calvino, Italo', 'Chambers, Becky', 'Clarke, Susanna'], 2),
    { kind: 'bookend' },
  ]
  const two = [
    ...spines(
      [
        'Ishiguro, Kazuo',
        'Le Guin, Ursula K.',
        'Mantel, Hilary',
        'Miéville, China',
        'Mitchell, David',
        'Morrison, Toni',
        'Pratchett, Terry',
        'Stephenson, Neal',
      ],
      1,
    ),
    { kind: 'bookend' as const },
  ]
  /*
   * A third bookcase, added when the caption under the second one went and
   * left the bottom half of the screen empty. The top bar says four bookcases,
   * so two of them was the wireframe under-drawing the collection rather than
   * a screen that ends there.
   */
  const three: ShelfItem[] = spines(
    [
      'Macfarlane, Robert',
      'Sacks, Oliver',
      'Sebald, W. G.',
      'Solnit, Rebecca',
      'Tharoor, Shashi',
      'Winchester, Simon',
    ],
    4,
  )

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Library"
          sub="1,204 books"
          action={you(go)}
        />
      }
    >
      <LibraryTop go={go} view="spines" note="1,204 books" />

      {/* No caption under these. There was one, saying you could tap a spine
          and what the cat meant, and it went: a shelf that has to be explained
          in a paragraph underneath it is a shelf that has not worked. */}
      <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
        <p className="wf-heading">Bookcase 1</p>
        <Shelf label="1A" note="4 books" items={oneA} />
        <Shelf label="1B" note="3 books" items={oneB} />
        <p className="wf-heading">Bookcase 2</p>
        <Shelf label="2C" note="8 books" items={two} />
        <p className="wf-heading">Bookcase 4</p>
        <Shelf label="4A" note="6 books" items={three} />
      </div>

      {/* The way through to the furniture, and nothing else.
          There was a card here titled "Three bookcases and a crate", with a
          sentence under it about adding one and dividing it into areas. Two
          things wrong with it, and the owner named both: the app has no reason
          to summarise what somebody's furniture is made of, and it was a
          paragraph doing a link's job. "It's definitely not that."

          It stays now the corner opens onto the same place, and that is a
          deliberate second door rather than an oversight. The fault this
          codebase keeps naming is a second door that *takes the middle of a
          screen*, which the camera card did; this is at the foot, after every
          book somebody owns, and it is exactly where a person who has just
          scrolled past all of them wants it. The menu is the way in for
          somebody who has never found it; this is the way on for somebody who
          is already looking at the furniture drawn as books. */}
      <div className="wf-under">
        {/* Not "see the bookcases": what it opens is six pieces and two of
            them are a crate and a desk. The category word goes neutral even
            though the pieces above it are named for what they are. */}
        <Button tone="quiet" onPress={() => go('furniture')}>
          See your fixtures
        </Button>
      </div>
    </Phone>
  )
}

/**
 * A dozen real books, used wherever a screen needs a gallery of them.
 *
 * One list, so a book is the same colour and the same author in the gallery,
 * in a list row and in a set of results. Real books, because a page of "Lorem"
 * tells you nothing about whether a title of nine words fits on a cover 122
 * pixels wide.
 */
const TWELVE = covers([
  ['Never Let Me Go', 'Ishiguro, Kazuo'],
  ['Piranesi', 'Clarke, Susanna'],
  ['Cloud Atlas', 'Mitchell, David'],
  ['The Left Hand of Darkness', 'Le Guin, Ursula K.'],
  ['Wolf Hall', 'Mantel, Hilary'],
  ['Underland', 'Macfarlane, Robert'],
  ['The City and the City', 'Miéville, China'],
  ['Beloved', 'Morrison, Toni'],
  ['Snow Crash', 'Stephenson, Neal'],
  ['A Wizard of Earthsea', 'Le Guin, Ursula K.'],
  ['Guards! Guards!', 'Pratchett, Terry'],
  ['The Secret History', 'Tartt, Donna'],
])

/** The gallery view, with two tags narrowing it. */
function CoverView(go: Go) {
  const some = covers([
    ['Piranesi', 'Clarke, Susanna'],
    ['Guards! Guards!', 'Pratchett, Terry'],
    ['A Wizard of Earthsea', 'Le Guin, Ursula K.'],
    ['Jonathan Strange & Mr Norrell', 'Clarke, Susanna'],
    ['The Hobbit', 'Tolkien, J. R. R.'],
    ['Small Gods', 'Pratchett, Terry'],
  ])

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Library"
          sub="6 of 1,204 books"
          action={you(go)}
        />
      }
    >
      <LibraryTop go={go} view="covers" tags={['Fantasy', 'Lent out']} note="6 books" />

      {/* Nothing under this. There was a card here saying that two tags mean
          "and", that six books carry both, and that the row above is how you
          take one off. The owner: "That doesn't need to be there at all." Every
          one of those three facts is already drawn: the two tags sit lit in the
          row, the count beside them says six, and the bar reads 6 of 1,204. */}
      <Covers items={some} label="Books tagged Fantasy and Lent out" onPress={() => go('book')} />
    </Phone>
  )
}

/** The list view, which is the one you scan a column of authors in. */
function ListView(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Library"
          sub="1,204 books"
          action={you(go)}
        />
      }
    >
      <LibraryTop go={go} view="list" note="1,204 books" />

      {/* Really in this order, and there is no longer a line underneath saying
          so. The order is on the rows: every second line is the author this
          collection files the book under, and they run down the screen in the
          order they are filed in. A sentence claiming that says nothing the
          column does not, and it was one more thing to keep true.

          Twelve rows rather than the eight that were here, which is the same
          move the library made when its caption went: the sentence was holding
          the bottom of the screen up, and four more books hold it up better
          while carrying past the fold, which is what a list of 1,204 does. */}
      <List label="Every book">
        <Row title="Piranesi" sub="Clarke, Susanna" cloth="wood" place="1B" onPress={() => go('book')} />
        <Row title="Never Let Me Go" sub="Ishiguro, Kazuo" cloth="moss" place="2C" onPress={() => go('book')} />
        <Row title="The Left Hand of Darkness" sub="Le Guin, Ursula K." cloth="plum" place="1C" onPress={() => go('book')} />
        <Row title="Underland" sub="Macfarlane, Robert" cloth="sun" place="4A" onPress={() => go('book')} />
        <Row title="Wolf Hall" sub="Mantel, Hilary" cloth="wood2" place="2C" onPress={() => go('book')} />
        <Row title="The City and the City" sub="Miéville, China" cloth="moss" meta="Checked out" onPress={() => go('book')} />
        <Row title="Cloud Atlas" sub="Mitchell, David" cloth="sky" place="2C" onPress={() => go('book')} />
        <Row title="Beloved" sub="Morrison, Toni" cloth="wood" place="2C" onPress={() => go('book')} />
        <Row title="Guards! Guards!" sub="Pratchett, Terry" cloth="sun" place="1C" onPress={() => go('book')} />
        <Row title="Snow Crash" sub="Stephenson, Neal" cloth="sky" place="2C" onPress={() => go('book')} />
        <Row title="The Secret History" sub="Tartt, Donna" cloth="plum" place="1B" onPress={() => go('book')} />
        <Row title="The Hobbit" sub="Tolkien, J. R. R." cloth="wood2" place="1C" onPress={() => go('book')} />
      </List>
    </Phone>
  )
}

/*
 * --- One book, twice ------------------------------------------------------
 *
 * The owner read the first pass at this screen and named what was wrong with
 * it, which was that it had been drawn from the wrong question:
 *
 * > This is the detailed view for a book. Where it is, is one part of that.
 * > It's not the whole picture. And I don't like the "where it is" widget
 * > right here. That's just taking up way too much space.
 *
 * So both screens below are drawn from "what do I know about this book, and
 * what can I do with it", and they carry the same sections in the same order.
 *
 * ## The order is doing before knowing, and round six is what settled it
 *
 * > We should have the actions available to the user the moment they get to
 * > this detail view, so they can do whatever it is that they intend to do. And
 * > then if they don't intend to take action, when they scroll down they see
 * > the current shelving view, and that shows them where it is, which might be
 * > what they're here for.
 *
 * Above the fold: the book, its facts, its tags, and what you can do about it.
 * Below it, in this order: where it sits, why it sits there, and more by this
 * author. Somebody arriving at a book either wants to do something or wants to
 * know where it is, and the knowing is what they scroll to anyway, so putting
 * the doing first costs it nothing.
 *
 * Three things moved to get there and each one is the owner's: the tags went up
 * under the ISBN, the actions went up to where "where it is" used to sit, and
 * "who wrote it" became "more by this author" with the same content under it.
 * One thing did not move: "why it is here" stays under the drawing of the
 * board.
 *
 * ## Round eight: four headings off, one section gone, one hidden
 *
 * The order above survived it and the headings mostly did not. "What it is
 * about" is the tags, and they are up in the head beside the picture now.
 * "What you can do" is a row of buttons with nothing over it. "Where it is" is
 * the board, which says where it is by being looked at. "Where it has been" is
 * gone with its ledger. "More by this author" is the one heading left, and it
 * is drawn only where the catalogue has something else by them.
 *
 * And the pictures changed order: the one a catalogue holds comes first where
 * there is one, with a setting on the settings screen to have it the other way
 * round.
 *
 * **The first two are the same book by the same author, and that is the
 * point.** One record is as full as this catalogue gets and the other is
 * nearly empty, which is what most of a real collection looks like, and
 * putting them on one author shows what survives a thin record: who wrote it,
 * what else of theirs is in the house, and where it is. Everything that is
 * missing is drawn as the empty shape of itself rather than left off, because
 * a gap somebody can fill is a thing to know.
 *
 * **The third one is the case neither of those can draw**, because both are by
 * an author with nine books here: a book whose author has nothing else in the
 * catalogue, which is what nearly every book in a new collection is. It is a
 * third screen rather than a change to one of the two, because the pair above
 * is a comparison and the thin one is already carrying three other states at
 * once.
 *
 * ## Round three took the sentences off both of them
 *
 * > There's a lot of words going on here, like a lot of words.
 *
 * What went, on both screens equally: the count of tags said as a label above
 * tags anybody can count; the sentence beside each tag naming who said it; the
 * line under the photographs saying how many there were; the line under where
 * it has been saying when it was photographed; and the dashed card holding the
 * room a reading status will want, which was a note from the designer to the
 * reviewer wearing the app's own voice.
 *
 * **None of it was replaced with a shorter sentence**, which is the trap #262
 * names. Each one was either already drawn somewhere on the screen or was not
 * a fact anybody on it needed. Reading status is still undecided and #139 is
 * still where that is recorded; a wireframe is not a place to keep a note.
 *
 * What stayed is what he said he liked: who wrote it, and where it has been.
 */

/**
 * What Le Guin's other books look like from either of this author's pages.
 *
 * **Nothing here has a gender in it, and that is a rule rather than a fix to
 * one string.** It said "all nine of hers", and the owner stopped at it:
 *
 * > We need to change that to "theirs", because we're not gonna be able to
 * > tell if it's male or female probably for the author.
 *
 * He is right, and it is structural: the catalogue holds a name, an alias and
 * a filing name, and it holds no gender and never will. Any screen that says
 * "her books" is inventing a field, and it will be wrong on the first author
 * whose name does not read the way somebody assumed.
 */
function AlsoTheirs(go: Go) {
  return (
    <>
      <List label="Others by them">
        <Row title="A Wizard of Earthsea" sub="1968" cloth="sky" place="1C" onPress={() => go('book')} />
        <Row title="The Lathe of Heaven" sub="1971" cloth="moss" place="1C" onPress={() => go('book')} />
        <Row title="The Word for World Is Forest" sub="1972" cloth="wood" place="1D" onPress={() => go('book')} />
      </List>
      <Actions>
        <Button tone="quiet" small onPress={() => go('find')}>
          All nine of theirs
        </Button>
      </Actions>
    </>
  )
}

/*
 * A dashed card headed "Have you read it?" used to sit on both of these,
 * holding the room reading status will want, and its body said that nothing
 * answers that yet and how it should ask is not decided.
 *
 * That is the designer talking to the reviewer, on the screen, in the app's
 * own voice, which is the exact fault #262 names: "if a reader cannot tell
 * whether a sentence is the app or a note about the app, the sentence is
 * wrong." It is gone. #139 is still open and still the record of the decision
 * nobody has made; a wireframe is not the place to keep a note about it.
 */

function Book(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Lem, Stanisław', 'Le Guin, Ursula K.']),
    {
      kind: 'spine',
      text: 'Le Guin, Ursula K.',
      cloth: 'plum',
      pages: 304,
      here: true,
    },
    ...spines(['Le Guin, Ursula K.', 'Lessing, Doris'], 3),
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="The Left Hand of Darkness"
          sub="Le Guin, Ursula K."
          onBack={() => go('library')}
          action={{ word: 'Edit', icon: <IconEdit /> }}
        />
      }
    >
      {/*
        The picture a catalogue holds is the one this opens on, which is the
        first thing round eight changed: "we should show the catalogue picture
        of the front of the book first if possible, instead of the one the user
        took." The kinds are still listed in the order they are taken, and
        `deckOrder` is what brings the downloaded one to the front, so the
        drawing and the app cannot disagree about it. `first` is left at its
        default here because the default is what somebody who has never opened
        the settings screen gets, and that is the screen to draw.

        The tags are in the head now, under the publisher and the ISBN and
        beside the picture: "those should be up underneath where we have the
        ISBN, publisher, all of that." They had a heading of their own, three
        sections down, and it said nothing the chips do not.
      */}
      <Head
        title="The Left Hand of Darkness"
        by="Ursula K. Le Guin"
        shots={[
          { word: 'Front', cloth: 'plum' },
          { word: 'Spine', cloth: 'plum', sliver: true },
          { word: 'Back', cloth: 'wood' },
          { word: 'Downloaded', cloth: 'sky', catalogue: true },
        ]}
        facts={['Ace, 1969. 304 pages.', 'Hainish Cycle, book four', 'ISBN 9780441478125']}
        tags={
          <Tagging>
            <Tagged word="Fiction" from="person" who="You said so, on 3 June" />
            <Tagged word="Science fiction" from="catalogue" who="Open Library says so" />
            <Tagged
              word="Anthropology"
              from="guess"
              who="The app guessed it, and it is not sure"
            />
          </Tagging>
        }
      />

      {/*
        Three buttons and no heading over them.

        > And "what you can do", we don't need that text there either. We should
        > just enable them to take action on a book with a series of buttons.

        The heading went and the row did not: these are the two he named,
        "check it out" and "moved it", and the one he allowed, "or maybe other
        actions like moving it". Everything else a person can do to this book is
        either already on the screen or belongs beside the thing it acts on, and
        this row is the first thing a thumb reaches, which is exactly the row
        that fills up:

        - **Edit** is the named action in the top right and has been since the
          screen existed. A second door to it here is the fault the first screen
          had its camera card taken off for.
        - **Why it is here** is not an action. It is the answer to a question
          somebody asks after they have looked at the board, so it stays under
          the board, which is where he asked for it to stay.
        - **Photograph it again** lives on the photographs themselves, on the
          screens where a person can act on them.
        - **The rest of this author** belongs to the section about the author.
        - **Withdrawing or discarding a book** is real in the model and is on no
          screen in this gallery. It arrives with the screen that asks whether
          you meant it, not as a fourth small button beside "It moved".
      */}
      <Actions>
        <Button tone="secondary" small>
          Check it out
        </Button>
        <Button tone="quiet" small onPress={() => go('where')}>
          It moved
        </Button>
        <Button tone="quiet" small onPress={() => go('carry')}>
          Move it
        </Button>
      </Actions>

      {/* Below the fold, and with nothing written over it: "instead of where it
          is, once again, we don't need that text there. Looking at this tells
          them where it is." The board is how you find the book in the room and
          it names the two books either side, and the cat on top of it says
          which one it is. Why it is here sits under the drawing, where the
          question gets asked, and it is the one part of this the owner kept. */}
      <Where>
        <div className="wf-bleed">
          <Shelf label="1C" note="Third along" items={row} />
        </div>
        <Actions>
          <Button tone="quiet" small onPress={() => go('claimed')}>
            Why it is here
          </Button>
        </Actions>
      </Where>

      {/* The last heading on the page, and the only one that survives, because
          it is the one thing here nothing else on the screen says: "I do like
          the more by this author though." The name and what it files under stay
          under it, because they are what the heading is about. */}
      <Part head="More by this author" note="Nine of theirs">
        <p className="wf-book__by" style={{ margin: 0 }}>
          Ursula K. Le Guin
        </p>
        <Said>Files under Le Guin, Ursula K.</Said>
        {AlsoTheirs(go)}
      </Part>
    </Phone>
  )
}

/**
 * The same page for a book the catalogue barely knows, which is most of them.
 *
 * Everything absent is drawn as the shape it would have: a front nobody has
 * photographed, two more kinds nobody has either, one tag nobody has
 * confirmed. The spine is the one photograph this copy has, and it is the one
 * standing against the empty front, which is what most of a real collection
 * looks like: a shelf gets photographed a spine at a time.
 *
 * ## It is the screen the picture setting has no answer for
 *
 * There is no downloaded cover on this record, so there is nothing to bring to
 * the front and the photograph somebody took leads whatever the setting says.
 * That is the "if possible" in the owner's sentence, drawn: the alternative is
 * a book opening on an empty box with "No photograph" written in it, which is
 * the one outcome the reordering must not produce. The kind is still in the
 * deck and still has a dot, because a cover nobody has downloaded is a thing
 * to know and a thing to fix.
 *
 * The two things that are as good as they are on the full record are the two
 * that come from somewhere other than a catalogue: who wrote it, and what else
 * of theirs is in the house.
 */
function Thin(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="The Dispossessed"
          sub="Le Guin, Ursula K."
          onBack={() => go('find')}
          action={{ word: 'Edit', icon: <IconEdit /> }}
        />
      }
    >
      <Head
        title="The Dispossessed"
        by="Ursula K. Le Guin"
        shots={[
          { word: 'Front' },
          { word: 'Spine', cloth: 'wood', sliver: true },
          { word: 'Back' },
          { word: 'Downloaded', catalogue: true },
        ]}
        facts={['No publisher, year or length', 'No ISBN']}
        tags={
          <Tagging>
            <Tagged
              word="Fiction"
              from="guess"
              who="The app guessed it from the title, and it is not sure"
            />
          </Tagging>
        }
      />

      <Card
        weight="quiet"
        kind="No barcode has ever read on this copy"
        title="Nothing else is known about it"
        foot={
          <>
            <Button tone="secondary" small>
              Fill it in
            </Button>
            <Button tone="quiet" small onPress={() => go('camera')}>
              Try the barcode again
            </Button>
          </>
        }
      />

      {/*
        Two buttons, and they are not the rich book's three, because this book
        is in the house rather than on a bookcase. Putting it back is the one
        thing somebody holding it can do, and saying what it is, is the one
        thing worth doing to a record this thin: the only tag on it is a guess,
        and a guess is what the app rewrites and a person's word is not.

        "It moved" and "Move it" are deliberately not here. A book nobody has
        put anywhere has not moved, and offering to move it is offering to move
        it from nowhere.
      */}
      <Actions>
        <Button tone="secondary" small onPress={() => go('where')}>
          Put it back
        </Button>
        <Button tone="quiet" small>
          Say what it is
        </Button>
      </Actions>

      {/*
        A label, and it is the whole section. The rich book has a board here and
        reads its own label off it; this book has no board to read, so the label
        is the answer.

        **It said "Out", and one word was not enough once the heading came
        off.** "Looking at this tells them where it is" is true of a drawn
        board and is not true of a pill with one word in it: under a heading
        reading "Where it is", "Out" was an answer, and on its own between a row
        of buttons and the next section it was a word nobody had asked a
        question for. So the label says the whole thing on the screens that have
        no board, which is the only place this arises. Found by looking at it.
      */}
      <Where>
        {/* Wrapped, because a section is a grid and a grid stretches what is
            put in it: the label went the width of the phone and read as an
            empty field waiting to be filled in. Found by looking at it. */}
        <div>
          <Place quiet>Out of the house</Place>
        </div>
      </Where>

      <Part head="More by this author" note="Nine of theirs">
        <p className="wf-book__by" style={{ margin: 0 }}>
          Ursula K. Le Guin
        </p>
        <Said>Files under Le Guin, Ursula K.</Said>
        {AlsoTheirs(go)}
      </Part>
    </Phone>
  )
}

/**
 * A book whose author has nothing else here, which is nearly every book in a
 * new collection.
 *
 * > And if there's nothing else in the catalogue by that author, we shouldn't
 * > show "more by this author" at all.
 *
 * **The section is not on this screen at all**: not a heading over an empty
 * box, not a card saying nothing else of theirs is catalogued, not a count of
 * one. A heading whose only content is that there is no content is a heading
 * somebody scrolls past on most of their books.
 *
 * Nothing is lost by it going. Who wrote it is on the screen twice already, in
 * the bar and under the title, and what it files under is what the bar says.
 * The section was never carrying those; it was carrying the list, and there is
 * no list.
 *
 * Everything else about this book is ordinary, on purpose. It has both kinds of
 * front picture, so it is also where the downloaded one being first is easiest
 * to see, and it stands on a bookcase, so the board is drawn.
 */
function Lone(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Waters, Sarah', 'Whitehead, Colson']),
    {
      kind: 'spine',
      text: 'Williams, John',
      cloth: 'moss',
      pages: 288,
      here: true,
    },
    ...spines(['Woolf, Virginia', 'Yanagihara, Hanya'], 3),
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Stoner"
          sub="Williams, John"
          onBack={() => go('library')}
          action={{ word: 'Edit', icon: <IconEdit /> }}
        />
      }
    >
      <Head
        title="Stoner"
        by="John Williams"
        shots={[
          { word: 'Front', cloth: 'moss' },
          { word: 'Spine', cloth: 'moss', sliver: true },
          { word: 'Back' },
          { word: 'Downloaded', cloth: 'wood2', catalogue: true },
        ]}
        facts={['Vintage, 2003. 288 pages.', 'ISBN 9780099561545']}
        tags={
          <Tagging>
            <Tagged word="Fiction" from="catalogue" who="Open Library says so" />
            <Tagged word="Campus novel" from="person" who="You said so, on 11 July" />
          </Tagging>
        }
      />

      <Actions>
        <Button tone="secondary" small>
          Check it out
        </Button>
        <Button tone="quiet" small onPress={() => go('where')}>
          It moved
        </Button>
      </Actions>

      <Where>
        <div className="wf-bleed">
          <Shelf label="2B" note="Third along" items={row} />
        </div>
        <Actions>
          <Button tone="quiet" small onPress={() => go('claimed')}>
            Why it is here
          </Button>
        </Actions>
      </Where>
    </Phone>
  )
}

/* --- Finding a book ------------------------------------------------------- */

/*
 * Find is no longer a place. It is the one action in the library's top right,
 * and pressing it gives the whole screen over to a single field with the
 * gallery underneath it, filtering as you type. Every screen here wears the
 * library tab for that reason: you have not gone anywhere.
 *
 * ## The field works out what you meant
 *
 * Four kinds of query, one box, no mode switch, decided by what was typed:
 *
 * - digits, ten or thirteen of them, spaces and dashes ignored: an ISBN, and
 *   there is at most one answer
 * - a `#`: a tag, and the tags matching what has been typed so far are offered
 *   with the tags they sit under
 * - anything else: titles and authors together, near enough rather than exact
 *
 * The screen says which of those it chose, in one quiet line under the field,
 * and only when the answer is not obvious from what was typed. The alternative
 * is four buttons above the field that nobody would ever press, and a person
 * who types thirteen digits and gets a fuzzy title match has been failed
 * silently.
 */

/**
 * Everything above the results, which is the same on all five.
 *
 * The corner is the fifth way of answering this screen's question and it was
 * built without ever being drawn (#350): the wireframe had one camera and the
 * app has two, so the second one moved here and the drawing did not follow.
 * That gap is most of how its door came to be three presses from the first
 * screen with nobody deciding so, which is #355. It is drawn now, and it is
 * the same sentence the first screen's row carries.
 *
 * It is a glyph because it is a corner, which is the one place `Icons.tsx`
 * allows one without a word beside it, and it carries the word as its name.
 *
 * **The glyph is `IconInHand` and no longer the camera** (#361). The first
 * screen's door to this same camera was given one, and a door drawn two ways is
 * the drift that put the two cameras a press apart in the first place: one
 * camera, one sentence, one picture, wherever it is offered.
 */
function FindTop(go: Go, sub?: string) {
  return (
    <TopBar
      title="Find a book"
      sub={sub}
      onBack={() => go('library')}
      action={{ word: IN_HAND, icon: <IconInHand />, onPress: () => go('inhand') }}
    />
  )
}

function Find(go: Go) {
  return (
    <Phone tab="library" go={go} top={FindTop(go, '1,204 books')}>
      <SearchField caret />

      <Covers items={TWELVE} label="Every book" onPress={() => go('book')} />
    </Phone>
  )
}

/**
 * Typing, and the case the fuzziness is actually for.
 *
 * "mieville" has no accent in it and the author does. That is not a contrived
 * example: it is what somebody types on a phone keyboard, and an exact match
 * would answer nothing and be wrong.
 */
function Finding(go: Go) {
  const found = covers(
    [
      ['The City and the City', 'Miéville, China'],
      ['Perdido Street Station', 'Miéville, China'],
      ['Embassytown', 'Miéville, China'],
      ['The Scar', 'Miéville, China'],
      ['Railsea', 'Miéville, China'],
    ],
    2,
  )

  return (
    <Phone tab="library" go={go} top={FindTop(go, '5 of 1,204 books')}>
      <SearchField typed="mieville" caret />

      <Covers items={found} label="Books matching mieville" onPress={() => go('book')} />
    </Phone>
  )
}

/**
 * Thirteen digits, so there is one answer and the screen says why.
 *
 * One book in a gallery three across is one cover and two empty columns, which
 * looked like the screen had failed rather than answered. What fills it is the
 * question somebody asks straight afterwards: the rest of that author.
 */
function FindIsbn(go: Go) {
  const one = covers([['Never Let Me Go', 'Ishiguro, Kazuo']])
  const rest = covers(
    [
      ['The Remains of the Day', 'Ishiguro, Kazuo'],
      ['Klara and the Sun', 'Ishiguro, Kazuo'],
      ['An Artist of the Floating World', 'Ishiguro, Kazuo'],
    ],
    1,
  )

  return (
    <Phone tab="library" go={go} top={FindTop(go, '1 of 1,204 books')}>
      <SearchField typed="978 0571 224142" caret reads="Thirteen digits, so that is an ISBN." />

      <Covers items={one} label="The book with that ISBN" onPress={() => go('book')} />

      <p className="wf-heading wf-heading--flush">More by Ishiguro, Kazuo</p>
      <Covers items={rest} label="More by Ishiguro, Kazuo" onPress={() => go('book')} />
    </Phone>
  )
}

/**
 * Nothing matches, which is a real answer and gets a real screen.
 *
 * The word typed here was "tolkein" and it had to change: two screens along,
 * this collection owns The Hobbit, so a fuzzy search that claims not to need
 * exact spelling would have found it and this screen was quietly contradicting
 * the one before it. Found by looking at both.
 */
function FindNone(go: Go) {
  return (
    <Phone tab="library" go={go} top={FindTop(go, 'Nothing matches')}>
      <SearchField typed="ovid" caret />

      <Nothing said="No book here answers to that.">
        <p>Not a title, not an author, not an ISBN.</p>
      </Nothing>

      <Button tone="secondary" block onPress={() => go('tags')}>
        Look through your tags instead
      </Button>
      <Button tone="quiet" block onPress={() => go('camera')}>
        Photograph it, if it is in your hand
      </Button>
    </Phone>
  )
}

/**
 * A `#`, part typed, and the tags that match it.
 *
 * The second line under each one is where the hierarchy goes when there is no
 * tree to indent inside. Urban fantasy sits under Fantasy which sits under
 * Genre, and that is said in words, never as the stored slug.
 */
function FindTag(go: Go) {
  return (
    <Phone tab="library" go={go} top={FindTop(go, 'Two tags match')}>
      <SearchField typed="#fan" caret reads="A #, so these are your tags." />

      <Suggestions label="Tags matching fan">
        <Suggestion name="Fantasy" where="Genre" books={112} onPress={() => go('covers')} />
        <Suggestion
          name="Urban fantasy"
          where="Genre, Fantasy"
          books={14}
          onPress={() => go('covers')}
        />
      </Suggestions>

      <Button tone="quiet" block onPress={() => go('tags')}>
        See all 23 of your tags
      </Button>

      {/* Still every book, because nothing has been chosen yet. Drawn rather
          than left as half a screen of nothing: "it filters as you type" is a
          claim about what is underneath, and a person who cannot see the books
          cannot see them not moving. */}
      <Covers items={TWELVE.slice(0, 6)} label="Every book" onPress={() => go('book')} />
    </Phone>
  )
}

/* --- Twenty-three tags, which is the number the design has to survive ------ */

/**
 * The tags a person actually keeps, and the shape that holds them.
 *
 * Fiction and non-fiction were a two-button control at the top of the library,
 * and the owner named what was wrong with that: they were "an opinionated
 * approach just due to what we were needing to do at the time", and they are
 * now two tags out of twenty-three.
 *
 * **Twenty-three flat chips do not fit on a phone and would be lying anyway.**
 * `docs/data-model.md` puts the hierarchy in the slug, Obsidian style, so the
 * tags are a tree whether or not a screen draws one. Five groups, shut, fit
 * above the fold with room to spare; one opens at a time. That is the whole
 * answer to the count, and it is the same answer at forty.
 *
 * Three levels, because two would let somebody think the nesting is only ever
 * one deep: Naval history sits under History which sits under Subject.
 */
interface Leaf {
  name: string
  books: number
  /** Sits inside the tag above it rather than directly in the group. */
  under?: boolean
}

const GENRE: Leaf[] = [
  { name: 'Fiction', books: 740 },
  { name: 'Non-fiction', books: 464 },
  { name: 'Fantasy', books: 112 },
  { name: 'Urban fantasy', books: 14, under: true },
  { name: 'Science fiction', books: 98 },
  { name: 'Crime', books: 64 },
  { name: 'Poetry', books: 41 },
  { name: 'Cookery', books: 18 },
]

function TagsScreen(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Your tags" sub="23 tags in five groups" onBack={() => go('library')} />}
    >
      <SearchField placeholder="Search your tags" />

      <TagGroup name="Genre" note="8 tags" open onPress={() => go('tags')}>
        {GENRE.map((leaf) => (
          <TagPick
            key={leaf.name}
            name={leaf.name}
            books={leaf.books}
            under={leaf.under}
            on={leaf.name === 'Fantasy'}
            onPress={() => go('covers')}
          />
        ))}
      </TagGroup>

      <TagGroup name="Subject" note="5 tags" onPress={() => go('tags')} />
      <TagGroup name="Mine" note="4 tags, one of them showing" onPress={() => go('tags')} />
      <TagGroup name="Where it came from" note="3 tags" onPress={() => go('tags')} />
      <TagGroup name="How it is bound" note="3 tags" onPress={() => go('tags')} />

      <Button tone="primary" block onPress={() => go('covers')}>
        Show the 6 books
      </Button>
      <Button tone="quiet" block onPress={() => go('library')}>
        Show everything again
      </Button>
    </Phone>
  )
}

/* --- Cataloguing --------------------------------------------------------- */

/**
 * The photographs of the book being catalogued, in the order they are taken.
 *
 * Two exist and the third does not, which is the state the strip has to be
 * legible in: a taken photograph and an empty box have to be told apart at a
 * glance, on a picture, at 46px wide.
 */
function shotsOf(go: Go): Shot[] {
  return [
    /* The spine is cropped to the spine, which is why it is drawn as a sliver
       wherever it is drawn: thin in the strip, thin on the review, and a tall
       thin slot in the viewfinder when it is the one being taken. */
    { word: 'Spine', cloth: 'moss', sliver: true, onPress: () => go('spine') },
    { word: 'Front', cloth: 'wood', onPress: () => go('camera') },
    { word: 'Back', next: true, onPress: () => go('camera') },
  ]
}

/**
 * The same book at the start, with nothing photographed and the spine first.
 *
 * This exists so the slot-shaped frame can be looked at, which is the whole of
 * what the owner asked to see: the camera above is one press from the end of
 * the same book and its next photograph is the back.
 */
function spineFirst(go: Go): Shot[] {
  return [
    { word: 'Spine', next: true, sliver: true, onPress: () => go('spine') },
    { word: 'Front', onPress: () => go('camera') },
    { word: 'Back', onPress: () => go('camera') },
  ]
}

/**
 * The same photographs at the top of the details screen, in the order somebody
 * reads them rather than the order the camera fills them.
 *
 * > The spine should be on the far left, not on the far right. The front should
 * > be right next to the spine. The catalogue image should be there if it is
 * > available [...] If the catalogue image is not available, then it should
 * > just be the spine, the front, and our back.
 *
 * Three slots, drawn twice in this gallery because the two answers look
 * different and both are ordinary: nearly every book somebody scans a barcode
 * off has a downloaded cover, and every book no catalogue answered for has
 * none. `threeSlots` is what decides which, so the drawing cannot come apart
 * from the screen.
 */
function detailSlots(go: Go, downloaded?: Cloth) {
  return threeSlots(
    /* The spine is cropped to the spine, which is why it is drawn as a sliver
       wherever it is drawn. It leads here, which it did not: the camera takes
       it last and this screen was showing the camera's order. */
    { word: 'Spine', cloth: 'moss', sliver: true, onPress: () => go('spine') },
    /* Not pressable, and drawn at all only when there is one. It is the
       publisher's picture of the edition rather than a photograph of this
       copy, so there is no shutter that could take it again; the way to change
       it is the ISBN field below. */
    { word: 'Downloaded', catalogue: true, cloth: downloaded },
    [
      { word: 'Front', cloth: 'wood', onPress: () => go('camera') },
      { word: 'Back', next: true, onPress: () => go('camera') },
    ],
  )
}

/**
 * The camera, which is the picture and nothing else.
 *
 * No `Phone` around it, and that is the point rather than an omission: no top
 * bar, no tab bar, no sentence telling somebody what to photograph. The way
 * out is the one round target in the corner and the way on is the button
 * beside the shutter. `Camera.tsx` has the argument about which edge.
 */
function Camera(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={shotsOf(go)}
        onLeave={() => go('home')}
        onDone={() => go('review')}
      />
    </div>
  )
}

/**
 * The same camera, pointed at the spine, which is the shot the frame changes
 * shape for.
 *
 * Nothing about this screen is a second camera: it is `Viewfinder` with a
 * different list of photographs, and the tall thin slot comes off the one the
 * shutter is about to take. That is the point of drawing it twice rather than
 * describing it once.
 */
function SpineShot(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={spineFirst(go)}
        onLeave={() => go('home')}
        onDone={() => go('review')}
      />
    </div>
  )
}

/**
 * The other camera, and the wireframe has never had it.
 *
 * **This app has two cameras and they do different jobs.** The one above
 * photographs a book nobody has catalogued and keeps three photographs of it.
 * This one is pointed at a book you already own: it takes a frame, works out
 * which book it is, opens it, and keeps nothing. Two screens, two doors, two
 * jobs.
 *
 * The gallery drew only the first, and that omission has cost something real.
 * When the corner became the portrait, the pull request that made the trade
 * wrote "the gallery has one camera; this app has two" as its reason for that
 * door not being in the drawing at all, and the door then moved twice without
 * anybody being able to see what it was moving away from. One press became
 * three (#355). So it is drawn, and the two doors that reach it, the first
 * screen's row and the find screen's corner, both land here.
 *
 * **It is the same frame rather than a second one.** `Viewfinder` is a picture
 * with things floating on it, and this is that with no photographs to keep and
 * no book to be finished with: `Camera.tsx` says plainly that a second
 * component emitting `.wf-view` is the fault `Shots.tsx` was made to end.
 * Sharing a frame is not the same as merging the cameras, any more than the
 * spine shot above is a third one.
 *
 * **The app draws this screen with this since #408.** It was the ordinary
 * state of a wireframe here for a while, drawn ahead of the screen it stands
 * for, which is what #355 said when it added the drawing: that issue was about
 * how far away the door is rather than about what is behind it. The screen
 * behind it is `ScanCamera` and it is this frame now, with a live picture in
 * it, the shortlist a real answer produces, and nothing else moved.
 */
function InHandCamera(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        /* Nothing is kept, so there is no rail of what was kept. */
        shots={[]}
        /* And because nothing is kept, nothing else on this screen says what
           it is for. The camera above needs no sentence because its rail of
           photographs names the next shot; take the rail away and a striped
           rectangle is all somebody arriving here can see. Six words, in the
           app's own, floating rather than in a bar. */
        top={<span className="wf-view__chip">Hold a book up</span>}
        /* The shutter is the whole of this screen: it reads the book in front
           of it and hands you the book's own page. Nothing here writes
           anything, which is why it is behind no confirmation. */
        onShutter={() => go('book')}
        /* The same circle as the other camera's, and not the same job. A
           circle carries no word, so the word it carries for anybody who
           cannot see it is the one place these two can be told apart without
           looking at where you are. */
        shutterName="Find this book"
        /* Two ways out, both to where it was opened from, and the app really
           does have both: the far corner is where a back arrow belongs and the
           near one is the only thing a thumb can reach while the other hand is
           holding a book. `Camera.tsx` has the argument about the reach. */
        onLeave={() => go('home')}
        onDone={() => go('home')}
        done="Done"
      />
    </div>
  )
}

/**
 * The tags on the check-the-details screen, drawn once for the four states of
 * it that exist.
 *
 * The two above the box and the ones under it are not the same kind of thing,
 * and that is the part worth keeping straight. Fiction and non-fiction are one
 * question with two answers and at most one of them holds; everything else a
 * book carries is a set somebody adds to. Drawn as one wrapping row all the
 * same, because a person reading it sees tags, and #304's separation is about
 * what gets *written* rather than about what gets drawn.
 */
function reviewTags(go: Go, mine: string[] = []) {
  return (
    <div>
      {/*
        Was a two-way switch between fiction and non-fiction, which is
        `books.shelf_range` wearing a coat and, worse, a claim that a book
        is one thing. The owner: "the range is fiction versus non-fiction
        when in reality we should have different tags there, where one of
        those tags is like fiction, non-fiction, stuff like that."
      */}
      <span className="wf-field__label">Tags</span>
      <div style={{ height: 6 }} />
      <Tags>
        <Tag tone="on" onPress={() => {}}>Fiction</Tag>
        <Tag onPress={() => {}}>Non-fiction</Tag>
        {mine.map((word) => (
          <Tag tone="on" key={word} onPress={() => {}}>{word}</Tag>
        ))}
        <AddTag onPress={() => go('naming')}>Add a tag</AddTag>
      </Tags>
    </div>
  )
}

/**
 * The check-the-details screen, with whatever is drawn over it.
 *
 * One body and four screens, because the three states of naming a tag are the
 * same screen with a panel on it. Drawn twice they would be two review screens
 * that agreed until one of them was edited, which is the fault the frame itself
 * was moved out of this file to avoid.
 */
function reviewScreen(go: Go, mine: string[], over?: ReactElement) {
  return (
    <Phone
      tab="queue"
      go={go}
      over={over}
      top={<TopBar title="Check the details" sub="Read off the barcode" onBack={() => go('queue')} />}
    >
      {/*
        The photographs first, because the first thing somebody wants to know
        is whether they came out. There were none on this screen at all, which
        the owner found immediately: "we are not showing any images here. We
        wanna show those images and enable them to retake them if they don't
        like them because they're blurry."

        Three slots since #373, and this is the book that has a downloaded
        cover: the spine, then the cover a catalogue holds, then the two
        photographs somebody took sharing the last slot with a swipe between
        them. The cover and the front sit next to each other on purpose, which
        is the comparison this whole screen exists for: an ISBN is thirteen
        digits nobody can verify by reading, and the picture is the one part of
        a lookup a person can confirm at a glance.
      */}
      <Shots {...detailSlots(go, 'sky')} act size="big" />

      <Card kind="Found in Open Library" title="Never Let Me Go">
        <p>Ishiguro, Kazuo &middot; Faber &middot; 2005 &middot; 288 pages</p>
      </Card>

      {/*
        The ISBN, which could not be corrected here at all. It leads, because
        it is the one field that decides what every other field says.

        The way to correct it is a camera rather than a keyboard, which is the
        owner's: "on the right side of it, we should show like a camera icon
        [...] it opens up to scan the ISBN in the back of the book, like our
        current flow." Thirteen digits typed off a book by somebody holding the
        book is the slowest and least reliable way to answer this, and the
        barcode is on the back, so pressing it goes to the camera.
      */}
      <Field
        label="ISBN"
        value="9780571224142"
        action={{
          name: 'Read the barcode on the back instead',
          icon: <IconCamera size={20} />,
          onPress: () => go('camera'),
        }}
      />

      <Field label="Title" value="Never Let Me Go" />
      <Field label="Author" value="Kazuo Ishiguro" />
      <Field label="Files under" value="Ishiguro, Kazuo" />
      <Field label="Series" placeholder="Not in a series" />

      {/*
        Was two buttons, Fiction or Non-fiction, which was the same assumption
        the library made at the top of the screen: that there are two kinds of
        book. A book carries as many tags as it carries, the catalogue guessed
        the first two, and adding another is one press rather than a choice
        between two answers neither of which may be the one.
      */}
      {reviewTags(go, mine)}

      <Button tone="primary" block onPress={() => go('where')}>
        That is the book
      </Button>
      <Button tone="quiet" block onPress={() => go('queue')}>
        Leave it in the queue
      </Button>
    </Phone>
  )
}

function Review(go: Go) {
  return reviewScreen(go, ['Literary', 'Booker'])
}

/* --- Naming a tag that is not there yet ----------------------------------- */

/**
 * The tags this collection already keeps, as the box offers them back.
 *
 * Counts and all, because "112 books" is what tells somebody that the Fantasy
 * they are about to tap is the Fantasy they already use rather than a word that
 * happens to match. The second line is the nesting, said in words: the slug is
 * the identity and `design.test.tsx` refuses a screen that draws one.
 */
function NamingFound(go: Go) {
  return reviewScreen(
    go,
    ['Literary', 'Booker'],
    <Naming
      typed="comic"
      caret
      onClose={() => go('review')}
      reads="Two of your tags read like that."
    >
      <Suggestions label="Tags reading like comic">
        <Suggestion name="Comic book" where="Subject" books={31} onPress={() => go('review')} />
        <Suggestion
          name="Comic strip"
          where="Subject"
          books={4}
          onPress={() => go('review')}
        />
      </Suggestions>

      {/*
        Offered under what already exists rather than instead of it, and that
        order is the design. Somebody scanning their second comic book has to
        meet the tag before they meet the way to make another one, or the
        collection grows a second word for one idea and nothing anywhere
        reports it: two tags, two counts, and a rule that claims half the
        books it was written for.
      */}
      <Make name="Comic" where="Subject" onPress={() => go('review')} />
    </Naming>,
  )
}

/**
 * Nothing in the collection means it, so a new tag is what is offered.
 *
 * This is the owner's own example: "let's say I scan a comic book and I want to
 * add a comic book tag." The panel says what the tag will be called and where it
 * will sit, because where it sits is what decides which rules can ever reach it,
 * and finding that out later by the book not moving is not finding it out.
 */
function NamingNew(go: Go) {
  return reviewScreen(
    go,
    ['Literary', 'Booker'],
    <Naming
      typed="comic book"
      caret
      onClose={() => go('review')}
      reads="Nothing of yours reads like that yet."
    >
      <Make name="Comic book" where="Subject" onPress={() => go('review')} />

      <Said>
        A new tag goes under Subject, where your catalogue's own words go, so a
        rule can ask for it. Fiction and non-fiction are the two above.
      </Said>
    </Naming>,
  )
}

/**
 * The near miss, which is the hard part of this whole screen.
 *
 * "Comic Book" and "comic books" are one idea and two slugs, and slugs are
 * byte-ordered, so stored as typed they are two rows that sort apart, two
 * counts that are each half the answer, and two rules to write. Nothing reports
 * it, because nothing is broken: they are simply two tags.
 *
 * **So the offer to make one is not drawn at all here**, rather than drawn
 * beside a warning. A panel that said "this looks similar, carry on?" is a panel
 * where the second comic book makes the second comic book tag, which is the
 * thing being prevented. What is offered is the tag they already keep.
 */
function NamingSame(go: Go) {
  return reviewScreen(
    go,
    ['Literary', 'Booker'],
    <Naming
      typed="comic books"
      caret
      onClose={() => go('review')}
      reads="You already keep this one."
    >
      <Suggestions label="The tag you already keep for that">
        <Suggestion name="Comic book" where="Subject" books={31} onPress={() => go('review')} />
      </Suggestions>

      <Said>
        Comic books and Comic book are the same word to this app, so there is one
        tag rather than two. Add the one you have, or type something else.
      </Said>
    </Naming>,
  )
}

/**
 * The same screen for a book no catalogue answered for, which is the state the
 * three slots read differently in.
 *
 * > If the catalogue image is not available, then it should just be the spine,
 * > the front, and our back.
 *
 * So there is no downloaded cover, no empty frame where one would be, and no
 * swipe: the two photographs somebody took have a slot each, because the room
 * the cover would have taken is theirs. **This is the half that comes back.** A
 * fourth kind of picture drawn as an empty dashed box is the obvious thing to
 * reach for, it is what the book's own page does with the same kind, and it is
 * wrong here: this screen is for judging a photograph and there is nothing to
 * judge in a picture nobody downloaded.
 *
 * Everything else on it is the state the app already draws when a lookup found
 * nothing: quiet rather than alarmed, the fields empty with what goes in them
 * said, and the one thing that would let this book be shelved is a title
 * somebody types off the cover.
 */
function ReviewNone(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Check the details" sub="Typed in by hand" onBack={() => go('queue')} />}
    >
      <Shots {...detailSlots(go)} act size="big" />

      {/* Quiet, which is the weight for something that is not there yet. It
          was the loud card for a round, and a screen for checking details led
          with an apology. */}
      <Card weight="quiet" kind="Nothing came back" title="Fill it in from the book">
        <p>
          No catalogue answered for this one. Nothing has been filled in for you:
          what the cover photograph reads is underneath, as evidence rather than
          as an answer.
        </p>
      </Card>

      <Field
        label="ISBN"
        value="9781873982273"
        action={{
          name: 'Read the barcode on the back instead',
          icon: <IconCamera size={20} />,
          onPress: () => go('camera'),
        }}
      />

      <Field label="Title" placeholder="Off the title page" />
      <Field label="Author" placeholder="Separate two names with a comma" />
      <Field label="Files under" placeholder="Worked out from the author" />
      <Field label="Series" placeholder="Not in a series" />

      {/* The same door as the screen above, and it goes to the same place: a
          book no catalogue answered for is the one most in need of somebody
          saying what it is, so this is where naming a tag matters most. */}
      <div>
        <span className="wf-field__label">Tags</span>
        <div style={{ height: 6 }} />
        <Tags>
          <AddTag onPress={() => go('naming')}>Add a tag</AddTag>
        </Tags>
      </div>

      {/* Drawn and not pressable, with the reason under it rather than in a
          tooltip: this is a phone, there is no hover, and nothing here says
          what a book is yet. */}
      <Button tone="primary" block off>
        That is the book
      </Button>
      <Said>Type the title off the book to shelve it.</Said>

      <Button tone="quiet" block onPress={() => go('queue')}>
        Leave it in the queue
      </Button>
    </Phone>
  )
}

/**
 * Where one book goes, which is the same three things whatever put the book in
 * somebody's hand.
 *
 * **This is the owner's instruction taken literally.** He has said twice that
 * he likes this screen, and #291 says a book displaced by a rule change should
 * be reshelved "the same way as whenever we're initially shelving them". So it
 * is not copied for the carry flow, it is called by it: the sentence naming the
 * two neighbours, the area drawn with the gap in it and the book named under
 * the board, and the two answers a person standing at the shelf can give.
 *
 * A second implementation of this would be the place the two quietly came
 * apart, and the way that happens is somebody adding a button to one of them.
 */
function Placing({
  between,
  area,
  note,
  items,
  inHand,
  onFits,
  onFull,
}: {
  /** The one line: the two books this one goes between. */
  between: ReactElement
  /** The area it goes on, as the label reads off the furniture. */
  area: string
  note: string
  items: ShelfItem[]
  /** The book being carried, said under the board rather than drawn on it. */
  inHand: string
  onFits: () => void
  onFull: () => void
}) {
  return (
    <>
      <Instruction>{between}</Instruction>

      <div className="wf-bleed">
        <Shelf label={area} note={note} items={items} inHand={inHand} />
      </div>

      <Card
        weight="sunk"
        foot={
          <>
            <Button tone="primary" onPress={onFits}>
              It fits
            </Button>
            <Button tone="secondary" onPress={onFull}>
              {area} is full
            </Button>
          </>
        }
      />
    </>
  )
}

function WhereItGoes(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    { kind: 'gap' },
    ...spines(['Mitchell, David', 'Morrison, Toni', 'Pratchett, Terry'], 3),
    { kind: 'bookend' },
  ]

  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Where it goes" onBack={() => go('review')} />}
    >
      <Placing
        between={
          <>
            Between <em>The City &amp; the City</em> and <em>Cloud Atlas</em>.
          </>
        }
        area="2C"
        note="5 books, and the gap"
        items={row}
        inHand="Never Let Me Go"
        onFits={() => go('done')}
        onFull={() => go('carry')}
      />
    </Phone>
  )
}

/**
 * The end of the journey, and the one screen that draws the answer instead of
 * saying it.
 *
 * This was a sentence: "third along, between The City & the City and Cloud
 * Atlas". The owner asked for the drawing the old UI had, so the same run that
 * carried a gap on the screen before now carries the book, standing where the
 * gap was and marked the way `Shelf` marks the book a screen is about. Nothing
 * new was built for it: the before is `{ kind: 'gap' }` and the after is
 * `here: true` on the spine that filled it.
 *
 * ## Round six: no sentence, and one cat rather than three (#290)
 *
 * "Never Let Me Go is on 2C." was `Confirmation`'s sentence, sat over this
 * same drawing and saying what the drawing already shows, which is #262's
 * rule reaching the last place it had survived on this screen. It is gone,
 * and `Confirmation`'s cat went with it: he sat over that sentence, and there
 * was nothing left for him to be pleased about once it was.
 *
 * That still left three cats: the loaf, the cat #288 put on the placed book,
 * and the cat `Shelf` puts at the end of every run as a bookend. The loaf is
 * the one that is gone: he sat over the deleted sentence and had nothing left
 * to be pleased about once it was gone. The bookend stays. `WhereItGoes`, the
 * screen this one follows, draws the same 2C with the same bookend at the end
 * of it; dropping it only here would have a bookend leave the shelf the
 * moment a book is placed on it, which reads as the drawing losing furniture
 * rather than as fewer cats. Two cats on this screen rather than one, but the
 * count the owner objected to was three, and the fix is the loaf, not the
 * bookend.
 *
 * `Confirmation` itself is untouched: `Carried`, the other screen that uses
 * it, still has a sentence to say and a cat to say it with, because nothing
 * on that shelf is marked the way a single placed book is. The change is on
 * this screen, not the shared one.
 */
function Done(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    { kind: 'spine', text: 'Ishiguro, Kazuo', cloth: 'moss', pages: 288, here: true },
    ...spines(['Mitchell, David', 'Morrison, Toni', 'Pratchett, Terry'], 3),
    { kind: 'bookend' },
  ]

  return (
    <Phone tab="queue" go={go} top={<TopBar title="Shelved" />}>
      <div className="wf-bleed">
        <Shelf label="2C" note="6 books" items={row} />
      </div>

      <Button tone="primary" block onPress={() => go('camera')}>
        Next book
      </Button>
      <Button tone="quiet" block onPress={() => go('home')}>
        That is enough for today
      </Button>

      <Card weight="quiet" kind="Still waiting" title="Seventeen in the queue" />
    </Phone>
  )
}

/**
 * --- The queue: a book and three pills --------------------------------------
 *
 * Round eight (#363), and the owner's complaint was about density rather than
 * about any one line:
 *
 * > The books that we have in the queue, we're putting way too much information
 * > here. "Needs an ISBN" should be like a tag, it should be like a pill there.
 * > "Identified" should be a pill. Instead of "checked by" and then the device,
 * > just have the device there as a pill. And instead of "cover reads" and then
 * > listing it there, we don't need that.
 *
 * The argument for each pill is in `Queue.tsx`, which is the component both
 * this drawing and the app call. What is decided here is the screen around
 * them, and there are three answers on it worth naming.
 *
 * **The book is `Shots` in `mode="book"`, called and not copied.** The row drew
 * a 46 by 62 thumbnail of one photograph; it now draws the book, spine standing
 * against the front, at the size a list can afford.
 *
 * **The front-against-spine switcher is gone.** It was #349's, one round old,
 * and it asked which of the two photographs a row should draw. A row draws both
 * now, so its two answers produce one picture. `Finding.tsx` carries the
 * reasoning; the row above the books is otherwise untouched and is still the
 * library's.
 *
 * **The control across the top is what forty books are worked through with**,
 * which is the question a bigger book makes urgent: five books fill a phone
 * now where eight used to. Nothing on this screen summarises the pile, because
 * that summary is what #349 took off and the count is on the first screen; what
 * a person does instead is narrow to the six they can act on, or type three
 * letters of a title.
 */

/** The photographs of a queued book, as this wireframe has them: two cloths. */
function queued(cloth: Cloth, spine: Cloth = 'wood'): Shot[] {
  return [
    { word: 'Spine', cloth: spine, sliver: true },
    { word: 'Front', cloth },
  ]
}

/** One waiting book, as a target. The app's row is this plus its swipe. */
function QueueRow({
  go,
  ...book
}: { go: Go } & Parameters<typeof Queued>[0]) {
  return (
    <button type="button" className="wf-qrow" role="listitem" onClick={() => go('review')}>
      <Queued {...book} />
    </button>
  )
}

/** The row above the books: this screen's search box, and no switcher. */
function QueueTools() {
  return <Filter><SearchField placeholder="Search by title or author" /></Filter>
}

function Queue(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Queue" sub="18 books on the table" action={you(go)} />}
    >
      {/*
        "Processing", not "Reading": the owner read the old word as the app
        telling him he was in the middle of a novel, rather than as it working
        on a photograph. His words: "reading might be misconstrued by the user,
        so that maybe should be processing".
      */}
      <Segmented
        label="Which ones"
        on="ready"
        options={[
          { value: 'ready', word: 'Ready 6' },
          { value: 'processing', word: 'Processing 9' },
          { value: 'stuck', word: 'Stuck 3' },
        ]}
      />

      <QueueTools />

      <div className="wf-qlist" role="list" aria-label="Books on the table">
        <QueueRow
          go={go}
          name="Never Let Me Go"
          sub="Ishiguro, Kazuo"
          shots={queued('moss')}
          state="Identified"
        />
        <QueueRow
          go={go}
          name="Cloud Atlas"
          sub="Mitchell, David"
          shots={queued('sky', 'wood2')}
          state="Identified"
          device="Kitchen phone"
        />
        {/* A book nothing has named yet. The number stands in and the machine's
            reading of the cover is marked as the guess it is (#156). */}
        <QueueRow
          go={go}
          name="S0NG 0F SOLOMQN"
          guessed
          sub="9780099768401"
          shots={queued('sun')}
          state="Reading photos"
        />
        <QueueRow
          go={go}
          name="Book #219"
          shots={queued('plum', 'plum')}
          state="Stuck"
          wants="needs an ISBN"
          device="Kitchen phone"
        />
      </div>
    </Phone>
  )
}

/**
 * The four kinds of stuck, on one screen.
 *
 * This is #148 drawn rather than described. `failed` is one status covering
 * four situations that need four different things from the person holding the
 * book, and the incident behind the issue was a screen that said one thing
 * about all of them: "9 need an ISBN by hand", of which five had a perfectly
 * good ISBN nothing had catalogued. Sending somebody to retype a number that is
 * already correct is worse than saying nothing.
 *
 * So the pill is the diagnosis and it names which kind. Four books, four
 * different words, and the second one is the exact case the issue was reported
 * for: its ISBN read off the barcode and is correct.
 *
 * The way back from a reader that stopped is above them (#299), secondary
 * because this screen is for picking a book up rather than for repairing the
 * reader (#352), and it counts only the two it can actually help: nothing read
 * the photographs of those, where the other two want a person and a book in
 * their hands and would come back saying the very same thing.
 */
function QueueStuck(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Queue" sub="4 books on the table" action={you(go)} />}
    >
      <Segmented
        label="Which ones"
        on="stuck"
        options={[
          { value: 'ready', word: 'Ready' },
          { value: 'processing', word: 'Processing' },
          { value: 'stuck', word: 'Stuck 4' },
        ]}
      />

      <Button tone="secondary" block onPress={() => go('queue')}>
        Read those 2 books&apos; photos again
      </Button>

      <QueueTools />

      <div className="wf-qlist" role="list" aria-label="Books on the table">
        <QueueRow
          go={go}
          name="Book #221"
          shots={queued('wood')}
          state="Stuck"
          wants="needs an ISBN"
        />
        {/* The book #148 was reported for. Nothing anywhere may tell anybody to
            type this ISBN in: it is there, it is right, and what it wants is
            somebody to fill the details in by hand or accept that no catalogue
            has ever heard of it. */}
        <QueueRow
          go={go}
          name="9781857231380"
          shots={queued('sun')}
          state="Stuck"
          wants="no catalogue has its ISBN"
        />
        <QueueRow
          go={go}
          name="Book #223"
          shots={queued('plum', 'plum')}
          state="Stuck"
          wants="could not be read"
          device="Kitchen phone"
        />
        <QueueRow
          go={go}
          name="Book #224"
          shots={queued('moss')}
          state="Stuck"
          wants="reading it took too long"
        />
      </div>
    </Phone>
  )
}

/**
 * Forty books, which is the state a bigger book makes worth drawing.
 *
 * A phone held forty rows of eight before and holds forty rows of five now, so
 * the same pile is eight screens of scrolling rather than five. That is the
 * cost of the owner's instruction and it is worth saying out loud rather than
 * discovering: this screen is what it looks like.
 *
 * What it is not is a reason to shrink the book back. Forty is not a list
 * anybody reads to the bottom of; it is a list somebody narrows. Both tools for
 * that are above the books already and neither cost anything to add, because
 * both were there: the control says how many are ready, being read and stuck,
 * and the box finds one book by three letters of its title. Every book on this
 * screen is `Ready`, which is what tapping the second word of that control
 * leaves, and it is the ordinary way this pile gets worked through.
 */
const FORTY: [string, string][] = [
  ['Never Let Me Go', 'Ishiguro, Kazuo'],
  ['Cloud Atlas', 'Mitchell, David'],
  ['Piranesi', 'Clarke, Susanna'],
  ['Underland', 'Macfarlane, Robert'],
  ['The Bone Clocks', 'Mitchell, David'],
  ['Wolf Hall', 'Mantel, Hilary'],
  ['Beloved', 'Morrison, Toni'],
  ['The Overstory', 'Powers, Richard'],
  ['Small Things Like These', 'Keegan, Claire'],
  ['Station Eleven', 'Mandel, Emily St. John'],
]

function QueueMany(go: Go) {
  const cloths: Cloth[] = ['moss', 'sky', 'sun', 'plum', 'wood', 'wood2']

  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Queue" sub="40 books on the table" action={you(go)} />}
    >
      <Segmented
        label="Which ones"
        on="ready"
        options={[
          { value: 'ready', word: 'Ready 40' },
          { value: 'processing', word: 'Processing' },
          { value: 'stuck', word: 'Stuck' },
        ]}
      />

      <QueueTools />

      <div className="wf-qlist" role="list" aria-label="Books on the table">
        {Array.from({ length: 40 }, (_, at) => {
          const [title, who] = FORTY[at % FORTY.length]!
          return (
            <QueueRow
              key={at}
              go={go}
              name={title}
              sub={who}
              shots={queued(cloths[at % cloths.length]!, cloths[(at + 3) % cloths.length]!)}
              state="Identified"
              device={at % 7 === 3 ? 'Kitchen phone' : undefined}
            />
          )
        })}
      </div>
    </Phone>
  )
}

/* --- The corner ------------------------------------------------------------ */

/**
 * The menu the corner opens, over the screen it was opened from.
 *
 * This is `Home` with a sheet on it rather than a screen of its own, which is
 * the point: a menu is not a place you can be, the same way find is not, and
 * the screen underneath has not gone anywhere. `Corner` carries the argument
 * about what is in it; what is here is the content.
 *
 * **The two counts are the same two counts the destinations say.** "Five
 * pieces, sixteen areas" is the fixtures screen's own second line, word for
 * word, because a menu that summarises a screen in its own words is two
 * sentences that have to be kept agreeing.
 */
function RoomMenu(go: Go) {
  return Home(
    go,
    <Corner
      said="1,204 books, five fixtures"
      ways={[
        {
          word: FIXTURES_WORD,
          note: 'Five pieces, sixteen areas',
          onPress: () => go('furniture'),
        },
        {
          word: 'Settings',
          note: 'The order they file in, and which hand',
          onPress: () => go('settings'),
        },
      ]}
      onClose={() => go('home')}
    />,
  )
}

/**
 * Settings, which is two answers this app already holds and had nowhere to ask
 * for.
 *
 * **Nothing here was invented, and the shape of the screen is the finding.**
 * The instruction was not to draw a page of switches, so what is on it was
 * arrived at by going and looking for every answer this app already keeps, and
 * then taking off the ones that are already somewhere better.
 *
 * ## The two that had no home
 *
 * **How your books are ordered** is `collection.default_sort_strategy`, one row
 * in the schema, and its comment says why it is a collection-level fact rather
 * than a rule on every piece: "a default expressed on every fixture would have
 * to be changed on every fixture and could then disagree with itself." Two
 * screens in this gallery already read it out loud. The area screen says an
 * area is ordered "The way bookcase 2 does", and the ordering screen says "By
 * the author's surname, which is what the whole library uses". That is this
 * value, said twice, by two screens that both defer to a setting no screen has
 * ever offered.
 *
 * **Which hand you hold the phone in** is the one the design system asked for
 * by name. `Camera.tsx`, on the switch in the viewfinder's far corner: "In the
 * app it belongs beside the rest of the settings and this is the wireframe
 * standing in for one." This is that one.
 *
 * ## The four that are already somewhere better
 *
 * The app remembers six answers today. Four of them sit beside the thing they
 * change and should stay there: which of the three ways you are looking at the
 * library, whether a queued book shows its front or its spine, which lens the
 * camera uses, and whether the torch is lit. A settings screen that collected
 * those would be taking controls off the screens they act on in order to look
 * fuller than the app is.
 *
 * ## The second half is the answer to the ring in the corner
 *
 * Somebody who taps an avatar and works through the menu is, sooner or later,
 * looking for the account. This is where they arrive, and it says the true
 * thing plainly and once: there is no account, everybody in the house is
 * working on the same books, and that is why the answer above it is kept on
 * the phone rather than anywhere a second phone could read it.
 *
 * It offers nothing. There is no sign-in greyed out, no "coming soon" and no
 * field for a name. #171 is a decision nobody has made, and a door drawn for
 * it here would be this wireframe making it.
 *
 * ## What is not on it, and none of it is an oversight
 *
 * **Day and night**: the app follows the phone already, both palettes are in
 * `tokens.css` under `prefers-color-scheme`, and a switch here would be a
 * control nobody asked for over a question the phone has answered.
 * **Backing up and exporting**: `docs/backup-runbook.md` is a job somebody does
 * by hand at a terminal, the server has no endpoint for either, and a button
 * would be a promise with nothing behind it. **A name for the collection**:
 * `collection.name` is a real column, and it is left off because no screen in
 * this app shows it, so a field for it would be a control with no visible
 * effect. **Who checked a book out**: checking out records no borrower at all,
 * and `claimed_by` is a lease held by a browser rather than a person. **A
 * version**: there is no version string anywhere in the app to show.
 */
function SettingsScreen(go: Go) {
  return (
    <Phone tab="home" go={go} top={<TopBar title="Settings" onBack={() => go('menu')} />}>
      <div>
        <span className="wf-field__label">How your books are ordered</span>
        <div style={{ height: 6 }} />
        {/*
          The same four answers the area's ordering screen offers, in the same
          words, minus the one that cannot apply: an area can be ordered "the
          way bookcase 2 does" and a collection has nothing above it to ask.
          The schema says so as a constraint rather than as a comment.
        */}
        <Choice
          label="How your books are ordered"
          on="author"
          options={[
            { value: 'author', word: 'By the author' },
            { value: 'title', word: 'By the title' },
            { value: 'year', word: 'By the year it came out' },
            { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
          ]}
        />
      </div>
      {/* Under the control rather than over it, and it is the sentence that
          makes this a setting rather than a preference: it is the answer every
          piece of furniture and every area gives when it has not been asked
          the question itself. */}
      <Said>Every bookcase and every area follows this unless it says otherwise.</Said>

      <div>
        <span className="wf-field__label">Which hand you hold the phone in</span>
        <div style={{ height: 6 }} />
        <Segmented
          label="Which hand you hold the phone in"
          on="right"
          options={[
            { value: 'left', word: 'Left' },
            { value: 'right', word: 'Right' },
          ]}
        />
      </div>
      <Said>
        The shutter goes to that edge, under the thumb of the hand already
        holding the phone, and the photographs go to the other one.
      </Said>

      {/*
        > We should show the catalogue picture of the front of the book first if
        > possible, instead of the one the user took. We should probably add that
        > as a setting the user can set if they would like.

        Here rather than on the book's page, which is the rule this screen was
        built on: a control belongs beside the thing it acts on only when it is
        about that one thing, and this is an answer somebody gives once about
        every book in the house. A switch on a book's page would be asked again
        on the next book and would be a fifth thing on a page whose whole
        complaint was that it had too much on it.
      */}
      <div>
        <span className="wf-field__label">Which picture of a book comes first</span>
        <div style={{ height: 6 }} />
        <Segmented
          label="Which picture of a book comes first"
          on="catalogue"
          options={[
            { value: 'catalogue', word: 'The downloaded one' },
            { value: 'yours', word: 'The one you took' },
          ]}
        />
      </div>
      <Said>
        A book with no downloaded cover opens on the photograph you took, either
        way.
      </Said>

      <Card kind="Nobody signs in" title="Everybody in the house shares one collection">
        <p>
          Nothing here knows who you are. What you choose here is remembered on
          this phone and on no other.
        </p>
      </Card>
    </Phone>
  )
}

/* --- Your fixtures --------------------------------------------------------- */

/*
 * The four pieces in the room, what is under each of them, and what each one
 * holds.
 *
 * **Boxes, not carpentry.** These screens do not draw a bookcase. The library
 * draws a real board with real spines on it because that screen is for finding
 * a book in the room; this half is for saying how the collection is organised,
 * and a drawing of furniture would promise the app knows things it does not.
 * The owner settled that on #251.
 *
 * Three things in this data are the point rather than decoration. Bookcase 2
 * has no name, so everything about it reads off its number, which is what
 * makes the naming worth looking at. Its rule and the rule on 2C both want the
 * same book, which is what the last screen exists to explain. And the crate
 * has no rule at all, because a piece somebody keeps things in by hand is a
 * real state and not a half-finished one.
 */
interface Place {
  reads: string
  books: number
  holds: string
}

/*
 * A named piece renames every area on it, which is why these read the way they
 * do rather than as 1A to 1E. That is the table in `docs/data-model.md`, and
 * getting it wrong here first was the fastest way to see that a label really
 * is worked out rather than stored.
 */
const AREAS_1: Place[] = [
  { reads: 'By the window · A', books: 22, holds: 'Fiction starts here' },
  { reads: 'By the window · B', books: 24, holds: 'Fiction, carrying on' },
  { reads: 'By the window · C', books: 12, holds: 'Fiction, carrying on' },
  { reads: 'By the window · D', books: 9, holds: 'Fiction, carrying on' },
  { reads: 'By the window · E', books: 26, holds: 'Fiction, carrying on' },
]

const AREAS_2: Place[] = [
  { reads: '2A', books: 21, holds: 'Non-fiction starts here' },
  { reads: '2B', books: 24, holds: 'Non-fiction, carrying on' },
  { reads: '2 · Cookery', books: 18, holds: 'Anything tagged Cookery' },
]

const AREAS_3: Place[] = [
  { reads: 'Landing · A', books: 19, holds: 'Poetry starts here' },
  { reads: 'Landing · B', books: 22, holds: 'Poetry, carrying on' },
  { reads: 'Landing · C', books: 17, holds: 'Poetry, carrying on' },
  { reads: 'Landing · D', books: 8, holds: 'Poetry, carrying on' },
]

const AREAS_4: Place[] = [
  { reads: 'Hall crate · A', books: 14, holds: 'Put here by hand' },
  { reads: 'Hall crate · B', books: 12, holds: 'Put here by hand' },
]

/*
 * Not every piece is a bookcase. A desk has one top, split into two areas by
 * where they sit on it rather than by any board, which is the point: an area
 * is chosen by a person, not read off the carpentry, and a desk is the
 * clearest proof of that this gallery can show.
 */
const AREAS_5: Place[] = [
  { reads: 'Desk · Left side', books: 6, holds: 'Put here by hand' },
  { reads: 'Desk · Right side', books: 4, holds: 'Put here by hand' },
]

/*
 * The room as a column you drag within, with no number down the side of it.
 *
 * A piece nobody has named is drawn as what it is and where it stands, which is
 * what `pieceSaid` answers in the app: with the number column gone, a row
 * reading "Not named" would be a row with nothing on it.
 */
const ROOM = [
  { name: 'By the window' },
  { name: 'Bookcase 2' },
  { name: 'The landing' },
  { name: 'Hall crate' },
  { name: 'Desk' },
]

/**
 * The books standing on 2 · Cookery, and the four things any ordering files
 * them under.
 *
 * They are drawn under the sort rule on both pages, and they are the whole
 * answer to the owner's "it's hard to see why they sort". So the same eight
 * books are held once, and each state below picks the column that state's
 * ordering reads: a surname, a title, a year. Picked so the three orders are
 * visibly different from each other, which is the point of showing them at all.
 */
const COOKERY = [
  { id: 1, who: 'Acton, Eliza', title: 'Modern Cookery', year: '1845' },
  { id: 2, who: 'David, Elizabeth', title: 'A Book of Mediterranean Food', year: '1950' },
  { id: 3, who: 'Fisher, M. F. K.', title: 'How to Cook a Wolf', year: '1942' },
  { id: 4, who: 'Grigson, Jane', title: 'Good Things', year: '1971' },
  { id: 5, who: 'McGee, Harold', title: 'On Food and Cooking', year: '1984' },
  { id: 6, who: 'Nosrat, Samin', title: 'Salt Fat Acid Heat', year: '2017' },
]

/**
 * The same books as the sort rule widget wants them, in one ordering.
 *
 * The second column is the author where the first one is the title, so that
 * ordering by the title does not print the same string twice. Found by looking
 * at it.
 */
const sampleBy = (by: 'who' | 'title' | 'year') =>
  [...COOKERY]
    .sort((a, b) => (a[by] < b[by] ? -1 : a[by] > b[by] ? 1 : 0))
    .map((book) => ({
      id: book.id,
      by: book[by],
      said: by === 'title' ? book.who : book.title,
    }))

/**
 * The two ends of the eighteen books on 2 · Cookery, in each ordering.
 *
 * Written out rather than taken off `COOKERY`, because `COOKERY` is six books
 * and the area holds eighteen: the sample is the first few and the ends are the
 * two ends of the lot. A drawing that took the ends off the sample would show
 * somebody "Acton to Nosrat" over a card saying "and twelve more".
 *
 * This is the line that replaced the numbered stack of three levels (#405). It
 * is the shortest true answer to what order the books are in, and it is said in
 * whatever the ordering reads: surnames under the author, years under the year.
 */
const COOKERY_ENDS: Record<'who' | 'title' | 'year', OrderEnds> = {
  who: { first: 'Acton, Eliza', last: 'Slater, Nigel' },
  title: { first: 'A Book of Mediterranean Food', last: 'The Vegetarian Epicure' },
  year: { first: '1845', last: '2017' },
}

/** The same two ends on a whole piece of furniture, which is a wider set. */
const PIECE_ENDS: Record<'who' | 'year', OrderEnds> = {
  who: { first: 'Acton, Eliza', last: 'Woolf, Virginia' },
  year: { first: '1845', last: '2021' },
}

/**
 * The eighteen books standing on 2 · Cookery, as they read walking along them.
 *
 * The filing names, because that is what is printed down a spine and what you
 * read walking along a shelf: `ShelfItem.text` says so, and the app draws this
 * board from `authorFiling` for the same reason. Eighteen of them, so the board
 * is wider than a phone and scrolls the way a real one does.
 */
const COOKERY_BOARD = [
  'Acton, Eliza', 'Beeton, Isabella', 'Blumenthal, Heston', 'Child, Julia',
  'David, Elizabeth', 'Dahl, Sophie', 'Fisher, M. F. K.', 'Grigson, Jane',
  'Hopkinson, Simon', 'Lawson, Nigella', 'Locatelli, Giorgio', 'McGee, Harold',
  'Nosrat, Samin', 'Ottolenghi, Yotam', 'Roden, Claudia', 'Rogers, Ruth',
  'Slater, Nigel', 'Smith, Delia',
]

/**
 * Bookcase 2, drawn wherever a screen needs it.
 *
 * It used to be drawn on the area screen too, above everything that screen is
 * for. The owner took it off: "when we're in the area view we don't need to
 * show the bookcase any more. You see Bookcase 2 and that's taking up so much
 * of the screen."
 */
function Bookcase2({ go, head }: { go: Go; head?: () => void }) {
  return (
    <Nest
      name="Bookcase 2"
      note="63 books"
      holds="Anything tagged Non-fiction"
      onPress={head ?? (() => go('area'))}
    >
      {AREAS_2.map((area) => (
        <AreaBox
          key={area.reads}
          reads={area.reads}
          books={area.books}
          holds={area.holds}
          onPress={() => go('area')}
        />
      ))}
      <AddBox onPress={() => go('furniture')}>Add an area to bookcase 2</AddBox>
    </Nest>
  )
}

function Furniture(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title={FIXTURES_WORD} sub="Six pieces, sixteen areas" onBack={() => go('library')} />}
    >
      <Nest
        name="By the window"
        note="93 books"
        holds="Anything tagged Fiction"
        onPress={() => go('bookcase')}
      >
        {AREAS_1.map((area) => (
          <AreaBox
            key={area.reads}
            reads={area.reads}
            books={area.books}
            holds={area.holds}
            onPress={() => go('area')}
          />
        ))}
        <AddBox onPress={() => go('furniture')}>Add an area to this bookcase</AddBox>
      </Nest>

      <Bookcase2 go={go} head={() => go('bookcase')} />

      <Nest
        name="The landing"
        note="66 books"
        holds="Anything tagged Poetry"
        onPress={() => go('bookcase')}
      >
        {AREAS_3.map((area) => (
          <AreaBox
            key={area.reads}
            reads={area.reads}
            books={area.books}
            holds={area.holds}
            onPress={() => go('area')}
          />
        ))}
        <AddBox onPress={() => go('furniture')}>Add an area to this bookcase</AddBox>
      </Nest>

      <Nest
        name="Hall crate"
        note="26 books"
        holds="No rule sends books here"
        onPress={() => go('bookcase')}
      >
        {AREAS_4.map((area) => (
          <AreaBox
            key={area.reads}
            reads={area.reads}
            books={area.books}
            holds={area.holds}
            onPress={() => go('area')}
          />
        ))}
        <AddBox onPress={() => go('furniture')}>Add an area to this crate</AddBox>
      </Nest>

      <Nest
        name="Desk"
        note="10 books"
        holds="No rule sends books here"
        onPress={() => go('bookcase')}
      >
        {AREAS_5.map((area) => (
          <AreaBox
            key={area.reads}
            reads={area.reads}
            books={area.books}
            holds={area.holds}
            onPress={() => go('area')}
          />
        ))}
        <AddBox onPress={() => go('furniture')}>Add an area to this desk</AddBox>
      </Nest>

      {/*
        The state that is not the happy path, and the one #401 was about: a
        piece somebody has moved a whole stretch of books off. Its areas are
        gone and every book is still standing on it, because the app records
        where the books belong and a person carries them.

        It drew as nothing at all, which is what the owner found: a bookcase
        reading "0 areas, 0 books" on the same second the carrying list named
        its areas as the place forty-six books were leaving. So the areas that
        were taken out are drawn, outlined rather than filled, and the count on
        the piece is what is on the piece.
      */}
      <Nest
        name="By the door"
        note="46 books"
        holds="No rule sends books here"
        onPress={() => go('bookcase')}
      >
        <AreaBox reads="6A" books={8} gone onPress={() => go('area')} />
        <AreaBox reads="6B" books={20} gone onPress={() => go('area')} />
        <AreaBox reads="6C" books={18} gone onPress={() => go('area')} />
        <AddBox onPress={() => go('furniture')}>Add an area to this bookcase</AddBox>
      </Nest>

      {/*
        Not "add a bookcase". The owner: "they're not bookcases. They are
        fixtures, not bookcases." The rule has two halves and this is the
        second one: a piece somebody named is called what they called it, and
        the category is called something that does not assume a shape. "Add
        area to this desk" is right because that piece is a desk; "add a
        bookcase" is wrong because the next one is a crate.

        The card under this said "they are numbered by where they stand",
        which is the kind of sentence he has been taking off screens all week.
        The action it held is worth keeping and needs no paragraph over it.
      */}
      <Button tone="primary" block onPress={() => go('bookcase')}>
        Add a fixture
      </Button>
      <Button tone="quiet" block onPress={() => go('bookcase')}>
        Change the order
      </Button>
    </Phone>
  )
}

/**
 * One piece of furniture, and the two states of its sort rule.
 *
 * Two screens draw this and the difference between them is one widget being
 * open, which is exactly why they are one function: the whole point of changing
 * the ordering in place is that the page around it does not change.
 */
function BookcaseScreen({
  go,
  sorting = false,
  writing,
}: {
  go: Go
  sorting?: boolean
  /** The rule under a thumb, where somebody is changing what the piece allows. */
  writing?: RuleEditing
}) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Bookcase 2" sub="3 areas, 63 books" onBack={() => go('furniture')} />}
    >
      {/*
        The piece itself was drawn here, areas and all, with the way to cut
        another one into it. The owner took it off (#367): "on the edit view we
        shouldn't have that there. It should just have what you call it, what it
        is, where it stands." The same note he gave about the area screen, where
        the bookcase over everything that screen was for "is taking up so much
        of the screen". The areas are on the room, against the piece they are
        on, which is the screen this one is opened from.
      */}
      <Field label="What you call it" placeholder="Not named" />

      <Field label="What it is" value="Bookcase" />

      {/*
        Two buttons stood under this, "move it earlier" and "move it later".
        The owner: "we should just do that in a better way that doesn't
        require those buttons. Maybe it's a drag and drop, they can just drag
        it and move it between their other things. Keep in mind that that may
        wrap." So the pieces are a column you drag within, and the wrap he
        warned about is not a case that can arise. See `Order`.
      */}
      <div>
        <span className="wf-field__label">Where it stands</span>
        <div style={{ height: 6 }} />
        <Order slots={ROOM.map((slot) => ({ ...slot, on: slot.name === 'Bookcase 2' }))} />
      </div>

      <Card weight="sunk" kind="What it will be called" title="2A, 2B, 2C" />

      <Button tone="primary" block onPress={() => go('furniture')}>
        Save
      </Button>

      {/*
        The two rules, drawn by the same two widgets the area's page draws them
        with. The owner asked for both places to answer both questions: "whenever
        we're in the detailed view of a fixture or an area, we need to be able to
        very easily see and change the current sort rule and the current filter
        rule."

        A piece is not an area wearing a different heading, and the two
        differences are visible here rather than smoothed over. What it inherits
        from is the whole library, because nothing stands between a piece and the
        collection; and there is no sentence about taking what overflows from
        before it, because books flow along a piece rather than between pieces.
      */}
      <FilterRule
        holds={writing
          ? 'Anything tagged under Fiction'
          : 'Anything tagged Non-fiction'}
        rules={[{
          name: 'Non-fiction',
          lines: [{ operator: 'is', tag: 'Non-fiction' }],
          enabled: true,
        }]}
        editing={writing}
        onEdit={() => go('fixturerule')}
      />

      {/*
        The same widget the area's page draws, and the same thing leads it: the
        ordering itself. It said "The way the whole library does" until #405,
        which is where the answer comes from rather than what it is, over three
        numbered levels two of which pointed at each other.

        Open, the answers stand under it and the two ends and the books redraw
        in whichever is picked. The year is drawn as the chosen one because its
        difference is impossible to miss: the same books, the same page, a
        completely different order, before anything has been written.
      */}
      <SortRule
        /* The ordering in force, open or shut: what is being picked is under
           "How they would stand" and this is what "Leave it as it is" goes
           back to. */
        said="By the author"
        ends={sorting ? PIECE_ENDS.year : PIECE_ENDS.who}
        where={sorting
          ? undefined
          : 'Set for the whole library, which bookcase 2 follows, and so does every area '
            + 'on it that orders nothing of its own.'}
        sample={sorting ? sampleBy('year') : sampleBy('who')}
        more={57}
        open={sorting}
        chosen={sorting ? 'published' : undefined}
        options={sorting ? ORDERINGS('the whole library') : []}
        onOpen={() => go('fixturesort')}
        onSave={() => go('bookcase')}
        onClose={() => go('bookcase')}
      />

      {/*
        Out of the card that says what the piece allows and standing on its own
        (#405): "let's move that out of where we define the rules." There is no
        board of books on this page for it to stand under, because a piece is
        more than one row of books and one row of books is one area, so it takes
        the same place in the order instead: after everything about the piece
        and before the one thing that takes the piece away.
      */}
      {!writing && <MoveBooks onPress={() => go('move')} />}

      {/*
        "Take it out of the room" over "the books do not vanish with it" is
        gone: "let's just say maybe delete fixture, and then that obviously
        initiates the transition of the books to another fixture, or takes
        them through the movement process."

        The reassurance went; the guarantee did not. What replaces the
        sentence is the fact of what pressing it does, said in a count and
        proved by where it lands: the plan, which is the same list of books
        and destinations somebody already carries a shelf by. A promise that
        the books are safe is worth less than the screen that shows all
        sixty-three of them and where each one goes.
      */}
      <Card weight="quiet" kind="Its 63 books move to other furniture first">
        <Button tone="danger" block onPress={() => go('plan')}>
          Delete fixture
        </Button>
      </Card>
    </Phone>
  )
}

const Bookcase = (go: Go) => <BookcaseScreen go={go} />
const BookcaseSorting = (go: Go) => <BookcaseScreen go={go} sorting />

/**
 * The same rule editor, on a piece of furniture rather than on an area.
 *
 * > Same thing with the fixtures: we need to show the user the filter rules,
 * > like we only allow these tags or whatever, and then the order rules and how
 * > they're ordered.
 *
 * One widget, two callers, and the difference between them is not smoothed
 * over. A piece rule is where a stretch of books **begins** and it carries on
 * through every area after it, so changing what a piece allows is a bigger
 * statement than changing what one area allows, and the line under the editor
 * says so. Drawn on one line rather than two, and on "and everything under it",
 * because that is the answer a piece usually wants: a whole branch of the
 * vocabulary, filed together, in one run of shelving.
 */
const BookcaseRule = (go: Go) => (
  <BookcaseScreen
    go={go}
    writing={{
      groups: [[{ operator: 'under', tag: 'Fiction' }]],
      choosing: null,
      onAdd: () => go('ruletag'),
      onTakeOff: () => go('bookcase'),
      onAlso: () => go('ruleor'),
      onDrop: () => go('bookcase'),
      onPlan: () => go('rulemoves'),
      onClose: () => go('bookcase'),
    }}
  />
)

/**
 * The answers to how a place is ordered, in that place's own words.
 *
 * Five, which is why they stack rather than sitting in a row: a segmented
 * control stops working at four. What inheriting is called is the argument the
 * whole widget rests on, so it is a parameter here too: an area takes the piece
 * it stands on and a piece takes the whole library, and neither sentence is
 * true of the other.
 */
const ORDERINGS = (from: string) => [
  { value: 'inherit', word: `The way ${from} does`, sub: 'By the author today' },
  { value: 'author', word: 'By the author' },
  { value: 'title', word: 'By the title' },
  { value: 'published', word: 'By the year it came out' },
  { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
]

/**
 * One area, and what you can change about it.
 *
 * **It does not draw the piece it sits on.** The whole of bookcase 2 used to
 * stand at the top of this, above everything the screen is for. The owner:
 * "when we're in the area view we don't need to show the bookcase any more.
 * You see Bookcase 2 and that's taking up so much of the screen. We're in Area
 * 2, Cookery. We shouldn't be rendering the fixture that it's a part of here.
 * We should be enabling changing the settings, like the name and the rule set
 * and stuff like that on it."
 *
 * Which piece it is on has not been lost, and it did not need a drawing: the
 * top bar says it in four words, and the arrow beside them goes there.
 *
 * ## What belongs here and how it is ordered are answered here (#381)
 *
 * > On the area detail view, it's not very obvious at all how to change the
 * > rules [...] So instead of "see what belongs here" we should just show what
 * > belongs there, and then have the ability to edit it if the user clicks it.
 * > And then how it's ordered is another one. I like to see what belongs here
 * > and how it's ordered, but I don't like the way that this is represented
 * > inside the screen. Instead it should be like "sort rule" or something.
 *
 * Two screens went with that note, and both are widgets now, drawn here and on
 * the piece's own page from one definition. The sort rule shows the books in the
 * order it puts them, which is the half a name cannot answer: "it's hard to see
 * how things sort, or why they sort."
 *
 * The primary button that split the area in two went with the screen it opened.
 * A boundary is still moved by moving one, from the book that starts it, which
 * is the screen somebody is on when they notice.
 *
 * **Six screens draw this**, which is why it takes arguments: the area itself,
 * the sort rule open, the books standing here, and the three states of being
 * asked to remove one. The dialog is drawn over the same screen it was opened
 * from rather than over a stand-in, because that is the only way to see whether
 * it can be read against what is behind it.
 */
function AreaScreen({
  go,
  label,
  sub,
  name,
  belongs,
  rules,
  beaten,
  writing,
  retarget = true,
  refused,
  would,
  done,
  ordered,
  ends,
  settled,
  order,
  warn,
  sample,
  sorting = false,
  chosen,
  board,
  empty = false,
  instead,
  over,
}: {
  go: Go
  /** What the area reads as, worked out from the two names and the position. */
  label: string
  sub: string
  /** What they called it, where they called it anything. */
  name?: string
  /** What the rule sends here, said the way a person would say it. */
  belongs: string
  /** The rules that file here, joined by "or" where there is more than one. */
  rules?: RuleSaid[]
  /** Every rule that reaches here, where more than one does. */
  beaten?: { id: number; name: string; place: string; wide: boolean }[]
  /** The rule under a thumb, where somebody is changing what belongs here. */
  writing?: RuleEditing
  /**
   * Whether the quiet door to #244's journey is drawn at all.
   *
   * Off where the rule is about one area rather than about a stretch of books,
   * which is what the app itself does: `AreaPane` offers it only for a rule that
   * serves a whole run and says why in words otherwise. A drawing that offered
   * "move these books to another bookcase" on a shelf holding no books was the
   * gallery promising a journey the app refuses.
   */
  retarget?: boolean
  /** Why the stretch cannot be pointed elsewhere, where it cannot. */
  refused?: string
  /** What the change would do, once they have asked. */
  would?: { moving: WouldMove[]; carrying: number; staying: number; unclaimed: number; note?: string }
  /** What was written, where they said yes to it. */
  done?: { wrote: number; carrying: number }
  /** The ordering in force, in words. Never a level and never a deferral. */
  ordered: string
  /** The two ends of the books, as that ordering files them. */
  ends?: OrderEnds
  /** Where the ordering is really set, in one sentence. */
  settled?: string
  /** The line under that, where there is more to say. */
  order?: string
  /** What picking this would do here, said before anything is pressed. */
  warn?: string
  /** The books, in the order the ordering being looked at puts them. */
  sample?: { id: number; by: string; said: string }[]
  sorting?: boolean
  chosen?: string
  /**
   * The books standing here, drawn as the board they stand on (#405).
   *
   * > At the bottom where we say "standing on Bookshelf X" and we show all the
   * > books that are in the area: let's switch that to a shelf view instead of
   * > a list.
   */
  board?: ShelfItem[]
  /** An area somebody has cleared and written a rule for, holding nothing. */
  empty?: boolean
  /**
   * A different drawing of the sort rule, in the place the sort rule stands.
   *
   * Here so that the two answers to #405 can be compared on the same page with
   * the same neighbours rather than side by side in isolation, which is the
   * only way to tell whether one of them reads better on the way past. It goes
   * when the question does, along with the screens that pass it and the group
   * they file under: a comparison left standing after its question is settled
   * quietly reopens it.
   */
  instead?: ReactNode
  over?: ReactElement
}) {
  return (
    <Phone
      tab="library"
      go={go}
      over={over}
      top={<TopBar title={label} sub={sub} onBack={() => go('bookcase')} />}
    >
      <Field label="What you call this area" value={name} placeholder="Not named" />

      <FilterRule
        holds={belongs}
        rules={rules ?? []}
        beaten={beaten}
        editing={writing}
        onEdit={() => go('rulewriting')}
      />

      {/*
        Written down, and the way on is the work rather than another screen. The
        card above it now reads as the rule that was just made, because that is
        what belongs here from this moment; what this adds is the count of what
        was written and the door to the books it made somebody responsible for.
      */}
      {done && (
        <Confirmation said={`${done.wrote} books now belong somewhere else.`}>
          <p className="wf-said">
            The {done.carrying} books to carry are on your list, grouped into the trips
            you would walk. Say so on each one once it is actually there.
          </p>
        </Confirmation>
      )}

      {would && (
        <WouldHappen
          holds={belongs}
          moving={would.moving}
          carrying={would.carrying}
          staying={would.staying}
          leaving={[{ said: 'pinned where they are, which beats every rule', books: 3 }]}
          unclaimed={would.unclaimed}
          note={would.note}
          onApply={() => go('ruledone')}
          onNotYet={() => go('rulewriting')}
        />
      )}

      {done && (
        <Button tone="primary" block onPress={() => go('carry')}>
          Go and carry them
        </Button>
      )}

      {/*
        How these books read, and the way to change it. The loudest line is the
        ordering itself, and under it the two ends of the books and the one
        sentence naming where the ordering is really set. What stood here for a
        round was three numbered levels, two of which said "the way the thing
        above me does", and the owner read it and said it was "not very
        understandable at all". See `SortRule`.
      */}
      {instead ?? (
        <SortRule
          said={ordered}
          ends={ends}
          where={sorting ? undefined : settled}
          note={sorting ? undefined : order}
          sample={sample ?? []}
          more={sample ? 12 : 0}
          open={sorting}
          chosen={chosen}
          warn={warn}
          options={sorting ? ORDERINGS('bookcase 2') : []}
          onOpen={() => go('sortrule')}
          onSave={() => go('area')}
          onClose={() => go('area')}
        />
      )}

      {/*
        The books, standing on the board they stand on. They were a list of rows
        on the one page in this app that is about a physical row of books, and
        the owner said what that should be: "let's switch that to a shelf view
        instead of a list."

        It is the design system's own board, which is the only board there is
        since #399, and it is one row because one row of books is one area. An
        area holding nothing draws it empty, which is a real state and a real
        picture: a plank somebody has cleared and written a rule for.
      */}
      {(board || empty) && (
        <div className="wf-bleed">
          {/* No count on the board: the bar two lines above it already says
              "18 books, on bookcase 2". "Empty" is a different fact and comes
              off the area rather than off the list, because a list is also
              empty while its read is in flight. */}
          <Shelf label={label} note={empty ? 'Empty' : undefined} items={board ?? []} />
        </div>
      )}

      {/*
        And under the books, the way to move them: "let's also change 'move
        these books to another bookcase', let's move that out of where we define
        the rules. Maybe we move it underneath the shelf view."
      */}
      {!writing && !would && !done && (
        <MoveBooks
          onPress={rules?.length && retarget ? () => go('move') : undefined}
          refused={refused}
        />
      )}

      {/*
        The way to remove an area, which the interface did not have anywhere at
        all until #281, and which no longer wears a dashed box: "I also don't
        like how 'remove this area' is surrounded in a dotted box."

        What the fence was for still holds and is now done by the arrangement
        rather than by an outline: it is last, under everything, and the dialog
        in front of it is where what it does to somebody's books is said. A
        standing explanation of a button nobody has pressed is the ambient prose
        #262 took thirty-one instances of off these screens.
      */}
      <Button tone="danger" block onPress={() => go('removearea')}>
        Remove this area
      </Button>
    </Phone>
  )
}

/** The rule that files onto 2 · Cookery, as both of its states need it. */
const COOKERY_RULE = {
  name: 'Cookery',
  lines: [
    { operator: 'is' as const, tag: 'Non-fiction', carried: 412 },
    { operator: 'under' as const, tag: 'Cookery', carried: 18 },
  ],
  enabled: true,
}

/*
 * Both rules reach this area, and the order between them is the whole of what
 * settles a tie: the one about the smaller place wins. A page that drew only the
 * winner would answer half the question somebody opened it to ask.
 */
const COOKERY_REACHING = [
  { id: 1, name: 'Cookery', place: '2 · Cookery', wide: false },
  { id: 2, name: 'Non-fiction', place: 'bookcase 2', wide: true },
]

/** The books standing on 2 · Cookery, on the board they stand on. */
const COOKERY_BOOKS: ShelfItem[] = spines(COOKERY_BOARD)

/**
 * The same eighteen books on an area that orders itself by the year.
 *
 * A second order rather than the same one relabelled, because a board is a
 * picture of a row of books: a row drawn A to Z under a card that says "by the
 * year it came out" is the page arguing with itself, and that is exactly the
 * disagreement this round is about.
 */
const COOKERY_BY_YEAR: ShelfItem[] = spines([
  'Acton, Eliza', 'Beeton, Isabella', 'Fisher, M. F. K.', 'David, Elizabeth',
  'Child, Julia', 'Grigson, Jane', 'Roden, Claudia', 'Smith, Delia',
  'McGee, Harold', 'Rogers, Ruth', 'Hopkinson, Simon', 'Slater, Nigel',
  'Lawson, Nigella', 'Blumenthal, Heston', 'Locatelli, Giorgio', 'Dahl, Sophie',
  'Ottolenghi, Yotam', 'Nosrat, Samin',
], 3)

/*
 * `AREA_LEVELS`, `HALL_LEVELS` and `PIECE_LEVELS` were here: three numbered
 * rows apiece, from the whole library down to the area, with the row the answer
 * really came from marked "This one decides".
 *
 * They are gone (#405), and so is the widget that drew them. The owner read
 * them and said the sort rule was "not very understandable at all", and the
 * three levels are why: two of the three rows always said "the way the thing
 * above me does", so the answer to "what order are my books in" was at the end
 * of a chain of pointers rather than at the top of the card. The levels are a
 * true fact about the model and were never a fact anybody needed drawn.
 *
 * What replaces them is one sentence naming the place the ordering is really
 * set, which is the only one of the three anybody would go to.
 */

/** Where each of the three areas the gallery draws really gets its ordering. */
const SETTLED_COOKERY =
  'Set for the whole library, which bookcase 2 and this area both follow.'

const SETTLED_HALL =
  'Set for the whole library, which the hall bookcase and this area both follow.'

function Area(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Cookery"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
      board={COOKERY_BOOKS}
    />
  )
}

/**
 * The same area with its sort rule open, which is the state that has to be
 * looked at rather than described.
 *
 * The answers stand where the widget was and the books under them are drawn in
 * the one being picked, so what a person sees before pressing Save is the thing
 * the change would do. Drawn on "by the title", because that is an order visibly
 * unlike the one above it: the same six books, no longer under a surname.
 *
 * The sentence over the answer is the server's own, and it is the reason this
 * is safe to offer one tap from a page somebody is only reading: an area with an
 * order of its own takes no overflow, so choosing one cuts the stretch it was in.
 */
function AreaSorting(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Cookery"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      ordered="By the author"
      ends={COOKERY_ENDS.title}
      order="It takes what overflows from the area before it."
      sample={sampleBy('title')}
      sorting
      chosen="title"
      warn="Ordering this area its own way also means it stops taking what overflows from the area before it."
      board={COOKERY_BOOKS}
    />
  )
}

/**
 * The order this area's books are in, and the two ends of them, when the area
 * is the place that decides.
 *
 * The state the sentence has to be different for, and the one it would be
 * easiest to smooth over: an area with an ordering of its own is a place of its
 * own, so nothing overflows into it from the area before. That is a real
 * consequence of a real setting and losing it to make the widget shorter would
 * be losing the only thing about this setting a person cannot work out by
 * looking at their own bookcase.
 *
 * The board underneath is in that order too, and it has to be: it is a picture
 * of a row of books, and a row drawn A to Z under a card saying "by the year it
 * came out" is the page arguing with itself.
 */
function AreaOwn(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Cookery"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      ordered="By the year it came out"
      ends={COOKERY_ENDS.year}
      settled="Set on this area, so nothing above it decides how these books read."
      order="It orders itself, so nothing overflows into it from the area before."
      board={COOKERY_BY_YEAR}
    />
  )
}

/*
 * --- The other answer, for as long as the question is open -----------------
 *
 * The owner has rejected two drawings of the sort rule and the second one hard:
 * "the way that we are representing the sort rule in the widget is not very
 * understandable at all." Two drawings of the same material have now failed, so
 * this round drew two answers that are not the same material and put both of
 * them on the same page, with the same neighbours, at the size he holds.
 *
 * **The first answer is the one that is built** and it is on `area` and
 * `sortrule`: the ordering itself as the loudest line, the two ends of the
 * books under it, one sentence naming where it is set, and the whole of the
 * inheritance kept out of sight until somebody changes something.
 *
 * **The second answer is these two screens.** It leads with the same line and
 * then splits the change in two: first "does this area follow the piece it
 * stands on", then, only if not, which ordering it uses. That is the model's
 * inheritance turned into the one thing a person actually decides about it, and
 * it takes the odd fifth member out of a list of four real orderings. It costs
 * a press and a control, and the consequence of not following lands on the
 * switch that causes it rather than in a line underneath.
 *
 * Why the first one is recommended is in the pull request. **These go the day
 * the question is answered**, with the `instead` prop and this group, for the
 * reason the register at the foot of this file already gives: a comparison left
 * standing after its question is settled quietly reopens it.
 */

/** The four real orderings, with no "follow" among them. That is the point. */
const FOUR = [
  { value: 'author', word: 'By the author' },
  { value: 'title', word: 'By the title' },
  { value: 'published', word: 'By the year it came out' },
  { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
]

/**
 * The sort rule asked as two questions instead of one list.
 *
 * Closed it says the same two things the built one says, in the same order: the
 * ordering, then where it comes from. Open, "the way bookcase 2 does" stops
 * being an option among orderings and becomes the question it really is, and
 * the four orderings appear only once the answer to it is no.
 */
function OtherOrder({
  go,
  open = false,
  own = false,
}: {
  go: Go
  open?: boolean
  /** Whether the answer under a thumb is "its own way" rather than "follow". */
  own?: boolean
}) {
  return (
    <Card
      kind="Sort rule"
      /* The ordering in force, exactly as the built one says it. The two
         answers differ in how the change is asked and in nothing else, so
         anything else that differed would be noise in the comparison. */
      title="By the author"
      foot={open
        ? (
          <>
            <Button tone="primary" block onPress={() => go('otherorder')}>
              Order it that way
            </Button>
            <Button tone="quiet" block onPress={() => go('otherorder')}>
              Leave it as it is
            </Button>
          </>
        )
        : (
          <Button tone="secondary" block onPress={() => go('otherown')}>
            Change the sort rule
          </Button>
        )}
    >
      {!open && (
        <>
          <p className="wf-ends">
            <span className="wf-ends__end">Acton, Eliza</span>
            <span className="wf-ends__to">to</span>
            <span className="wf-ends__end">Slater, Nigel</span>
          </p>
          <p>It follows bookcase 2, which is following the whole library.</p>
        </>
      )}

      {open && (
        <>
          <p className="wf-order__head">Does this area follow bookcase 2?</p>
          <Segmented
            label="Whether this area follows the piece it stands on"
            on={own ? 'own' : 'follow'}
            onPick={(pick) => go(pick === 'own' ? 'otherown' : 'otherorder')}
            options={[
              { value: 'follow', word: 'Follow it' },
              { value: 'own', word: 'Its own way' },
            ]}
          />

          {own && (
            <>
              <Choice
                label="How the books here should be ordered"
                on="title"
                options={FOUR}
              />
              <p className="wf-rule__effect">
                An area ordered its own way stops taking what overflows from the area
                before it.
              </p>
            </>
          )}

          <p className="wf-order__head">How they would stand</p>
          <p className="wf-ends">
            <span className="wf-ends__end">
              {own ? 'A Book of Mediterranean Food' : 'Acton, Eliza'}
            </span>
            <span className="wf-ends__to">to</span>
            <span className="wf-ends__end">
              {own ? 'The Vegetarian Epicure' : 'Slater, Nigel'}
            </span>
          </p>
          <ol className="wf-sample" aria-label="The books in the order you have picked">
            {(own ? sampleBy('title') : sampleBy('who')).map((book) => (
              <li className="wf-sample__book" key={book.id}>
                <span className="wf-sample__by">{book.by}</span>
                <span className="wf-sample__title">{book.said}</span>
              </li>
            ))}
            <li className="wf-sample__more">and 12 more, in that order</li>
          </ol>
        </>
      )}
    </Card>
  )
}

/** The second answer, closed: the same two lines, and one press to change it. */
const OtherOrderShut = (go: Go) => (
  <AreaScreen
    go={go}
    label="2 · Cookery"
    sub="18 books, on bookcase 2"
    name="Cookery"
    belongs="Anything tagged Cookery"
    rules={[COOKERY_RULE]}
    beaten={COOKERY_REACHING}
    ordered="By the author"
    board={COOKERY_BOOKS}
    instead={<OtherOrder go={go} />}
  />
)

/** The second answer, open, with "its own way" under a thumb. */
const OtherOrderOwn = (go: Go) => (
  <AreaScreen
    go={go}
    label="2 · Cookery"
    sub="18 books, on bookcase 2"
    name="Cookery"
    belongs="Anything tagged Cookery"
    rules={[COOKERY_RULE]}
    beaten={COOKERY_REACHING}
    ordered="By the author"
    board={COOKERY_BOOKS}
    instead={<OtherOrder go={go} open own />}
  />
)

/*
 * --- Writing the rule itself, on the place it is about ---------------------
 *
 * > It still does not do what I'm looking for in regards to changing the rules
 * > on an area. It's not that the rule is "point Fiction somewhere else" -
 * > that's not the rule we're looking for changing. We want to be able to
 * > assign any rules that are available. [...] If they change the rule to say,
 * > in an area, I want only comic books, only books with the tag comic books
 * > and fiction, then that's what is now only allowed in that area, and we
 * > should issue moves to adjust the books to where they need to go based off
 * > these new rules.
 *
 * Four states and they are one journey: the rule under a thumb, choosing a tag
 * to add to it, the rule with everything taken off, and what the change would
 * do. Only the last of them can write anything.
 *
 * **The one journey survives and this joins it.** Every issue before this said
 * not to build a second way to change a rule; what that was protecting was not
 * the retargeting screen but the sentence underneath it, which is that books
 * move after somebody has read a plan and applied it and then carried them. So
 * this ends on a plan with counts in it and a door to the carry list, and the
 * retargeting screen keeps its own door, quietly, on the card above.
 */

/** The rule his own words describe: comic books **and** fiction, not either. */
const COMICS_LINES: { operator: 'is' | 'under'; tag: string }[] = [
  { operator: 'is', tag: 'Comic books' },
  { operator: 'is', tag: 'Fiction' },
]

const writing = (go: Go, over: Partial<RuleEditing> = {}): RuleEditing => ({
  groups: [COMICS_LINES],
  choosing: null,
  onAdd: () => go('ruletag'),
  onTakeOff: () => go('rulenothing'),
  onAlso: () => go('ruleor'),
  onDrop: () => go('rulenothing'),
  onPlan: () => go('rulemoves'),
  onClose: () => go('area'),
  ...over,
})

/**
 * The rule under a thumb: two lines, each with the tag it is about and the two
 * things that tag can mean.
 *
 * The joining word is "and" and there is no control offering another one,
 * because there is no other one. Comic books **or** fiction is two rules, each
 * naming its own place, and the sentence under the lines says so where somebody
 * is about to look for the missing option.
 */
function RuleWriting(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Comic books and Fiction"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      writing={writing(go)}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/**
 * Choosing a tag, which is a search and not a list.
 *
 * The count beside each answer is the reason the box earns its room: adding a
 * tag forty books carry and adding one that nothing carries are different
 * decisions, and the word on its own does not say which is which. A word this
 * collection has never used is answered by the screen after this one, because a
 * shelf gets prepared before the books arrive rather than after.
 */
function RuleTag(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Comic books and Fiction"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      writing={writing(go, {
        choosing: {
          group: 0,
          /*
           * The letters match anywhere in the word rather than at the front,
           * which is drawn rather than described: "Second World War" is in this
           * list on the strength of its middle. Somebody who has to remember
           * how a tag starts is somebody scrolling a vocabulary instead.
           */
          query: 'co',
          offering: [
            { tag: 'Comic books', books: 46 },
            { tag: 'Cookery', books: 18 },
            { tag: 'Economics', books: 22 },
            { tag: 'Second World War', books: 31 },
          ],
          onQuery: () => go('rulenewtag'),
          onPick: () => go('rulewriting'),
          onClose: () => go('rulewriting'),
        },
      })}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/**
 * A word this collection has never used, offered as the thing it is.
 *
 * > The comics should live on the bottom shelf of the hall bookcase, and only
 * > comics.
 *
 * The usability baseline could not do that (#392). This box only ever offered
 * tags some book already carried, and the only place in the app that could
 * invent one was the review pane of a book still in the queue, so preparing a
 * shelf meant scanning a comic first. That is backwards from why anybody clears
 * a shelf: you decide what goes on it **before** the books arrive.
 *
 * **It is not a second way to make a tag.** `domain/tagging/naming.ts` decides
 * what a word means, here exactly as it does on a book, so "Comic Book" and
 * "comic books" are still one tag and there is still no way past that. The
 * offer is the same dashed drawing the panel on a book uses, so somebody who
 * has made a tag once meets a thing they already know.
 *
 * **Nothing is written here.** The word becomes a tag at the same press the
 * rule becomes a row, which is two screens along, and a draft somebody walks
 * away from leaves no word behind.
 */
function RuleNewTag(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="4 · Bottom row"
      sub="Nothing on it yet, in the hall"
      name="Bottom row"
      belongs="Nothing files here yet"
      writing={writing(go, {
        groups: [[]],
        choosing: {
          group: 0,
          query: 'manga',
          offering: [],
          make: { name: 'Manga', where: 'Subject', onPress: () => go('rulewaiting') },
          onPick: () => go('rulewaiting'),
          onClose: () => go('rulewriting'),
        },
      })}
      ordered="By the author"
      settled={SETTLED_HALL}
      order="It takes what overflows from the area before it."
      empty
    />
  )
}

/**
 * A shelf somebody prepared before the books arrived.
 *
 * The rule is written, it is not broken, and nothing files here: the word it
 * asks for is one no book in the collection carries yet. **Somebody who has
 * cleared a shelf wants to know it is waiting rather than that it failed**, and
 * without the line under it this reads exactly like a rule that claims forty
 * books.
 *
 * The sentence is the empty rule's own clause rather than a second vocabulary
 * for nearly the same thing. "It asks for nothing, so it claims nothing" is
 * already how this widget says that a half-built rule is a real state; this is
 * the neighbouring case, and it ends the same way and adds the one word that
 * makes it different: **yet**.
 */
function RuleWaiting(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="4 · Bottom row"
      sub="Nothing on it yet, in the hall"
      name="Bottom row"
      belongs="Anything tagged Manga"
      rules={[{
        name: 'Manga',
        lines: [{ operator: 'is', tag: 'Manga', carried: 0 }],
        enabled: true,
      }]}
      retarget={false}
      refused="Manga is about this one area, and what can be moved elsewhere is a whole stretch of books that begins on a piece of furniture. What this area allows is still yours to change."
      ordered="By the author"
      settled={SETTLED_HALL}
      order="It takes what overflows from the area before it."
      empty
    />
  )
}

/**
 * A rule with everything taken off it, which is a real state and not an error.
 *
 * "All of no conditions hold" is true, so a rule with an empty list would take
 * the whole catalogue if the model let it. It does not: `domain/placement/rules`
 * says a rule with no conditions claims nothing, precisely so that a rule
 * somebody is halfway through building is safe. Somebody is standing in that
 * state every time they take the last line off before adding the right one, and
 * the interface says which of the two it is rather than leaving them to guess.
 */
function RuleNothing(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Nothing files here yet"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      writing={writing(go, { groups: [] })}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/**
 * "This tag **or** that tag", which is a second rule on the same place.
 *
 * > It should be possible for the user to say "this tag or that tag", as well as
 * > "this and that". Very basic rule system is what we need to have.
 *
 * The two words land in two different places and neither is named after its
 * mechanism, because somebody adding a second tag should not have to know which
 * of the two they just used. **Add a tag** puts another line on a rule and every
 * line has to hold. **Allow something else as well** puts another rule on the
 * place and either of them files a book here.
 *
 * `domain/placement/rules.ts` said where alternation goes in the same sentence
 * that refuses the boolean tree: "two ways of saying a thing are two rules,
 * which a screen can build". This is that screen. There is no group inside a
 * group here and nowhere to put one, and both halves come apart again one at a
 * time: every rule has its own way off, which is what stops an "or" being
 * something somebody can build and cannot undo half of.
 */
function RuleOr(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Comic books and Fiction, or anything tagged Poetry"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      writing={writing(go, {
        groups: [COMICS_LINES, [{ operator: 'is', tag: 'Poetry' }]],
      })}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/**
 * What the change would do, said before it is done.
 *
 * **Nothing has been written at this point.** The rule is still a draft on the
 * screen; what has happened is that the whole catalogue has been run against it
 * and the answer drawn. The moves are pairs of places with counts, because a
 * hundred and one lines is not something anybody reads standing in a room, and
 * every book the rules will not touch is counted with the reason beside it. The
 * pinned ones are always there and are never a silent subtraction: a pin is a
 * person overruling the rules and it beats them forever.
 */
function RuleMoves(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Comic books and Fiction"
      rules={[COOKERY_RULE]}
      beaten={COOKERY_REACHING}
      writing={writing(go)}
      would={{
        moving: [
          { from: '2 · Cookery', to: '2B', books: 16 },
          { from: 'By the window · C', to: '2 · Cookery', books: 9 },
          { from: 'By the window · D', to: '2 · Cookery', books: 4 },
        ],
        carrying: 29,
        staying: 1147,
        unclaimed: 12,
        note: 'Bookcase 2 still files non-fiction onto this area, and it is the wider '
          + 'of the two rules, so this one wins here and that one keeps everything after it.',
      }}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/**
 * Written down, and the books are somebody's to carry.
 *
 * The card at the top now reads as the rule that was just made, because that is
 * what belongs here from this moment. What is added under it is the count of
 * what was written and the one door out of here, which goes to the list this app
 * already keeps: **applying moved nothing.** A book moves when a person picks it
 * up and says so.
 */
function RuleDone(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Comic books and Fiction"
      rules={[{ name: 'Comic books and Fiction', lines: COMICS_LINES, enabled: true }]}
      beaten={COOKERY_REACHING}
      done={{ wrote: 29, carrying: 29 }}
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      order="It takes what overflows from the area before it."
      sample={sampleBy('who')}
    />
  )
}

/*
 * --- Removing an area, which is three different questions ------------------
 *
 * > I think deleting an area, we should show a pop up that explains to them
 * > what's gonna happen with the books, so they can decide whether they wanna
 * > do that or not.
 *
 * **Removing an area is closer to a merge than to a deletion**, and every word
 * in these dialogs is chosen to leave no doubt about that. The books stay on
 * the piece they are on, they fall into whichever area claims them next, and
 * what changes is the label they read under, because a label in this app is
 * worked out from where a thing sits rather than stored. No book leaves the
 * furniture and no book is thrown away. He said "deleting"; the dialog says
 * what happens.
 *
 * ## It does not land on the plan, and the fixture's delete still should
 *
 * The obvious move is consistency: deleting a fixture shows every book and
 * where it goes before anything happens, and an area is the same shape of
 * question one size down. It is not the same question, though, and the
 * difference is exactly what the plan is for. A fixture's books leave the
 * piece: they go to several destinations on other furniture and somebody has
 * to carry them, one armful at a time, which is a list you hold in your hand
 * while walking around a room. Removing an area carries nothing. There is one
 * destination for every book in it, it is named in the first line of the
 * dialog with the count in it, and a plan screen would be that one line again
 * under a heading, with an "Apply it" button for a journey that involves
 * standing up zero times.
 *
 * **What the dialog is careful not to promise is that nothing will ever
 * move.** The merged area orders itself, so some of those books may come up on
 * the list of books to carry afterwards, the same way they would if somebody
 * changed a rule. That is a list this app already has and already draws, and
 * saying so is why the first dialog ends on where those books file from then
 * on rather than on a flat "nothing is carried".
 *
 * **The third state is the exception, and it lands on the plan**, because the
 * only way out of it is deleting the piece, and that is a real carry.
 *
 * ## The three states
 *
 * Every area on every piece falls into one of them, and the third is the one
 * that gets skipped:
 *
 * 1. **Something before it.** Its books join the area before it. The ordinary
 *    case, and `Removing` draws it.
 * 2. **Nothing before it.** The first area on a piece has nothing behind it to
 *    fall into, so the area after it comes forward instead and the whole run
 *    of labels shuffles up. `RemovingFirst` draws it, and the shuffle is drawn
 *    rather than described.
 * 3. **Nothing before or after it.** A piece with one area has nowhere on it
 *    for those books at all, so the dialog does not offer to do it. It says
 *    what the way out is and lands on the plan, which is where deleting a
 *    fixture goes.
 */

/**
 * The ordinary case: an area with something before it.
 *
 * Its 18 books join 2B, which then holds 42. Nothing is carried by the removal
 * itself, and the one thing that reads differently afterwards is drawn rather
 * than claimed: the books that read `2 · Cookery` today read `2B` tomorrow.
 *
 * The second sentence is about the rule and it is not padding. Cookery is an
 * area rule, so it goes when the area goes, and what happens to the books it
 * used to claim is the whole question somebody opened this dialog to answer.
 * It is also the honest end of the sentence "nothing moves": from then on
 * those eighteen file in with the rest of the non-fiction, which is a thing
 * somebody may end up carrying, on the list this app already keeps for that.
 */
function Removing(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Cookery"
      ordered="By the author"
      ends={COOKERY_ENDS.who}
      settled={SETTLED_COOKERY}
      over={
        <Sure
          title="Its 18 books join 2B"
          said={
            <>
              They stay on bookcase 2 where they are, and 2B holds 42 books
              afterwards. The rule that sends Cookery books here goes with the
              area, so from then on they file in with the rest of the
              non-fiction.
            </>
          }
          becomes={[{ from: '2 · Cookery', to: '2B' }]}
          act="Remove the area"
          onAct={() => go('bookcase')}
          onKeep={() => go('area')}
        />
      }
    />
  )
}

/**
 * The first area on a piece, which has nothing before it to join.
 *
 * This is the case the dialog would quietly get wrong. "Its books join the
 * area before it" is the sentence somebody writes once and it is a promise
 * this app cannot keep at the top of every piece of furniture, so the answer
 * is the honest one in the other direction: the area after it comes forward,
 * and every label on the piece shuffles up behind it.
 *
 * Drawn on the five areas of By the window rather than on bookcase 2, because
 * the shuffle is the fact being shown and five unnamed areas shuffle four
 * labels where three areas would shuffle one. Their labels are also the
 * longest in the gallery, which is the case the row has to survive.
 */
function RemovingFirst(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="By the window · A"
      sub="22 books, first on By the window"
      belongs="Fiction starts here"
      ordered="By the author"
      ends={{ first: 'Adichie, Chimamanda Ngozi', last: 'Zweig, Stefan' }}
      settled="Set for the whole library, which By the window and this area both follow."
      over={
        <Sure
          title="Its 22 books join By the window · B"
          said={
            <>
              Nothing comes before A, so its books join the area after it rather
              than the one before. They stay where they are: 46 books in one
              area, still the first on By the window, and fiction still starts
              there.
            </>
          }
          becomes={[
            { from: 'By the window · B', to: 'By the window · A' },
            { from: 'By the window · C', to: 'By the window · B' },
            { from: 'By the window · D', to: 'By the window · C' },
            { from: 'By the window · E', to: 'By the window · D' },
          ]}
          act="Remove the area"
          onAct={() => go('bookcase')}
          onKeep={() => go('area')}
        />
      }
    />
  )
}

/**
 * The only area on a piece, where there is no answer and the dialog says so.
 *
 * A book lives in an area. A piece with one area and no other has nowhere on
 * it for those books, so this is the one state where the dialog refuses rather
 * than warns, and it refuses by offering the thing somebody actually meant:
 * the desk itself can go, and then the books do move, to other furniture, with
 * the plan in front of them first.
 *
 * **This is the desk one step later.** It has two areas on the furniture
 * screen, six books on the left and four on the right; remove the right side
 * and the left holds all ten, which is how a piece gets down to its last area
 * without anybody deciding to make it that way.
 */
function RemovingOnly(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="Desk · Left side"
      sub="10 books, the only area on the desk"
      name="Left side"
      belongs="Nothing sends books here"
      ordered="By the author"
      settled="Set for the whole library, which the desk and this area both follow."
      order="Put here by hand, in whatever order they were put."
      over={
        <Sure
          title="Its 10 books have nowhere else on the desk"
          said={
            <>
              Every book sits in an area, and this is the only one the desk has,
              so there is nothing here for these ten to join. Deleting the desk
              moves them to other furniture instead, and shows you where every
              one goes before anything happens.
            </>
          }
          act="Delete the desk"
          onAct={() => go('plan')}
          onKeep={() => go('area')}
        />
      }
    />
  )
}

function Claimed(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Why it is here" sub="Salt Fat Acid Heat" onBack={() => go('book')} />}
    >
      <Instruction>It is on 2C because of the rule called Cookery.</Instruction>

      <Card kind="Two rules wanted it" title="The one about 2C won">
        <div className="wf-claims">
          <Claim
            name="Cookery"
            about="About 2C"
            won
            why="It asks for a tag this book has, and it is about one area."
            onPress={() => go('area')}
          />
          <Claim
            name="Anything tagged Non-fiction"
            about="About the whole of bookcase 2"
            why="It fits too, but a rule about one area beats a rule about a whole fixture."
            onPress={() => go('area')}
          />
        </div>
      </Card>

      <Card kind="What the book carries" title="Two tags">
        <Tags>
          <Tag>Non-fiction</Tag>
          <Tag>Cookery</Tag>
        </Tags>
        <p>Both rules asked about a tag this book has, which is why both wanted it.</p>
      </Card>

      <Card weight="quiet" kind="If that is wrong" title="Two ways to settle it">
        <p>
          Change the rule so it stops asking for this book, or pin the book
          where it is. A pinned book is left alone by every rule, for good.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button tone="secondary" onPress={() => go('area')}>
            Open the rule
          </Button>
          <Button tone="quiet" onPress={() => go('book')}>
            Pin it here
          </Button>
        </div>
      </Card>
    </Phone>
  )
}

/**
 * The same screen for a book no rule claims, which until now offered nothing.
 *
 * **The screen said the true thing and then stopped**, which #341 named: it
 * explains an unclaimed book and offers it no action at all, on the one screen
 * somebody arrives at while holding the book and wondering. Every other state
 * here has a way out. This one now has two, and they are the two the model
 * actually has: say something about the book, or ask for the tag it already
 * carries.
 *
 * **It draws the second of the two unclaimed states on purpose.** A book with no
 * tag at all is the state #304 made real and it is drawn twice already, on the
 * list and on the screen that settles one. A book carrying a tag no rule asks
 * for is the other one, it is the one nothing has ever drawn, and it is where
 * the second way out is the better answer: the household reads crime novels, so
 * the honest fix may well be a rule about Crime rather than nine books being
 * told they are also Fiction.
 *
 * **Nothing here writes a tag by itself**, which is the thing #304 stopped doing
 * on the owner's instruction. Both buttons open a screen where a person says
 * something; neither of them settles anything on the way past.
 */
function ClaimedNone(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Why it is here" sub="The Big Sleep" onBack={() => go('book')} />}
    >
      <Instruction>No rule asks for this book, so nothing files it.</Instruction>

      <Said>
        It is on 1C because somebody put it there, and no plan will ever move it.
      </Said>

      {/* No list of rules, because there is nothing to list: not one of them
          asked for this book. A card drawing an empty list would look like the
          screen was still loading, which is the failure the whole state exists
          to avoid. */}
      {/* The title says the part the sentence above does not. It read "Nothing
          asked for this book", which is the instruction again in smaller type,
          and the thing worth knowing was buried in the body. Found by looking at
          the two of them one under the other. */}
      <Card kind="Not one rule wanted it" title="Every rule asks about a tag">
        <p>
          None of yours asks about the one this book carries, so there was
          nothing for any of them to match.
        </p>
      </Card>

      <Card kind="What the book carries" title="One tag">
        <Tags>
          <Tag>Crime</Tag>
        </Tags>
        <p>Somebody put it under Crime, and no rule mentions Crime.</p>
      </Card>

      <Card weight="sunk" kind="Where it is" title="1C">
        <p>That is where somebody last said it stands.</p>
      </Card>

      {/* Two buttons in the body in one wrapping row, which is exactly what the
          claimed screen does with its two, rather than one in the body and one
          in the foot. That split was drawn first and read as two unrelated
          offers with a rule about it in between. */}
      <Card
        weight="quiet"
        kind="Two ways to settle it"
        title="Say more about it, or ask for Crime"
      >
        <p>
          Say what else this book is and the rule that asks for that will take
          it. Or write a rule that asks for Crime, and every book like this one
          gets a home at once.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button tone="primary" onPress={() => go('saying')}>
            Say what it is
          </Button>
          <Button tone="secondary" onPress={() => go('area')}>
            Write a rule for Crime
          </Button>
        </div>
      </Card>
    </Phone>
  )
}

/* --- Putting things right ------------------------------------------------ */

/*
 * --- Carrying fifty-three books -------------------------------------------
 *
 * The flow #291 is for, and the six questions it makes the design answer.
 * Every one of them is settled here rather than drawn around, and the answers
 * are the reason the screens look the way they do.
 *
 * ## 1. What order somebody works in
 *
 * **Grouped by where the books come off, biggest piece of furniture first,
 * sweeping each piece from its first area to its last.**
 *
 * The two candidates cost the same number of walks, so the walks are not what
 * decides it. What decides it is that the two ends of a carry are not
 * symmetrical: taking a book off means finding it among the ones that are
 * staying, which is reading spines, and putting it down does not. A list
 * grouped by where books are going makes you read one area three times, once
 * per destination it feeds. Grouped by where they come off, you read it once.
 *
 * The second asymmetry is your hands. Grouped by where books come off, what
 * you are holding is always "everything I took off 4A", which is one sentence
 * a person can keep in their head while walking. Grouped the other way it is a
 * merge.
 *
 * Biggest first, rather than by label, because emptying a piece completely is
 * the win: three books off a bookcase across the room is not what anybody does
 * before clearing the one that has fifty on it. Within a piece the order is the
 * order the areas stand in, which is the closest thing to a path.
 *
 * ## 2. A book in your hand
 *
 * **The model says nothing, on purpose, and nothing here writes a row until a
 * book is down.** The last thing recorded is still true: it is the last place a
 * person put the book. Recording "in your hand" would be the app asserting
 * something nobody told it, and it would still be asserting it three weeks
 * later, which is worse than a record that says where to go and look.
 *
 * So there is no "I have picked it up" step to be got wrong, nothing to unwind
 * if the phone locks, and the whole of what the interface says about the gap is
 * the line under the board naming the book being carried. The way out of an
 * armful is on the screen and it is honest: put them back where they came from,
 * which writes nothing because nothing was written.
 *
 * ## 3. The plan going stale
 *
 * **There is no plan to go stale.** `domain/placement/plan.ts` writes nothing
 * and there is no plan table; the work is the disagreement between what the
 * rules want and where somebody last put the book, so it is recomputed every
 * time this list is drawn.
 *
 * One rule on top of that, and it is the one that matters while somebody is
 * walking: **the screen naming an area for the book in your hand is never
 * re-answered underneath you.** It changes when you come back to the list, and
 * the list says what changed. Saying an area is full is the case where a person
 * changes it themselves, and it gets a screen of its own.
 *
 * ## 4. Stopping halfway
 *
 * Falls out of 2 and 3. Nothing is stored per session, so there is nothing to
 * resume: the list is what is left, and every book carried takes itself off it.
 * What the design owes is that coming back does not read as starting again, so
 * the resumed list leads with what was already carried and puts the area you
 * were part-way through at the top.
 *
 * ## 5. The answer changing while they were away
 *
 * Two different things and the second is the one that stings. Books that no
 * longer need moving simply leave, and a count is enough. Books somebody
 * **already carried** that need carrying again cannot be left to be discovered
 * one at a time, so they are named.
 *
 * ## 6. The same screen as initial shelving
 *
 * `Placing`, called by both. See its header.
 */

/**
 * The whole of the outstanding work, as the trips it is made of.
 *
 * Fifty-three books, which is the size this has to survive rather than a size
 * chosen to draw well. Five rows, because the unit is a trip.
 */
function Carry(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar title="Books to carry" sub="53 books, five trips" onBack={() => go('home')} />
      }
    >
      {/* No card explaining the list. Each row names both ends and the count,
          which is the whole of what a sentence over it could have said. */}
      <Trips label="Books to carry">
        <Trip from="4A" to="3A" count={8} note="Bryson to Didion" onPress={() => go('trip')} />
        <Trip from="4B" to="3B" count={20} note="Dyson to Macfarlane" onPress={() => go('trip')} />
        <Trip from="4C" to="3C" count={22} note="Mantel to Winchester" onPress={() => go('trip')} />
        <Trip from="1C" to="1D" count={2} note="Tartt and Tolkien" onPress={() => go('trip')} />
        <Trip from="1D" to="1E" count={1} note="Zusak" onPress={() => go('trip')} />
      </Trips>

      <Button tone="primary" block onPress={() => go('trip')}>
        Start at 4A
      </Button>

      {/* Not doing it is an answer, and it belongs on this screen (#402).
          Quiet, and under the one that carries on with the work, because it is
          what somebody says when the work is not going to happen. It asks
          before it does anything: one press deciding about fifty-three books is
          a press whose size is not visible from the button. */}
      <Button tone="quiet" block onPress={() => go('carryleft')}>
        Leave them where they are
      </Button>

      {/* The plan said what it would not touch and so does the work list, in
          the same words and the same order. A list of fifty-three that had
          quietly dropped three pinned books would be believed. */}
      <Card weight="quiet" kind="Not on this list" title="Six books">
        <p>
          Three you pinned. Two checked out. One never confirmed onto a
          bookcase.
        </p>
      </Card>
    </Phone>
  )
}

/**
 * The list somebody decided against, which is the state #402 was filed from.
 *
 * The owner applied a plan, ended with forty-six books the app wanted him to
 * walk across a room, and had no way to say he was not going to. Every exit was
 * to carry them or to look at the list.
 *
 * **Two things this screen must get right and neither is obvious.**
 *
 * It does not say "every book is where the rules want it", which is what the
 * empty list says when the rules agree. They do not agree: a person answered
 * them, and claiming otherwise is a lie about whose decision emptied the list.
 *
 * And it does not forget. The rule that wanted those books is still on that
 * place and only he can decide whether to change it, so what was left, where
 * the rules wanted it and which rule asked all stay on the screen, with the way
 * to put the work back under them. Silently forgetting a decision is the same
 * failure as silently reversing one.
 */
function CarryLeft(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Books to carry" sub="Nothing to carry" onBack={() => go('home')} />}
    >
      <Nothing said="Nothing is waiting to be carried.">
        <p>Nothing to fetch, nothing to put back.</p>
      </Nothing>

      <Card weight="quiet" kind="Left where they are" title="Fifty-three books">
        <p>Twenty-two on 4C the rules want on 3C, asked for by Non-fiction.</p>
        <p>Twenty on 4B the rules want on 3B, asked for by Non-fiction.</p>
        <p>Eight on 4A the rules want on 3A, asked for by Non-fiction.</p>
        <p>Three on 1C the rules want on 1D, asked for by Fiction.</p>
      </Card>

      <Button tone="quiet" block onPress={() => go('carry')}>
        Put them back on the list
      </Button>
    </Phone>
  )
}

/**
 * One trip, read at the area the books come off.
 *
 * The eight to take are ringed on the board and named underneath, because at
 * this moment a person is looking at eleven spines and needs to know which
 * eight. The three staying are drawn and not hidden: they are the pinned books,
 * and a screen that showed only the eight would have somebody counting to
 * eleven and wondering.
 *
 * **Pressing the button writes nothing.** It is the only step in this flow that
 * does not, and it is a navigation rather than a record: the books are not
 * anywhere yet.
 */
function Trip4A(go: Go) {
  /*
   * The eight are one block and the three pinned ones follow them, which is a
   * decision made by looking rather than a fact about pinning.
   *
   * The first pass scattered them, and eight rings among eleven spines is one
   * ragged outline round nearly the whole board: you cannot see which three are
   * staying, which is the only thing the drawing has to answer. The ring was
   * designed for one book and it does not survive being asked to mean eight.
   * As one block it reads as "everything up to here", and the three plain
   * spines after it are what the card underneath is about.
   */
  const row: ShelfItem[] = spines(
    [
      'Bryson, Bill',
      'Carson, Rachel',
      'Chatwin, Bruce',
      'Darwin, Charles',
      'Davis, Wade',
      'Deakin, Roger',
      'Diamond, Jared',
      'Didion, Joan',
      'Dillard, Annie',
      'Doidge, Norman',
      'Dunbar, Robin',
    ],
    2,
  ).map((item, i) => (item.kind === 'spine' && i < 8 ? { ...item, here: true } : item))

  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="4A" sub="8 of the 11 books here go to 3A" onBack={() => go('carry')} />}
    >
      <Instruction>Take these eight off 4A.</Instruction>

      <div className="wf-bleed">
        <Shelf label="4A" note="11 books, eight ringed" items={row} />
      </div>

      <List label="The eight to take">
        <Row title="A Short History of Nearly Everything" sub="Bryson, Bill" cloth="sun" onPress={() => go('carrying')} />
        <Row title="Silent Spring" sub="Carson, Rachel" cloth="moss" onPress={() => go('carrying')} />
        <Row title="The Songlines" sub="Chatwin, Bruce" cloth="wood" onPress={() => go('carrying')} />
        <Row title="The Voyage of the Beagle" sub="Darwin, Charles" cloth="sky" onPress={() => go('carrying')} />
        <Row title="The Wayfinders" sub="Davis, Wade" cloth="plum" onPress={() => go('carrying')} />
        <Row title="Wildwood" sub="Deakin, Roger" cloth="wood2" onPress={() => go('carrying')} />
        <Row title="Collapse" sub="Diamond, Jared" cloth="sun" onPress={() => go('carrying')} />
        <Row title="The White Album" sub="Didion, Joan" cloth="moss" onPress={() => go('carrying')} />
      </List>

      <Card weight="quiet" kind="Staying on 4A" title="Three books you pinned" />

      <Button tone="primary" block onPress={() => go('carrying')}>
        I have all eight
      </Button>
      <Button tone="quiet" block onPress={() => go('carry')}>
        Do a different one
      </Button>
    </Phone>
  )
}

/**
 * Where one carried book goes, which is the screen a new book gets.
 *
 * The only two things this adds to it: the top bar counts down the armful, so
 * somebody knows whether they are nearly done without going back; and there is
 * a way out that is not a lie. Backing out of an armful puts the books back on
 * the area they came off, and that records nothing, because nothing had been
 * recorded.
 */
function Carrying(go: Go) {
  const row: ShelfItem[] = [
    ...spines(
      [
        'Bryson, Bill',
        'Carson, Rachel',
        'Chatwin, Bruce',
        'Darwin, Charles',
        'Davis, Wade',
        'Deakin, Roger',
      ],
      2,
    ),
    { kind: 'gap' },
    ...spines(['Didion, Joan'], 1),
    { kind: 'bookend' },
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Where it goes"
          sub="Last of eight in your hands"
          onBack={() => go('trip')}
        />
      }
    >
      <Placing
        between={
          <>
            Between <em>Wildwood</em> and <em>The White Album</em>.
          </>
        }
        area="3A"
        note="7 books, and the gap"
        items={row}
        inHand="Collapse"
        onFits={() => go('carried')}
        onFull={() => go('carryfull')}
      />

      {/* Nothing has been written for any of the eight that are not down yet,
          so this really is free. It is the reason there is no "I picked it up"
          step: there is nothing to unsay. */}
      <Button tone="quiet" block onPress={() => go('carry')}>
        Put them back on 4A
      </Button>
    </Phone>
  )
}

/**
 * Saying an area is full, which is the one place the answer changes while
 * somebody is standing there.
 *
 * `docs/shelving.md` settles what happens: the gap is in the middle of 3A, so
 * something has to come off the end of it to open one, and that is 3A's last
 * book. It goes to 3B. **The armful gets bigger**, which is the surprising part
 * and is why it gets a screen rather than a line.
 *
 * Nothing here is a second cascade. It is the one in the specification, drawn,
 * and it asks one question at a time exactly as that document says: 3B may not
 * take it either, and the answer to that is this screen again.
 */
function CarryFull(go: Go) {
  const row: ShelfItem[] = [
    ...spines(
      [
        'Bryson, Bill',
        'Carson, Rachel',
        'Chatwin, Bruce',
        'Darwin, Charles',
        'Davis, Wade',
        'Deakin, Roger',
      ],
      2,
    ),
    { kind: 'gap' },
    { kind: 'spine', text: 'Didion, Joan', cloth: 'plum', pages: 240, here: true },
    { kind: 'bookend' },
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="3A is full"
          sub="Last of eight in your hands"
          onBack={() => go('carrying')}
        />
      }
    >
      <Instruction>
        Take <em>The White Album</em> off the end of 3A.
      </Instruction>

      <div className="wf-bleed">
        <Shelf label="3A" note="7 books, and the gap" items={row} inHand="Collapse" />
      </div>

      <Said>It goes on 3B, which you are going to next anyway.</Said>

      <Card weight="quiet" kind="Added to your list just now" title="One book, 3A to 3B" />

      <Card
        weight="sunk"
        foot={
          <>
            <Button tone="primary" onPress={() => go('carried')}>
              Done, carry on
            </Button>
            <Button tone="secondary" onPress={() => go('carryfull')}>
              3B is full too
            </Button>
          </>
        }
      />
    </Phone>
  )
}

/**
 * The end of one trip, which is the same shape as the end of shelving a book.
 *
 * The way on is the next trip by name, because the person is holding nothing
 * and standing next to the area they just filled. The way out says what it
 * means: there is no session to close, so stopping is stopping.
 */
function Carried(go: Go) {
  const row: ShelfItem[] = [
    ...spines(
      [
        'Bryson, Bill',
        'Carson, Rachel',
        'Chatwin, Bruce',
        'Darwin, Charles',
        'Davis, Wade',
        'Deakin, Roger',
        'Diamond, Jared',
        'Didion, Joan',
      ],
      2,
    ),
    { kind: 'bookend' },
  ]

  return (
    <Phone tab="library" go={go} top={<TopBar title="Carried" />}>
      <Confirmation said="Eight books are on 3A." />

      <div className="wf-bleed">
        <Shelf label="3A" note="8 books" items={row} />
      </div>

      <Button tone="primary" block onPress={() => go('trip')}>
        Next: twenty books off 4B
      </Button>
      <Button tone="quiet" block onPress={() => go('home')}>
        That is enough for today
      </Button>

      <Card weight="quiet" kind="Still to carry" title="Forty-five books, four trips" />
    </Phone>
  )
}

/**
 * One book, where the list would be a list of one.
 *
 * The grouping earns nothing here and a screen listing a single trip so it can
 * be tapped is a tap for nothing, so the list is skipped and the area the book
 * comes off is drawn instead. Same journey, two screens shorter.
 */
function CarryOne(go: Go) {
  const row: ShelfItem[] = spines(
    ['Smith, Zadie', 'Tartt, Donna', 'Tolkien, J. R. R.', 'Woolf, Virginia', 'Zusak, Markus'],
    3,
  ).map((item, i) => (item.kind === 'spine' && i === 4 ? { ...item, here: true } : item))

  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="One book to carry" onBack={() => go('home')} />}
    >
      <Instruction>
        Take <em>The Book Thief</em> off 1D.
      </Instruction>

      <div className="wf-bleed">
        <Shelf label="1D" note="5 books, one ringed" items={row} />
      </div>

      <Said>It goes on 1E.</Said>

      <Button tone="primary" block onPress={() => go('carrying')}>
        I have it
      </Button>

      <Card weight="quiet" kind="Not on this list" title="Two books are checked out" />
    </Phone>
  )
}

/** Nothing to carry, which is the state this whole flow is trying to reach. */
function CarryNone(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Books to carry" sub="Nothing to carry" onBack={() => go('home')} />}
    >
      <Nothing said="Every book is where the rules want it.">
        <p>Nothing to fetch, nothing to put back.</p>
      </Nothing>

      <Button tone="quiet" block onPress={() => go('furniture')}>
        See your fixtures
      </Button>
    </Phone>
  )
}

/**
 * The list picked up again on Sunday, which is the normal case and not the
 * exception.
 *
 * Three things make it read as carrying on rather than as starting: what was
 * already carried is said first, the area that was left part done is at the top
 * with how much of it is left, and the button says carry on rather than start.
 *
 * **4B appears twice**, and that is the one drawing on these screens that could
 * not have been invented at a desk. Saying 3B was full pushed books onward, so
 * two of 4B's remaining thirteen now belong on 3C. One area feeding two is
 * exactly the case the grouping decision is about, and here the two sit
 * together, which is the whole benefit: you read 4B once.
 */
function CarryPart(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar title="Books to carry" sub="38 books, five trips" onBack={() => go('home')} />
      }
    >
      <Card weight="sunk">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Cat pose="sitting" size={52} />
          <p style={{ margin: 0, fontFamily: 'var(--face-book)', fontSize: 17 }}>
            You carried fifteen on Sunday.
          </p>
        </div>
      </Card>

      <Trips label="Books to carry">
        <Trip from="4B" to="3B" count={11} note="Seven of the eighteen are on 3B already" onPress={() => go('trip')} />
        <Trip from="4B" to="3C" count={2} note="3B filled up" onPress={() => go('trip')} />
        <Trip from="4C" to="3C" count={22} note="Mantel to Winchester" onPress={() => go('trip')} />
        <Trip from="1C" to="1D" count={2} note="Tartt and Tolkien" onPress={() => go('trip')} />
        <Trip from="1D" to="1E" count={1} note="Zusak" onPress={() => go('trip')} />
      </Trips>

      <Button tone="primary" block onPress={() => go('trip')}>
        Carry on at 4B
      </Button>

      <Button tone="quiet" block onPress={() => go('carrystale')}>
        What changed while you were away
      </Button>
    </Phone>
  )
}

/**
 * What a rule change did to a list somebody was halfway through.
 *
 * The counts are the easy half and they lead, because the first question is
 * whether the job got bigger. The third card is the one this screen exists
 * for: books that were carried and have to be carried again. Nobody may find
 * that out one book at a time, standing at a shelf, so they are named here with
 * both ends of the new carry on them.
 *
 * There is nothing to accept or dismiss. The list already changed the moment
 * the rule did; this says what happened, and the way on is the work.
 */
function CarryStale(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="What changed"
          sub="You changed what belongs on bookcase 2"
          onBack={() => go('carrypart')}
        />
      }
    >
      <Instruction>Your list went from 38 books to 47.</Instruction>

      <Card kind="Off the list" title="Eleven books no longer move">
        <p>They were going to 2A. The rule now wants them where they already are.</p>
      </Card>

      {/* One card, not two. "Twenty books joined" and "three of the twenty"
          were separate and the second read as a fourth thing that had happened
          rather than as part of the third. The three are the whole reason this
          screen exists, so they sit inside the count they belong to. Found by
          looking at it. */}
      <Card kind="On the list" title="Twenty books joined">
        <p>Three of them you carried on Sunday.</p>
        <List label="Books to carry again">
          <Row title="Salt Fat Acid Heat" sub="Nosrat, Samin" cloth="sun" meta="3B to 2A" onPress={() => go('carrying')} />
          <Row title="On Food and Cooking" sub="McGee, Harold" cloth="sky" meta="3B to 2A" onPress={() => go('carrying')} />
          <Row title="Good Things" sub="Grigson, Jane" cloth="plum" meta="3B to 2A" onPress={() => go('carrying')} />
        </List>
      </Card>

      <Button tone="primary" block onPress={() => go('carry')}>
        Show me what is left
      </Button>
      <Button tone="quiet" block onPress={() => go('area')}>
        Open the rule again
      </Button>
    </Phone>
  )
}

/**
 * This screen was called "Move a run", and that is the word the owner named.
 * It is now what the person is actually doing: moving all the non-fiction to
 * another bookcase.
 */
function Move(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Move non-fiction" onBack={() => go('library')} />}
    >
      <Card kind="Where it lives now" title="Bookcase 4">
        <p>Three areas: 4A with 8 books, 4B with 20, 4C with 22.</p>
      </Card>

      <div>
        <span className="wf-field__label">Move it to bookcase</span>
        <div style={{ height: 4 }} />
        <Segmented
          label="Which bookcase"
          on="3"
          options={[
            { value: '1', word: '1' },
            { value: '2', word: '2' },
            { value: '3', word: '3' },
            { value: '5', word: '5' },
          ]}
        />
      </div>

      <Button tone="primary" block onPress={() => go('plan')}>
        Show me the plan
      </Button>
    </Phone>
  )
}

function Plan(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="The plan" sub="50 books to carry" onBack={() => go('move')} />}
    >
      {/* Filled labels, not outlined ones. They were quiet here and solid on
          the screen after this, which is the same two areas said twice in two
          voices on two screens somebody walks straight between. Found by
          looking at them one after the other. */}
      <Card kind="What would happen" title="Bookcase 4 to bookcase 3">
        <div className="wf-steps">
          <div className="wf-step">
            <span className="wf-step__n">1</span>
            <span>
              <Place>4A</Place> to <Place>3A</Place> &mdash; 8 books
            </span>
          </div>
          <div className="wf-step">
            <span className="wf-step__n">2</span>
            <span>
              <Place>4B</Place> to <Place>3B</Place> &mdash; 20 books
            </span>
          </div>
          <div className="wf-step">
            <span className="wf-step__n">3</span>
            <span>
              <Place>4C</Place> to <Place>3C</Place> &mdash; 22 books
            </span>
          </div>
        </div>
      </Card>

      <Card kind="Left alone" title="Six books">
        <p>
          Three you asked to stay put. Two checked out. One never confirmed onto
          a bookcase.
        </p>
      </Card>

      {/* What is already outstanding, because applying does not start a job of
          its own: these fifty join a list that already has three on it, and the
          screen after this one says fifty-three. A plan that reported its own
          fifty and then handed over a list of a different number would look
          like an arithmetic bug. */}
      <Card weight="quiet" kind="Already waiting" title="Three books are on your carry list" />

      <Button tone="primary" block onPress={() => go('carry')}>
        Apply it
      </Button>
      <Button tone="quiet" block onPress={() => go('move')}>
        Not yet
      </Button>
    </Phone>
  )
}

function Empty(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Queue" sub="Nothing on the table" action={you(go)} />}
    >
      <Nothing said="Even the cat couldn't find anything to knock off the table." />
      <Button tone="primary" block onPress={() => go('camera')}>
        Open the camera
      </Button>
    </Phone>
  )
}

/*
 * --- The books nothing files ----------------------------------------------
 *
 * #341, and the three questions it makes the design answer.
 *
 * ## 1. Which of the two unclaimed states this is about
 *
 * **Both, and they are drawn as two blocks rather than one list**, because they
 * are two states with two explanations and, more importantly, two different
 * ways out.
 *
 * A book carrying **no tag at all** is the state #304 made real: no catalogue
 * stated a genre, so nothing was written down. The only way out is a person
 * saying what it is, because nobody knows anything yet.
 *
 * A book carrying **a tag no rule asks for** is a different thing that lands in
 * the same place. Somebody already said something about it; what is missing is a
 * rule. Telling nine crime novels they are also Fiction is the wrong repair when
 * the household reads crime and the real answer is one rule about Crime.
 *
 * One list with twelve identical rows would have hidden that, and the screen
 * would have offered one remedy for two problems.
 *
 * ## 2. What settling one of them is allowed to be
 *
 * **A person saying so, and nothing else.** The app writes a genre tag only when
 * a catalogue states one, which is #304 and was the owner's explicit
 * instruction, so there is no button here that guesses, no "file them all as
 * non-fiction", and no default answer preselected on the screen that asks.
 *
 * ## 3. What saying so does to the book
 *
 * **It does not move it.** Only a person moving a book changes where a book is,
 * and this list is drawn beside a carry flow that exists because of exactly that
 * invariant. So saying what a book is puts it on the carry list when the rule
 * that takes it wants it elsewhere, and the screen says so rather than implying
 * the book has been dealt with.
 */

/**
 * Everything no rule claims, in the two states it comes in.
 *
 * Twelve, which is what this looks like on a collection of 1,204 where one
 * catalogue is consulted (#305). Both blocks are drawn out in full rather than
 * summarised: the whole complaint in #341 is that these books are mentioned
 * least, and a screen that showed three of them and a count would be repeating
 * the fault at a smaller size.
 */
function Unclaimed(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar title="Nothing files these" sub="Twelve books" onBack={() => go('home')} />
      }
    >
      <Instruction>
        No rule asks for these twelve, so nothing will ever move them.
      </Instruction>

      {/* Where each one stands, because the job starts with walking to it.

          The way on hangs off this card rather than off the foot of the screen,
          which is where it was until it was looked at: twelve rows put a primary
          button fourteen hundred pixels below the sentence explaining it, and
          the two blocks do not have one way out between them anyway. Each block
          now carries its own, which is the point of their being two. */}
      <Card
        kind="Nobody has said what they are"
        title="Nine books"
        foot={
          <Button tone="primary" block onPress={() => go('saying')}>
            Say what the first one is
          </Button>
        }
      >
        <p>
          No catalogue named a subject for these, so nothing was written down and
          there is nothing for a rule to ask about.
        </p>
        <List label="Books nobody has said anything about">
          <Row title="The Peregrine" sub="Baker, J. A." cloth="moss" place="4A" onPress={() => go('saying')} />
          <Row title="The Living Mountain" sub="Shepherd, Nan" cloth="wood" place="1B" onPress={() => go('saying')} />
          <Row title="Wildwood" sub="Deakin, Roger" cloth="sky" place="1B" onPress={() => go('saying')} />
          <Row title="Waterlog" sub="Deakin, Roger" cloth="plum" place="1B" onPress={() => go('saying')} />
          <Row title="Arctic Dreams" sub="Lopez, Barry" cloth="sun" place="4A" onPress={() => go('saying')} />
          <Row title="Nature Cure" sub="Mabey, Richard" cloth="wood2" place="4B" onPress={() => go('saying')} />
          <Row title="The Rings of Saturn" sub="Sebald, W. G." cloth="moss" place="1E" onPress={() => go('saying')} />
          <Row title="Findings" sub="Jamie, Kathleen" cloth="sky" place="4B" onPress={() => go('saying')} />
          <Row title="Pilgrim at Tinker Creek" sub="Dillard, Annie" cloth="plum" place="4A" onPress={() => go('saying')} />
        </List>
      </Card>

      {/* The tag rather than the place on these rows, and it is the one
          difference between the two lists. What a person is deciding here is
          whether Crime should have a rule, and that question is about the tag;
          where the book happens to be standing does not help them answer it. */}
      <Card kind="Nothing asks for what they carry" title="Three books">
        <p>
          Somebody already said something about these. What is missing is a rule
          that asks for it, and one rule can take several at once. Open one to
          see what it carries.
        </p>
        <List label="Books carrying a tag no rule asks for">
          <Row title="The Big Sleep" sub="Chandler, Raymond" cloth="sun" meta="Crime" onPress={() => go('claimednone')} />
          <Row title="The Long Goodbye" sub="Chandler, Raymond" cloth="wood" meta="Crime" onPress={() => go('claimednone')} />
          <Row title="Gaudy Night" sub="Sayers, Dorothy L." cloth="moss" meta="Crime" onPress={() => go('claimednone')} />
        </List>
      </Card>

      {/* Said once, here, rather than on the screen that asks: somebody who
          settles nine books in a row should meet this sentence at the start and
          not nine times. */}
      <Card weight="quiet" kind="What it does not do" title="Nothing here moves a book">
        <p>
          Saying what a book is only gives a rule something to ask for. If that
          rule wants it somewhere else, it joins your carry list.
        </p>
      </Card>
    </Phone>
  )
}

/**
 * Somebody saying what one book is, which is the only way out of this state.
 *
 * **What is offered is the tags your own rules ask for**, and that is the whole
 * design decision on this screen. A list of every tag in the collection would
 * offer twenty-three answers, eighteen of which change nothing, and the person
 * would learn that afterwards by the book not moving. Each answer says where the
 * book would go, so choosing is choosing a place as well as a word.
 *
 * **Nothing is chosen when it opens.** A preselected answer is the app guessing,
 * quietly, in the one place where the whole point is that it does not.
 */
function Saying(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Say what it is" sub="The Peregrine" onBack={() => go('unclaimed')} />}
    >
      <Instruction>Nothing knows what this book is, so no rule can ask for it.</Instruction>

      {/* Everything the catalogue does hold, because the question cannot be
          answered off a title in a bar. Added after looking at this screen: it
          asked somebody what a book is about and showed them nothing to go on. */}
      <Card weight="sunk" kind="All anybody knows about it" title="The Peregrine">
        <p>Baker, J. A. &middot; Collins, 1967 &middot; 191 pages</p>
      </Card>

      <Choice
        label="What this book is"
        on="nothing"
        options={[
          { value: 'fiction', word: 'Fiction', sub: 'Goes to the bookcase by the window' },
          { value: 'nonfiction', word: 'Non-fiction', sub: 'Goes to bookcase 2' },
          { value: 'cookery', word: 'Cookery', sub: 'Goes to 2 · Cookery' },
          { value: 'poetry', word: 'Poetry', sub: 'Goes to the landing' },
        ]}
      />

      {/* Drawn and not pressable, which no other gallery screen does, and the
          sentence under it is the reason `Button` asks for one. Nothing is
          chosen when this opens and nothing will choose itself: this is the
          screen where #304's instruction is either kept or quietly broken by a
          helpful default, and a default is what somebody adds to make the button
          work. */}
      <Button tone="primary" block off>
        Save and show the next one
      </Button>

      <Said>
        Nothing is chosen. No catalogue said, and this app does not guess.
      </Said>

      <Button tone="quiet" block onPress={() => go('tags')}>
        It is something else
      </Button>

      <Button tone="quiet" block onPress={() => go('unclaimed')}>
        Leave it for now
      </Button>

      <Card weight="quiet" kind="Why only these four" title="These are what your rules ask for">
        <p>
          Anything else is yours to keep and files nothing, until you write a rule
          that asks for it.
        </p>
      </Card>
    </Phone>
  )
}

/** Nothing unfiled, which is the state a collection with enough rules lives in. */
function UnclaimedNone(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Nothing files these"
          sub="Every book is claimed"
          onBack={() => go('home')}
        />
      }
    >
      <Nothing said="Every book has a rule that wants it.">
        <p>Nothing is waiting for you to say what it is.</p>
      </Nothing>

      <Button tone="quiet" block onPress={() => go('furniture')}>
        See your fixtures
      </Button>
    </Phone>
  )
}

export const SCREENS: Screen[] = [
  { id: 'home', name: 'Today', group: 'Every day', render: Home },
  /* Short names. The viewer's own bar gives a name about twenty-four
     characters before it truncates, and three of these were being cut off in
     the middle of the word that told them apart. */
  /* The two days Today has bad news on it. Drawn beside the ordinary one and
     not instead of it: an alarm that is on the drawing every day is an alarm
     nobody would design around, and the ordinary day is what this screen is
     for. */
  { id: 'unbacked', name: 'Nothing backed up', group: 'Every day', render: Unbacked },
  { id: 'nodisk', name: 'Backups unreadable', group: 'Every day', render: NoDisk },
  /* And the day before there is anything at all, which is what five counts
     make of a collection nobody has photographed a book into yet. */
  { id: 'firstday', name: 'The first evening', group: 'Every day', render: FirstDay },
  { id: 'library', name: 'Library', group: 'Every day', render: Library },
  { id: 'covers', name: 'Covers, and two tags', group: 'Every day', render: CoverView },
  { id: 'listing', name: 'A list of books', group: 'Every day', render: ListView },
  { id: 'book', name: 'A book', group: 'Every day', render: Book },
  {
    id: 'thin',
    name: 'A book we know little about',
    group: 'Every day',
    render: Thin,
  },
  {
    id: 'lone',
    name: 'A book whose author has nothing else here',
    group: 'Every day',
    render: Lone,
  },
  { id: 'find', name: 'Find, before you type', group: 'Finding a book', render: Find },
  { id: 'finding', name: 'Typing a name', group: 'Finding a book', render: Finding },
  { id: 'findisbn', name: 'Typing an ISBN', group: 'Finding a book', render: FindIsbn },
  { id: 'findtag', name: 'Typing a tag', group: 'Finding a book', render: FindTag },
  { id: 'findnone', name: 'Nothing matches', group: 'Finding a book', render: FindNone },
  { id: 'tags', name: 'All twenty-three tags', group: 'Finding a book', render: TagsScreen },
  /* Filed here rather than under Cataloguing, and that is the whole point of
     it: this is the camera you point at a book you already own, so it belongs
     with finding one. The camera under the next heading is the other one. */
  {
    id: 'inhand',
    name: 'The book in your hand',
    group: 'Finding a book',
    render: InHandCamera,
  },
  { id: 'spine', name: 'Framing the spine', group: 'Cataloguing', render: SpineShot },
  { id: 'camera', name: 'The camera', group: 'Cataloguing', render: Camera },
  { id: 'review', name: 'Check the details', group: 'Cataloguing', render: Review },
  /* Beside it, because the top of that screen has two answers and both are
     ordinary: a book a catalogue holds a cover for, and a book nothing
     answered for at all. */
  {
    id: 'reviewnone',
    name: 'Nothing came back',
    group: 'Cataloguing',
    render: ReviewNone,
  },
  /* Naming a tag, in the three states that are not each other: the collection
     already keeps something reading like it, the collection keeps nothing like
     it, and the near miss. The third is the one worth walking, because it is
     the only place the app says no. */
  { id: 'naming', name: 'Adding a tag', group: 'Cataloguing', render: NamingFound },
  { id: 'namingnew', name: 'A tag you have not got', group: 'Cataloguing', render: NamingNew },
  {
    id: 'namingsame',
    name: 'Nearly one you have',
    group: 'Cataloguing',
    render: NamingSame,
  },
  { id: 'where', name: 'Where it goes', group: 'Cataloguing', render: WhereItGoes },
  { id: 'done', name: 'Shelved', group: 'Cataloguing', render: Done },
  { id: 'queue', name: 'The queue', group: 'Cataloguing', render: Queue },
  /* The three states of it that are not the middle one. Forty is what a bigger
     book costs, four kinds of stuck is #148 drawn, and an empty one is the day
     there is nothing to do. */
  { id: 'queuemany', name: 'A queue of forty', group: 'Cataloguing', render: QueueMany },
  { id: 'queuestuck', name: 'Four kinds of stuck', group: 'Cataloguing', render: QueueStuck },
  { id: 'empty', name: 'An empty queue', group: 'Cataloguing', render: Empty },
  /* The corner and what it opens, in front of the furniture rather than beside
     it: this pair is the way in, and the four screens under the next heading
     are what it was a way in to. */
  { id: 'menu', name: 'The corner opened', group: 'The corner', render: RoomMenu },
  { id: 'settings', name: 'Settings', group: 'The corner', render: SettingsScreen },
  /* The ids are the URLs and they stay put. The names are read, so they take
     the neutral word: not every piece in the room is a bookcase. */
  { id: 'furniture', name: 'All six pieces', group: 'Your fixtures', render: Furniture },
  { id: 'bookcase', name: 'One fixture', group: 'Your fixtures', render: Bookcase },
  /* The same page with its sort rule open. Beside the page it is a state of,
     because the whole argument for changing it in place is that nothing else
     about the page moves while you do. */
  {
    id: 'fixturesort',
    name: 'A fixture’s sort rule',
    group: 'Your fixtures',
    render: BookcaseSorting,
  },
  /* What the piece allows, under a thumb. Beside the piece for the same reason
     its sort rule is: the argument for changing it here is that nothing else
     about the page moves while you do. */
  {
    id: 'fixturerule',
    name: 'What a fixture allows',
    group: 'Your fixtures',
    render: BookcaseRule,
  },
  { id: 'area', name: 'One area', group: 'Your fixtures', render: Area },
  { id: 'sortrule', name: 'An area’s sort rule', group: 'Your fixtures', render: AreaSorting },
  /* The other answer this widget can give, and the one whose sentence differs:
     an area that decides its own ordering is a place of its own and takes
     nothing overflowing into it. Beside the two it is a state of. */
  {
    id: 'areaown',
    name: 'An area ordered its own way',
    group: 'Your fixtures',
    render: AreaOwn,
  },
  /*
   * Writing a rule, in the order somebody walks it: the lines under a thumb,
   * choosing a tag to add, everything taken off, what the change would do, and
   * what it wrote. Only the fourth of those can write anything, and only the
   * fifth has.
   */
  {
    id: 'rulewriting',
    name: 'Changing what belongs',
    group: 'Your fixtures',
    render: RuleWriting,
  },
  { id: 'ruletag', name: 'Choosing a tag', group: 'Your fixtures', render: RuleTag },
  /* Preparing a shelf, which is the pair the baseline could not walk: a word
     the collection has never used, and the rule it leaves waiting. */
  {
    id: 'rulenewtag',
    name: 'A word you have never used',
    group: 'Your fixtures',
    render: RuleNewTag,
  },
  {
    id: 'rulewaiting',
    name: 'Waiting for its books',
    group: 'Your fixtures',
    render: RuleWaiting,
  },
  { id: 'ruleor', name: 'This tag or that one', group: 'Your fixtures', render: RuleOr },
  {
    id: 'rulenothing',
    name: 'It claims nothing',
    group: 'Your fixtures',
    render: RuleNothing,
  },
  {
    id: 'rulemoves',
    name: 'What it would do',
    group: 'Your fixtures',
    render: RuleMoves,
  },
  { id: 'ruledone', name: 'The rule is written', group: 'Your fixtures', render: RuleDone },
  /* Three states of one dialog, and the second and third are the ones that get
     skipped: the area at the top of a piece has nothing to fall into, and the
     last area on a piece has nowhere at all. */
  { id: 'removearea', name: 'Removing an area', group: 'Your fixtures', render: Removing },
  {
    id: 'removefirst',
    name: 'Removing the first one',
    group: 'Your fixtures',
    render: RemovingFirst,
  },
  {
    id: 'removeonly',
    name: 'Removing the only one',
    group: 'Your fixtures',
    render: RemovingOnly,
  },
  { id: 'claimed', name: 'Why a book is here', group: 'Your fixtures', render: Claimed },
  /* Beside the screen it is the other state of, because that is the pair: one
     book with rules queueing up for it, and one book nothing wanted. */
  {
    id: 'claimednone',
    name: 'Nothing claims this one',
    group: 'Your fixtures',
    render: ClaimedNone,
  },
  { id: 'move', name: 'Move non-fiction', group: 'Putting things right', render: Move },
  { id: 'plan', name: 'The plan', group: 'Putting things right', render: Plan },
  /* The journey, in the order it is walked: the whole of the work, one trip
     read at the bookcase, one book placed, the trip finished. Then the four
     states that are not that. */
  { id: 'carry', name: 'Books to carry', group: 'Putting things right', render: Carry },
  { id: 'trip', name: 'One trip, at 4A', group: 'Putting things right', render: Trip4A },
  { id: 'carrying', name: 'Where a carried book goes', group: 'Putting things right', render: Carrying },
  { id: 'carried', name: 'A trip finished', group: 'Putting things right', render: Carried },
  { id: 'carryfull', name: 'The area filled up', group: 'Putting things right', render: CarryFull },
  { id: 'carrypart', name: 'Picking it up again', group: 'Putting things right', render: CarryPart },
  { id: 'carrystale', name: 'The answer changed', group: 'Putting things right', render: CarryStale },
  { id: 'carryone', name: 'Only one to carry', group: 'Putting things right', render: CarryOne },
  { id: 'carrynone', name: 'Nothing to carry', group: 'Putting things right', render: CarryNone },
  { id: 'carryleft', name: 'Left where they are', group: 'Putting things right', render: CarryLeft },
  /* The other job that is putting things right, and the one that has never had
     a screen: the books no rule claims, the screen that settles one, and the
     day there are none. */
  { id: 'unclaimed', name: 'Nothing files these', group: 'Putting things right', render: Unclaimed },
  { id: 'saying', name: 'Say what a book is', group: 'Putting things right', render: Saying },
  {
    id: 'unclaimednone',
    name: 'Everything is filed',
    group: 'Putting things right',
    render: UnclaimedNone,
  },
  /*
   * The open question, and the group comes back for exactly as long as it is
   * open. Two drawings of the sort rule have been rejected, so this round drew
   * two answers rather than one and both are walkable on the same page: `area`
   * and `sortrule` are the one that is built, and these two are the other.
   *
   * Walk them in this order. The first is what the page looks like on the way
   * past, which is how it is usually met; the second is the press that follows.
   */
  {
    id: 'otherorder',
    name: 'The order, said another way',
    group: 'Two ways to say the order',
    render: OtherOrderShut,
  },
  {
    id: 'otherown',
    name: 'Changing it, another way',
    group: 'Two ways to say the order',
    render: OtherOrderOwn,
  },
]

/*
 * There is a group of things to choose between again, and it is temporary.
 *
 * Two screens lived under such a heading once, each drawing one question twice
 * so the owner could answer it by looking: which face the counts are set in,
 * and how tall a book is allowed to be. He answered both in #273 and both
 * screens went with the answers. A specimen nobody is choosing from is clutter,
 * which is the thing #262 took thirty-one of out of here, and a comparison left
 * standing after its question is settled quietly reopens it.
 *
 * The rule written down then was that the group comes back for as long as a
 * question needs deciding by looking, and goes again with the answer. **Two
 * drawings of the sort rule have now been rejected**, the second of them as
 * "not very understandable at all", so #405 drew two answers rather than
 * rearranging the same material a third time. The one under `Your fixtures` is
 * built and the two under this heading are the other one.
 *
 * **This heading, its two screens, `OtherOrder` and the `instead` prop on
 * `AreaScreen` all go together the day the question is answered.**
 */
export const GROUPS = [
  'Every day',
  'Finding a book',
  'Cataloguing',
  'The corner',
  'Your fixtures',
  'Putting things right',
  'Two ways to say the order',
]
