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

import type { ReactElement } from 'react'
import { Actions, Been, Head, Part, Tagged, Tagging } from '../Book'
import { Viewfinder } from '../Camera'
import { Card, Confirmation, Instruction, Nothing, Said } from '../Card'
import { Trip, Trips } from '../Carrying'
import { Cat } from '../Cat'
import { Button, Choice, Cycle, Field, Segmented } from '../Controls'
import { Covers, covers } from '../Covers'
import {
  Picked,
  SearchField,
  Suggestion,
  Suggestions,
  TagGroup,
  TagPick,
} from '../Finding'
import { AddBox, AreaBox, Claim, Must, Musts, Nest, Order } from '../Furniture'
import {
  IconCamera,
  IconCovers,
  IconEdit,
  IconFind,
  IconList,
  IconSpines,
} from '../Icons'
import { AddTag, List, Place, Row, Stats, Tag, Tags } from '../List'
import { Shelf, spines, type ShelfItem } from '../Shelf'
import { Shots, type Shot } from '../Shots'
import { Sure } from '../Sure'
import { TabBar, TopBar, type TabName } from '../Chrome'

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

/** Every screen wears the same frame, so no screen has to remember to. */
function Phone({
  children,
  tab,
  go,
  top,
  over,
}: {
  children: ReactElement | ReactElement[]
  tab: TabName
  go: Go
  top: ReactElement
  /**
   * A dialog over the whole screen, where a screen has one. The screen under
   * it is drawn in full and on purpose: what somebody is being asked about is
   * the thing they were just looking at, and a scrim that hid it would be
   * asking them to remember it.
   */
  over?: ReactElement
}) {
  const TAB_SCREENS: Record<TabName, string> = {
    home: 'home',
    library: 'library',
    scan: 'camera',
    queue: 'queue',
  }

  return (
    <div className={`wf-screen${over ? ' wf-screen--asked' : ''}`}>
      {top}
      <div className="wf-screen__body">{children}</div>
      <TabBar on={tab} onPick={(name) => go(TAB_SCREENS[name])} />
      {over}
    </div>
  )
}

/* --- Every day ---------------------------------------------------------- */

/**
 * The first screen: what is worth knowing, and nothing else.
 *
 * ## The camera is not on it
 *
 * A "Photograph a book" card sat in the middle of this screen with the primary
 * button on the page in it, and the owner took it off by name:
 *
 * > Let's not even have the book scanning part here. Let's just have metrics,
 * > useful information. Like, for example, "six are ready to shelve" or "three
 * > books to carry". Let's have meaningful information here.
 *
 * Photographing a book is one tap away in the tab bar, from here and from
 * everywhere else. A card opening the camera the tab already opens was a second
 * door to one room, and it was taking the middle of the screen somebody opens
 * most often.
 *
 * ## Every number goes somewhere
 *
 * Six counts, and each one is a target: ready to shelve and stuck open the
 * queue, to carry opens the carry list, catalogued opens the library, added
 * this week and checked out open the list of books. A number nobody can act on
 * is decoration, and it is the thing that would quietly fill this screen back
 * up.
 *
 * Two the catalogue can answer are deliberately not here. How many books have
 * no photograph, and how many carry a genre nobody confirmed, are both true and
 * neither leads anywhere a person can do anything about today.
 *
 * ## One sentence
 *
 * The cat says what is on the table and that is the whole of the prose. What
 * went with the camera card: "spine first, then the front", "saying 2C was full
 * moved these along", and "nothing has gone missing since Tuesday". The two
 * lists underneath say the same things by showing the books.
 *
 * ## The collection leads now (#283)
 *
 * "The collection" sat last, under everything asking for attention. Round six
 * moved it above "Needs you":
 *
 * > In the today view, I want the collection that we have all the way down at
 * > the bottom. That should be moved up. It should be above the "needs you".
 *
 * The order within each block did not change, only which block comes first.
 * This inverts what the screen leads with: it opened with what is asking for
 * attention and closed with what is owned; it now opens with what is owned.
 */
function Home(go: Go) {
  return (
    <Phone tab="home" go={go} top={<TopBar title="Book scan" />}>
      <Card weight="sunk">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Cat pose="sitting" size={52} />
          <p style={{ margin: 0, fontFamily: 'var(--face-book)', fontSize: 17 }}>
            Eighteen books are waiting on the table.
          </p>
        </div>
      </Card>

      <p className="wf-heading wf-heading--flush">The collection</p>
      <Stats
        items={[
          { n: '1,204', word: 'catalogued', onPress: () => go('library') },
          { n: '9', word: 'added this week', onPress: () => go('listing') },
          { n: '2', word: 'checked out', onPress: () => go('listing') },
        ]}
      />

      <p className="wf-heading wf-heading--flush">Needs you</p>
      {/* Fifty-three to carry, which is what the number looks like the week
          after a rule changed. It was three, and three is the number this
          screen shows on an ordinary day; the carry screens are drawn at the
          size the job actually reaches, so this one says so too. A count that
          only ever reads "3" would have let the whole flow be designed for a
          list that fits on one screen. */}
      <Stats
        items={[
          { n: '6', word: 'ready to shelve', onPress: () => go('queue') },
          { n: '53', word: 'to carry', onPress: () => go('carry') },
          { n: '3', word: 'stuck', onPress: () => go('queue') },
        ]}
      />

      <Card title="Ready to shelve">
        <List label="Ready to shelve">
          <Row
            title="Never Let Me Go"
            sub="Ishiguro, Kazuo"
            cloth="moss"
            place="2C"
            onPress={() => go('where')}
          />
          <Row
            title="The City &amp; the City"
            sub="Mi&eacute;ville, China"
            cloth="plum"
            place="1C"
            onPress={() => go('where')}
          />
        </List>
        <Button tone="quiet" onPress={() => go('queue')}>
          All eighteen
        </Button>
      </Card>

      {/* The first three of fifty-three, and a way to the rest, which is the
          shape the queue card above already has. Three books off a list that
          long is a taste rather than a summary, and the honest summary is the
          count above it. */}
      <Card title="Books to carry">
        <List label="Books to carry">
          <Row
            title="The Songlines"
            sub="Chatwin, Bruce"
            cloth="sun"
            meta="4A to 3A"
            onPress={() => go('carry')}
          />
          <Row
            title="Silent Spring"
            sub="Carson, Rachel"
            cloth="moss"
            meta="4A to 3A"
            onPress={() => go('carry')}
          />
          <Row
            title="Underland"
            sub="Macfarlane, Robert"
            cloth="wood"
            meta="4B to 3B"
            onPress={() => go('carry')}
          />
        </List>
        <Button tone="quiet" onPress={() => go('carry')}>
          All fifty-three
        </Button>
      </Card>
    </Phone>
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
type View = 'covers' | 'list' | 'spines'

const VIEW_SCREENS: Record<View, string> = {
  covers: 'covers',
  list: 'listing',
  spines: 'library',
}

/** Pressing the switcher takes you to the next of the three, and round again. */
const NEXT_VIEW: Record<View, View> = {
  covers: 'list',
  list: 'spines',
  spines: 'covers',
}

/**
 * What the switcher draws, which is the view it would move you to.
 *
 * Not the one you are in. `Controls.tsx` has the argument; the short of it is
 * that the screen underneath is already the loudest possible statement of
 * which view you are in, and nothing else on it says what this button does.
 */
const VIEW_ICON: Record<View, ReactElement> = {
  covers: <IconCovers size={20} />,
  list: <IconList size={20} />,
  spines: <IconSpines size={20} />,
}

/** And what it is called, in the same direction: the outcome, as a sentence. */
const VIEW_NAME: Record<View, string> = {
  covers: 'Show the covers',
  list: 'Show them as a list',
  spines: 'Show them standing up',
}

/**
 * What every library screen wears above its books.
 *
 * **One row now, and that is the point of it.** It was two: the filter, and
 * under it a segmented control with Covers, List and Spines side by side. The
 * owner took the second row off and said why:
 *
 * > Instead of showing covers, list and spines as this very big thing that we
 * > can select one of three options for, can we put it to the right of the
 * > "every book" filter, underneath where the search symbol is in the top
 * > right corner? [...] That way you don't take up all this space for choosing
 * > between those different views.
 *
 * He is right, and the reason generalises the way the tag row's did. Which of
 * three ways you like looking at your books is a preference somebody sets
 * rarely and then lives with; the filter beside it is a question they answer
 * constantly. Charging the same rent for both, on the one screen whose whole
 * job is showing books, is the wrong trade, and it was 64px of every visit.
 *
 * The filter itself did not move and did not shrink: it is the same row, with
 * a 44px circle now sitting at the end of it.
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
  const next = NEXT_VIEW[view]

  return (
    <div className="wf-filter">
      <Picked tags={tags} note={note} onPress={() => go('tags')} />
      <Cycle
        name={VIEW_NAME[next]}
        icon={VIEW_ICON[next]}
        onPress={() => go(VIEW_SCREENS[next])}
      />
    </div>
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
          action={{ word: 'Find', icon: <IconFind />, onPress: () => go('find') }}
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
          paragraph doing a link's job. "It's definitely not that." */}
      <div className="wf-under">
        {/* Not "see the bookcases": what it opens is five pieces and two of
            them are a crate and a desk. The category word goes neutral even
            though the pieces above it are named for what they are. */}
        <Button tone="quiet" onPress={() => go('furniture')}>
          See your furniture
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
          action={{ word: 'Find', icon: <IconFind />, onPress: () => go('find') }}
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
          action={{ word: 'Find', icon: <IconFind />, onPress: () => go('find') }}
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
 * Below it, in this order: where it sits, why it sits there, where it has been,
 * and more by this author. Somebody arriving at a book either wants to do
 * something or wants to know where it is, and the knowing is what they scroll
 * to anyway, so putting the doing first costs it nothing.
 *
 * Three things moved to get there and each one is the owner's: the tags went up
 * under the ISBN, the actions went up to where "where it is" used to sit, and
 * "who wrote it" became "more by this author" with the same content under it.
 * Two things did not move: "why it is here" stays under the drawing of the
 * board, and "where it has been" stays exactly as it is, which is the one part
 * of this screen he has said twice that he likes.
 *
 * **They are the same book by the same author, and that is the point.** One
 * record is as full as this catalogue gets and the other is nearly empty,
 * which is what most of a real collection looks like, and putting them on one
 * author shows what survives a thin record: who wrote it, and what else of
 * theirs is in the house. Everything that is missing is drawn as the empty
 * shape of itself rather than left off, because a gap somebody can fill is a
 * thing to know.
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
      <Head
        title="The Left Hand of Darkness"
        by="Ursula K. Le Guin"
        shots={[
          { word: 'Front', cloth: 'plum' },
          { word: 'Spine', cloth: 'plum', sliver: true },
          { word: 'Back', cloth: 'wood' },
          { word: 'Downloaded', cloth: 'sky' },
        ]}
        facts={['Ace, 1969. 304 pages.', 'Hainish Cycle, book four', 'ISBN 9780441478125']}
      />

      {/* Straight under the publisher and the ISBN, because that is where he
          put them: "those should be up underneath where we have the ISBN,
          publisher, all of that." What a book is about is a fact about the
          book, and it was three sections down under everything about where it
          sits. */}
      <Part head="What it is about">
        <Tagging>
          <Tagged word="Fiction" from="person" who="You said so, on 3 June" />
          <Tagged word="Science fiction" from="catalogue" who="Open Library says so" />
          <Tagged
            word="Anthropology"
            from="guess"
            who="The app guessed it, and it is not sure"
          />
        </Tagging>
      </Part>

      {/*
        Three, and the count is the design.

        These are the two he named, "check it out" and "moved it", and the one
        he allowed, "or maybe other actions like moving it". Everything else a
        person can do to this book is either already on the screen or belongs
        beside the thing it acts on, and this row is the first thing a thumb
        reaches, which is exactly the row that fills up:

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
      <Part head="What you can do">
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
      </Part>

      {/* Below the fold now, and unchanged apart from losing the sentence over
          it. The board is how you find the book in the room and it names the
          two books either side, and the cat on top of it says which one it is.
          Why it is here sits under the drawing, where the question gets asked. */}
      <Part head="Where it is">
        <div className="wf-bleed">
          <Shelf label="1C" note="Third along" items={row} />
        </div>
        <Actions>
          <Button tone="quiet" small onPress={() => go('claimed')}>
            Why it is here
          </Button>
        </Actions>
      </Part>

      {/* Untouched, on purpose. "I like the where it has been. That should
          stay. I really like that." */}
      <Part head="Where it has been" note="Five moves">
        <Been
          rows={[
            { what: 'Put on 1C', who: 'You carried it', when: '4 Aug' },
            { what: 'Meant for 1C', who: 'The app, when you said 1B was full', when: '2 Aug' },
            { what: 'Brought back', who: 'Put back where it came off', when: '28 Jul' },
            { what: 'Taken out', when: '12 Jul' },
            { what: 'Put on 1B', who: 'You carried it', when: '3 Jun' },
          ]}
        />
      </Part>

      {/* The same content under the heading he asked for: "instead of who wrote
          it and then have the author there, we could just have more by this
          author and then the same stuff, so they can see it." The name and what
          it files under stay, because they are what the heading is about. */}
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
 * The two things that are as good as they are on the full record are the two
 * that come from somewhere other than a catalogue: who wrote it, and where it
 * has been.
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
          { word: 'Downloaded' },
        ]}
        facts={['No publisher, year or length', 'No ISBN']}
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

      <Part head="What it is about">
        <Tagging>
          <Tagged
            word="Fiction"
            from="guess"
            who="The app guessed it from the title, and it is not sure"
          />
        </Tagging>
      </Part>

      {/*
        Two, and they are not the rich book's three, because this book is in
        the house rather than on a bookcase. Putting it back is the one thing
        somebody holding it can do, and saying what it is, is the one thing
        worth doing to a record this thin: the only tag on it is a guess, and a
        guess is what the app rewrites and a person's word is not.

        "It moved" and "Move it" are deliberately not here. A book nobody has
        put anywhere has not moved, and offering to move it is offering to move
        it from nowhere.
      */}
      <Part head="What you can do">
        <Actions>
          <Button tone="secondary" small onPress={() => go('where')}>
            Put it back
          </Button>
          <Button tone="quiet" small>
            Say what it is
          </Button>
        </Actions>
      </Part>

      {/* One word, and it is the whole section. The rich book has a board
          drawn under this heading and reads its own label off it; this book has
          no board to read, so the label is the answer, and the date it went out
          is the first row of where it has been. */}
      <Part head="Where it is">
        {/* Wrapped, because a section is a grid and a grid stretches what is
            put in it: the label went the width of the phone and read as an
            empty field waiting to be filled in. Found by looking at it. */}
        <div>
          <Place quiet>Out</Place>
        </div>
      </Part>

      <Part head="Where it has been" note="Two moves">
        <Been
          rows={[
            { what: 'Taken out', when: '2 Aug' },
            { what: 'Put on 1C', who: 'You carried it', when: '14 May' },
          ]}
        />
      </Part>

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

/** Everything above the results, which is the same on all five. */
function FindTop(go: Go, sub?: string) {
  return (
    <TopBar
      title="Find a book"
      sub={sub}
      onBack={() => go('library')}
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

function Review(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Check the details" sub="Read off the barcode" onBack={() => go('queue')} />}
    >
      {/*
        The photographs first, because the first thing somebody wants to know
        is whether they came out. There were none on this screen at all, which
        the owner found immediately: "we are not showing any images here. We
        wanna show those images and enable them to retake them if they don't
        like them because they're blurry."
      */}
      <Shots shots={shotsOf(go)} act size="big" />

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
          <Tag onPress={() => {}}>Fiction</Tag>
          <Tag onPress={() => {}}>Literary</Tag>
          <Tag onPress={() => {}}>Booker</Tag>
          <Tag onPress={() => {}}>Read it</Tag>
          <AddTag onPress={() => {}}>Add a tag</AddTag>
        </Tags>
      </div>

      <Button tone="primary" block onPress={() => go('where')}>
        That is the book
      </Button>
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

function Where(go: Go) {
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
 * That still left two cats on a shelf built to mark one book: the cat #288
 * put on the placed book, and the cat `Shelf` puts at the end of every run as
 * a bookend. The bookend is furniture, true of every shelf whether a book was
 * just placed on it or not; the marker is the one fact this screen exists to
 * show. So the bookend is the item dropped from this row, and only from this
 * one, because #288 already tried the ring and the bracket and rejected both,
 * and neither is a reason to leave the book unmarked here.
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

function Queue(go: Go) {
  return (
    <Phone tab="queue" go={go} top={<TopBar title="Queue" sub="18 books on the table" />}>
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

      <List label="Ready to shelve">
        <Row title="Never Let Me Go" sub="Ishiguro, Kazuo" cloth="moss" place="2C" onPress={() => go('review')} />
        <Row title="Cloud Atlas" sub="Mitchell, David" cloth="sky" place="2C" onPress={() => go('review')} />
        <Row title="Underland" sub="Macfarlane, Robert" cloth="wood" place="4A" onPress={() => go('review')} />
        <Row title="Piranesi" sub="Clarke, Susanna" cloth="plum" place="1B" onPress={() => go('review')} />
      </List>

      <Card kind="Stuck" title="Three need a hand">
        <List label="Stuck">
          <Row title="No barcode read" sub="Photographed 11:40" cloth="wood2" meta="Type the ISBN" onPress={() => go('review')} />
          <Row title="9781857231380" sub="No catalogue has it" cloth="sun" meta="Fill it in" onPress={() => go('review')} />
        </List>
      </Card>
    </Phone>
  )
}

/* --- Your furniture ------------------------------------------------------- */

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

const ROOM = [
  { label: '1', name: 'By the window' },
  { label: '2', name: 'Not named' },
  { label: '3', name: 'The landing' },
  { label: '4', name: 'Hall crate' },
  { label: '5', name: 'Desk' },
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
      onPress={head ?? (() => go('belongs'))}
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
      <AddBox onPress={() => go('addarea')}>Add an area to bookcase 2</AddBox>
    </Nest>
  )
}

function Furniture(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Your furniture" sub="Five pieces, sixteen areas" onBack={() => go('library')} />}
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
        <AddBox onPress={() => go('addarea')}>Add an area to this bookcase</AddBox>
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
        <AddBox onPress={() => go('addarea')}>Add an area to this bookcase</AddBox>
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
        <AddBox onPress={() => go('addarea')}>Add an area to this crate</AddBox>
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
        <AddBox onPress={() => go('addarea')}>Add an area to this desk</AddBox>
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

function Bookcase(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Bookcase 2" sub="3 areas, 63 books" onBack={() => go('furniture')} />}
    >
      <Bookcase2 go={go} />

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
        <Order slots={ROOM.map((slot) => ({ ...slot, on: slot.label === '2' }))} />
      </div>

      <Card weight="sunk" kind="What it will be called" title="2A, 2B, 2C" />

      <Button tone="primary" block onPress={() => go('furniture')}>
        Save
      </Button>

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
 * top bar says it in four words, and the arrow beside them goes there. What is
 * left is the three things this screen can change and the two things it can do.
 *
 * **Four screens draw this**, which is why it takes arguments: the area itself,
 * and the three states of being asked to remove one. The dialog is drawn over
 * the same screen it was opened from rather than over a stand-in, because that
 * is the only way to see whether it can be read against what is behind it.
 */
function AreaScreen({
  go,
  label,
  sub,
  name,
  belongs,
  ordered,
  order,
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
  /** How it is ordered, in the same voice. */
  ordered: string
  /** The line under that, where there is more to say. */
  order?: string
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

      <Card
        kind="What belongs here"
        title={belongs}
        foot={
          <Button tone="secondary" block onPress={() => go('belongs')}>
            Change what belongs here
          </Button>
        }
      />

      <Card
        kind="How it is ordered"
        title={ordered}
        foot={
          <Button tone="secondary" block onPress={() => go('sorting')}>
            Change the order
          </Button>
        }
      >
        {order && <p>{order}</p>}
      </Card>

      {/* "Remove this thing at the bottom, what it held becomes part of the
          one before. Get rid of that." It was a paragraph with no action
          under it, so nothing went with it. */}
      <Button tone="primary" block onPress={() => go('addarea')}>
        Split this area in two
      </Button>

      {/*
        The way to remove an area, which the interface did not have anywhere at
        all until #281.

        It wears the fixture screen's dashed fence and not its sentence, and
        both halves of that are deliberate. The fence, because a screen should
        not let the irreversible thing sit shoulder to shoulder with the thing
        the screen is for: on a phone they are two full-width buttons 12px
        apart, and the fixture screen already solved that. No sentence, because
        the fixture's "Its 63 books move to other furniture first" is there for
        a reason that does not apply here: pressing that one goes straight to
        the plan and starts arranging, so the screen is the only place left to
        say it. This one has a dialog, and a dialog is a better place to say it
        than a caption nobody read on the way past. A standing explanation of a
        button nobody has pressed is the ambient prose #262 took thirty-one
        instances of off these screens.
      */}
      <Card
        weight="quiet"
        foot={
          <Button tone="danger" block onPress={() => go('removearea')}>
            Remove this area
          </Button>
        }
      />
    </Phone>
  )
}

function Area(go: Go) {
  return (
    <AreaScreen
      go={go}
      label="2 · Cookery"
      sub="18 books, on bookcase 2"
      name="Cookery"
      belongs="Anything tagged Cookery"
      ordered="The way bookcase 2 does"
      order="By the author’s surname, which is what the whole library uses."
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
      ordered="The way bookcase 2 does"
      order="By the author’s surname, which is what the whole library uses."
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
      ordered="The way By the window does"
      order="By the author’s surname, which is what the whole library uses."
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
      ordered="The way the desk does"
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

function AddArea(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Add an area" sub="Splitting 2 · Cookery" onBack={() => go('area')} />}
    >
      <Instruction>Where does the new area start?</Instruction>

      <Nest name="Bookcase 2" note="63 books" holds="Anything tagged Non-fiction">
        <AreaBox reads="2A" books={21} holds="Non-fiction starts here" />
        <AreaBox reads="2B" books={24} holds="Non-fiction, carrying on" />
        <AreaBox reads="2 · Cookery" books={11} holds="Acton to Fisher" on />
        <AreaBox reads="2D, new" books={7} holds="Grigson to Wolfert" on />
      </Nest>

      <p className="wf-heading wf-heading--flush">Books on 2 &middot; Cookery</p>
      <List label="Books on 2C">
        <Row title="A Book of Mediterranean Food" sub="David, Elizabeth" cloth="moss" onPress={() => {}} />
        <Row title="How to Cook a Wolf" sub="Fisher, M. F. K." cloth="wood" onPress={() => {}} />
        <Row
          title="Good Things"
          sub="Grigson, Jane"
          cloth="plum"
          meta="Starts here"
          onPress={() => {}}
        />
        <Row title="On Food and Cooking" sub="McGee, Harold" cloth="sky" onPress={() => {}} />
        <Row title="Salt Fat Acid Heat" sub="Nosrat, Samin" cloth="sun" onPress={() => {}} />
      </List>

      <Card weight="sunk" kind="What it does" title="Cookery keeps 11 books, the new one takes 7" />

      <Button tone="primary" block onPress={() => go('area')}>
        Add the area
      </Button>
      <Button tone="quiet" block onPress={() => go('area')}>
        Leave it as one area
      </Button>
    </Phone>
  )
}

function Belongs(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="What belongs here" sub="2 · Cookery" onBack={() => go('area')} />}
    >
      <Instruction>Books tagged Cookery go on 2C.</Instruction>

      <Card kind="The rule" title="Cookery">
        <Musts>
          <Must lead="Tagged" tag="Non-fiction" onPress={() => {}} />
          <Must join="and" lead="Tagged anything under" tag="Cookery" onPress={() => {}} />
        </Musts>
        <Button tone="quiet" onPress={() => {}}>
          Add another thing that must be true
        </Button>
      </Card>

      <Card kind="When two rules want the same book" title="The one about the smaller place wins">
        <div className="wf-steps">
          <div className="wf-step">
            <span className="wf-step__n">1</span>
            <span>
              Cookery, about <Place quiet>2C</Place>
            </span>
          </div>
          <div className="wf-step">
            <span className="wf-step__n">2</span>
            <span>Anything tagged Non-fiction, about the whole of bookcase 2</span>
          </div>
        </div>
        <Button tone="quiet" onPress={() => go('claimed')}>
          Show me what claimed a book
        </Button>
      </Card>

      <Card weight="quiet" kind="Claimed by nothing" title="Three books match no rule at all" />

      <Button tone="primary" block onPress={() => go('plan')}>
        Show me what would move
      </Button>
    </Phone>
  )
}

function Sorting(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="How 2C is ordered" sub="Cookery" onBack={() => go('area')} />}
    >
      <Card weight="sunk" kind="Right now" title="By the author’s surname" />

      <Choice
        label="How 2C should be ordered"
        on="same"
        options={[
          { value: 'same', word: 'The way bookcase 2 does', sub: 'By the author’s surname today' },
          { value: 'author', word: 'By the author' },
          { value: 'title', word: 'By the title' },
          { value: 'year', word: 'By the year it came out' },
          { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
        ]}
      />

      <Card kind="If you choose one here" title="2C becomes a place of its own" />

      <Button tone="primary" block onPress={() => go('area')}>
        Save
      </Button>
      <Button tone="quiet" block onPress={() => go('area')}>
        Leave it as it is
      </Button>
    </Phone>
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
        <div style={{ display: 'grid', gap: 8 }}>
          <Claim
            name="Cookery"
            about="About 2C"
            won
            why="It asks for a tag this book has, and it is about one area."
            onPress={() => go('belongs')}
          />
          <Claim
            name="Anything tagged Non-fiction"
            about="About the whole of bookcase 2"
            why="It fits too, but a rule about one area beats a rule about a whole fixture."
            onPress={() => go('belongs')}
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
          <Button tone="secondary" onPress={() => go('belongs')}>
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
        See your furniture
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
      <Button tone="quiet" block onPress={() => go('belongs')}>
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
    <Phone tab="queue" go={go} top={<TopBar title="Queue" sub="Nothing on the table" />}>
      <Nothing said="Even the cat couldn't find anything to knock off the table." />
      <Button tone="primary" block onPress={() => go('camera')}>
        Open the camera
      </Button>
    </Phone>
  )
}

export const SCREENS: Screen[] = [
  { id: 'home', name: 'Today', group: 'Every day', render: Home },
  /* Short names. The viewer's own bar gives a name about twenty-four
     characters before it truncates, and three of these were being cut off in
     the middle of the word that told them apart. */
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
  { id: 'find', name: 'Find, before you type', group: 'Finding a book', render: Find },
  { id: 'finding', name: 'Typing a name', group: 'Finding a book', render: Finding },
  { id: 'findisbn', name: 'Typing an ISBN', group: 'Finding a book', render: FindIsbn },
  { id: 'findtag', name: 'Typing a tag', group: 'Finding a book', render: FindTag },
  { id: 'findnone', name: 'Nothing matches', group: 'Finding a book', render: FindNone },
  { id: 'tags', name: 'All twenty-three tags', group: 'Finding a book', render: TagsScreen },
  { id: 'spine', name: 'Framing the spine', group: 'Cataloguing', render: SpineShot },
  { id: 'camera', name: 'The camera', group: 'Cataloguing', render: Camera },
  { id: 'review', name: 'Check the details', group: 'Cataloguing', render: Review },
  { id: 'where', name: 'Where it goes', group: 'Cataloguing', render: Where },
  { id: 'done', name: 'Shelved', group: 'Cataloguing', render: Done },
  { id: 'queue', name: 'The queue', group: 'Cataloguing', render: Queue },
  { id: 'empty', name: 'An empty queue', group: 'Cataloguing', render: Empty },
  /* The ids are the URLs and they stay put. The names are read, so they take
     the neutral word: not every piece in the room is a bookcase. */
  { id: 'furniture', name: 'All five pieces', group: 'Your furniture', render: Furniture },
  { id: 'bookcase', name: 'One fixture', group: 'Your furniture', render: Bookcase },
  { id: 'area', name: 'One area', group: 'Your furniture', render: Area },
  { id: 'addarea', name: 'Adding an area', group: 'Your furniture', render: AddArea },
  /* Three states of one dialog, and the second and third are the ones that get
     skipped: the area at the top of a piece has nothing to fall into, and the
     last area on a piece has nowhere at all. */
  { id: 'removearea', name: 'Removing an area', group: 'Your furniture', render: Removing },
  {
    id: 'removefirst',
    name: 'Removing the first one',
    group: 'Your furniture',
    render: RemovingFirst,
  },
  {
    id: 'removeonly',
    name: 'Removing the only one',
    group: 'Your furniture',
    render: RemovingOnly,
  },
  { id: 'belongs', name: 'What belongs here', group: 'Your furniture', render: Belongs },
  { id: 'sorting', name: 'How an area is ordered', group: 'Your furniture', render: Sorting },
  { id: 'claimed', name: 'Why a book is here', group: 'Your furniture', render: Claimed },
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
]

/*
 * There is no group of things to choose between any more, and there should not
 * be a standing one.
 *
 * Two screens lived under that heading, each drawing one question twice so the
 * owner could answer it by looking: which face the counts are set in, and how
 * tall a book is allowed to be. He answered both in #273 and both screens went
 * with the answers. A specimen nobody is choosing from is clutter, which is the
 * thing #262 took thirty-one of out of here, and a comparison left standing
 * after its question is settled quietly reopens it.
 *
 * If another question needs deciding by looking, the group comes back for as
 * long as that question is open and goes again with the answer.
 */
export const GROUPS = [
  'Every day',
  'Finding a book',
  'Cataloguing',
  'Your furniture',
  'Putting things right',
]
