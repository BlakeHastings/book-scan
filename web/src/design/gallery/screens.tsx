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

import type { CSSProperties, ReactElement } from 'react'
import { Actions, Been, Head, Here, Part, Tagged, Tagging } from '../Book'
import { Viewfinder } from '../Camera'
import { Card, Confirmation, Instruction, Nothing, Said } from '../Card'
import { Cat } from '../Cat'
import { Button, Choice, Field, Segmented } from '../Controls'
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
import { IconCamera, IconEdit, IconFind } from '../Icons'
import { AddTag, List, Place, Row, Stats, Tag, Tags } from '../List'
import { Shelf, spines, type ShelfItem } from '../Shelf'
import { Shots, type Shot } from '../Shots'
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
}: {
  children: ReactElement | ReactElement[]
  tab: TabName
  go: Go
  top: ReactElement
}) {
  const TAB_SCREENS: Record<TabName, string> = {
    home: 'home',
    library: 'library',
    scan: 'camera',
    queue: 'queue',
  }

  return (
    <div className="wf-screen">
      {top}
      <div className="wf-screen__body">{children}</div>
      <TabBar on={tab} onPick={(name) => go(TAB_SCREENS[name])} />
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

      <p className="wf-heading wf-heading--flush">Needs you</p>
      <Stats
        items={[
          { n: '6', word: 'ready to shelve', onPress: () => go('queue') },
          { n: '3', word: 'to carry', onPress: () => go('carry') },
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

      <Card title="Books to carry">
        <List label="Books to carry">
          <Row
            title="Guards! Guards!"
            sub="Pratchett, Terry"
            cloth="sun"
            meta="2C to 2D"
            onPress={() => go('carry')}
          />
          <Row
            title="Snow Crash"
            sub="Stephenson, Neal"
            cloth="sky"
            meta="2C to 2D"
            onPress={() => go('carry')}
          />
          <Row
            title="The Book Thief"
            sub="Zusak, Markus"
            cloth="plum"
            meta="2D to 3A"
            onPress={() => go('carry')}
          />
        </List>
      </Card>

      <p className="wf-heading wf-heading--flush">The collection</p>
      <Stats
        items={[
          { n: '1,204', word: 'catalogued', onPress: () => go('library') },
          { n: '9', word: 'added this week', onPress: () => go('listing') },
          { n: '2', word: 'checked out', onPress: () => go('listing') },
        ]}
      />
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

/**
 * What every library screen wears above its books.
 *
 * Two rows, and the top one is the interesting one. It used to be Fiction and
 * Non-fiction as a segmented control, which is a design that quietly assumes
 * the number of tags is two. It is now a single row that says what you are
 * looking at and opens the tags, and it costs the same one line whether
 * somebody keeps two tags or forty.
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
    <>
      <Picked tags={tags} note={note} onPress={() => go('tags')} />
      <Segmented<View>
        label="How to look at them"
        on={view}
        options={[
          { value: 'covers', word: 'Covers' },
          { value: 'list', word: 'List' },
          { value: 'spines', word: 'Spines' },
        ]}
        onPick={(picked) => go(VIEW_SCREENS[picked])}
      />
    </>
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
        <Button tone="quiet" onPress={() => go('furniture')}>
          See the bookcases
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
 * what can I do with it", and they carry the same five sections in the same
 * order: what it is, where it is, what it is about, who wrote it, and where it
 * has been. Location is the second of them and the smallest, one line and
 * three small buttons where it used to be a card the height of a hand.
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
      ratio: 8.5,
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

      {/* Second on the page and the smallest section on it. The board stays,
          because it is how you find the book in the room and it names the two
          books either side; what went is the card that used to sit under it. */}
      <Part head="Where it is">
        <Here
          said="On bookcase 1, where it should be."
          when="Last confirmed there on 4 August."
        />
        <div className="wf-bleed">
          <Shelf label="1C" note="Third along" items={row} />
        </div>
        <Actions>
          <Button tone="secondary" small>
            Check it out
          </Button>
          <Button tone="quiet" small onPress={() => go('where')}>
            It moved
          </Button>
          <Button tone="quiet" small onPress={() => go('claimed')}>
            Why it is here
          </Button>
        </Actions>
      </Part>

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

      <Part head="Who wrote it" note="Nine of theirs">
        <p className="wf-book__by" style={{ margin: 0 }}>
          Ursula K. Le Guin
        </p>
        <Said>Files under Le Guin, Ursula K.</Said>
        {AlsoTheirs(go)}
      </Part>

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

      <Part head="Where it is">
        <Here
          label="Out"
          quiet
          said="Not on a bookcase. You have it."
          when="Taken out on 2 August."
        />
        <Actions>
          <Button tone="secondary" small onPress={() => go('where')}>
            Put it back
          </Button>
        </Actions>
      </Part>

      <Part head="What it is about">
        <Tagging>
          <Tagged
            word="Fiction"
            from="guess"
            who="The app guessed it from the title, and it is not sure"
          />
        </Tagging>
        <Actions>
          <Button tone="quiet" small>
            Say what it is
          </Button>
        </Actions>
      </Part>

      <Part head="Who wrote it" note="Nine of theirs">
        <p className="wf-book__by" style={{ margin: 0 }}>
          Ursula K. Le Guin
        </p>
        <Said>Files under Le Guin, Ursula K.</Said>
        {AlsoTheirs(go)}
      </Part>

      <Part head="Where it has been" note="Two moves">
        <Been
          rows={[
            { what: 'Taken out', when: '2 Aug' },
            { what: 'Put on 1C', who: 'You carried it', when: '14 May' },
          ]}
        />
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
      <Instruction>
        Between <em>The City &amp; the City</em> and <em>Cloud Atlas</em>.
      </Instruction>

      <div className="wf-bleed">
        <Shelf label="2C" note="5 books, and the gap" items={row} inHand="Never Let Me Go" />
      </div>

      <Card
        weight="sunk"
        foot={
          <>
            <Button tone="primary" onPress={() => go('done')}>
              It fits
            </Button>
            <Button tone="secondary" onPress={() => go('carry')}>
              2C is full
            </Button>
          </>
        }
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
 * gap was and marked with the ring `Shelf` already puts on the book a screen
 * is about. Nothing new was built for it: the before is `{ kind: 'gap' }` and
 * the after is `here: true` on the spine that filled it.
 */
function Done(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    { kind: 'spine', text: 'Ishiguro, Kazuo', cloth: 'moss', pages: 288, ratio: 8.5, here: true },
    ...spines(['Mitchell, David', 'Morrison, Toni', 'Pratchett, Terry'], 3),
    { kind: 'bookend' },
  ]

  return (
    <Phone tab="queue" go={go} top={<TopBar title="Shelved" />}>
      <Confirmation said="Never Let Me Go is on 2C." />

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

/** Bookcase 2, drawn wherever a screen needs it, with one area picked out. */
function Bookcase2({ on, go, head }: { on?: string; go: Go; head?: () => void }) {
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
          on={area.reads === on}
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
      top={<TopBar title="Your bookcases" sub="Five pieces, sixteen areas" onBack={() => go('library')} />}
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

      <Button tone="primary" block onPress={() => go('bookcase')}>
        Add a bookcase
      </Button>

      <Card weight="quiet" kind="The order" title="They are numbered by where they stand">
        <Button tone="quiet" onPress={() => go('bookcase')}>
          Change the order
        </Button>
      </Card>
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

      <div>
        <span className="wf-field__label">Where it stands</span>
        <div style={{ height: 6 }} />
        <Order slots={ROOM.map((slot) => ({ ...slot, on: slot.label === '2' }))} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button tone="secondary" small>
          Move it earlier
        </Button>
        <Button tone="secondary" small>
          Move it later
        </Button>
      </div>

      <Card weight="sunk" kind="What it will be called" title="2A, 2B, 2C" />

      <Button tone="primary" block onPress={() => go('furniture')}>
        Save
      </Button>

      <Card weight="quiet" kind="Taking it out of the room" title="The books do not vanish with it">
        <Button tone="danger" onPress={() => go('carry')}>
          Take it out of the room
        </Button>
      </Card>
    </Phone>
  )
}

function Area(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="2 · Cookery" sub="18 books, on bookcase 2" onBack={() => go('bookcase')} />}
    >
      <Bookcase2 on="2 · Cookery" go={go} head={() => go('bookcase')} />

      <Field label="What you call this area" value="Cookery" />

      <Card
        kind="What belongs here"
        title="Anything tagged Cookery"
        foot={
          <Button tone="secondary" block onPress={() => go('belongs')}>
            Change what belongs here
          </Button>
        }
      />

      <Card
        kind="How it is ordered"
        title="The way bookcase 2 does"
        foot={
          <Button tone="secondary" block onPress={() => go('sorting')}>
            Change the order
          </Button>
        }
      >
        <p>By the author’s surname, which is what the whole library uses.</p>
      </Card>

      <Button tone="primary" block onPress={() => go('addarea')}>
        Split this area in two
      </Button>

      <Card weight="quiet" kind="Taking this area away" title="What it held becomes part of the one before" />
    </Phone>
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
            why="It fits too, but a rule about one area beats a rule about a whole bookcase."
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

function Carry(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Books to carry" sub="3 books" onBack={() => go('home')} />}
    >
      {/* The card that stood here explained the list underneath it, which the
          list already says: each row names where the book is and where it is
          going. Gone with the other captions. */}
      <List label="Books to carry">
        <Row title="Guards! Guards!" sub="Pratchett, Terry" cloth="sun" meta="2C to 2D" onPress={() => go('where')} />
        <Row title="Snow Crash" sub="Stephenson, Neal" cloth="sky" meta="2C to 2D" onPress={() => go('where')} />
        <Row title="The Book Thief" sub="Zusak, Markus" cloth="plum" meta="2D to 3A" onPress={() => go('where')} />
      </List>

      <Button tone="primary" block onPress={() => go('where')}>
        Start with the first one
      </Button>

      <Card weight="quiet" kind="Not on this list" title="Two books are checked out" />
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
      <Card kind="What would happen" title="Bookcase 4 to bookcase 3">
        <div className="wf-steps">
          <div className="wf-step">
            <span className="wf-step__n">1</span>
            <span>
              <Place quiet>4A</Place> to <Place quiet>3A</Place> &mdash; 8 books
            </span>
          </div>
          <div className="wf-step">
            <span className="wf-step__n">2</span>
            <span>
              <Place quiet>4B</Place> to <Place quiet>3B</Place> &mdash; 20 books
            </span>
          </div>
          <div className="wf-step">
            <span className="wf-step__n">3</span>
            <span>
              <Place quiet>4C</Place> to <Place quiet>3C</Place> &mdash; 22 books
            </span>
          </div>
        </div>
      </Card>

      <Card kind="Left alone" title="Four books">
        <p>
          One you asked to stay put. Two checked out. One never confirmed onto a
          bookcase.
        </p>
      </Card>

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
      <Nothing said="The table is clear." />
      <Button tone="primary" block onPress={() => go('camera')}>
        Open the camera
      </Button>
    </Phone>
  )
}

/* --- Two things to look at and choose between ---------------------------- */

/*
 * These two are not screens of the app and are not pretending to be. They are
 * here because two of the decisions in this round cannot be settled by
 * argument, and both were asked for as a comparison rather than as a pick.
 *
 * They wear no tab bar for that reason: nothing on them is a place you can be
 * in the app.
 */

function Specimen({
  title,
  note,
  children,
  go,
}: {
  title: string
  note: string
  children: ReactElement | ReactElement[]
  go: Go
}) {
  return (
    <div className="wf-screen">
      <TopBar title={title} onBack={() => go('home')} />
      <div className="wf-screen__body">
        <Said>{note}</Said>
        {children}
      </div>
    </div>
  )
}

/**
 * A labelled half of a comparison.
 *
 * The label is in the interface face rather than the book face, which is what
 * every other heading in the system uses. On a page whose whole subject is
 * which face to use, a heading set in one of the two candidates is an argument
 * nobody made. Found by looking at it: "Rounded" was in the serif.
 */
function Side({
  word,
  says,
  children,
}: {
  word: string
  says: string
  children: ReactElement | ReactElement[]
}) {
  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <p className="wf-heading wf-heading--flush" style={{ fontFamily: 'var(--face-ui)' }}>
        {word}
      </p>
      <Said>{says}</Said>
      {children}
    </section>
  )
}

/* The counts the first screen opens with, so the type is judged on the words
   somebody actually reads. They are labels here and targets there: this page
   is about a typeface and nothing on it goes anywhere. */
const COUNTS = [
  { n: '6', word: 'ready to shelve' },
  { n: '3', word: 'to carry' },
  { n: '3', word: 'stuck' },
]

/**
 * The face question, drawn rather than argued.
 *
 * The owner did not like the counts on the first screen: "I think it needs to
 * be more rounded or something and more playful." Both answers are below, the
 * same three counts twice, so the choice is made by looking at a phone rather
 * than by reading a paragraph about type.
 *
 * The serif version is the one that shipped last round, and it is drawn by
 * pointing `--face-display` at the book face for that block alone, which is
 * exactly the one-line change it would take to go back.
 */
function Type(go: Go) {
  return (
    <Specimen
      title="Which face for the counts"
      note="The same three counts, twice. Everything else on this page is unchanged."
      go={go}
    >
      <Side word="Rounded" says="What this round ships. The book face stays on titles and authors.">
        <Stats items={COUNTS} />
      </Side>

      <Side word="The book serif" says="What last round shipped, and the one he stopped at.">
        <div style={{ '--face-display': 'var(--face-book)' } as CSSProperties}>
          <Stats items={COUNTS} />
        </div>
      </Side>

      <Card kind="Where the serif stays" title="Never Let Me Go">
        <p>
          Ishiguro, Kazuo. A title and an author are what a reader is looking for,
          and the serif is right for them either way. This card is unchanged.
        </p>
      </Card>

      <Card weight="quiet" title="On a phone, not on a desk">
        <p>
          The rounded face resolves to SF Pro Rounded on iOS and to whatever a
          desktop has, which is usually nothing rounded at all. Judge this one on
          the phone.
        </p>
      </Card>
    </Specimen>
  )
}

/** Thirty books, which is what a real plank holds. */
const THIRTY = spines([
  'Adams, Douglas',
  'Atwood, Margaret',
  'Banks, Iain M.',
  'Bradbury, Ray',
  'Calvino, Italo',
  'Chambers, Becky',
  'Clarke, Susanna',
  'Eco, Umberto',
  'Ellison, Ralph',
  'Ferrante, Elena',
  'Gaiman, Neil',
  'Greene, Graham',
  'Harkaway, Nick',
  'Ishiguro, Kazuo',
  'Jemisin, N. K.',
  'Le Guin, Ursula K.',
  'Mantel, Hilary',
  'Miéville, China',
  'Mitchell, David',
  'Morrison, Toni',
  'Murakami, Haruki',
  'Nabokov, Vladimir',
  "O'Brian, Patrick",
  'Pratchett, Terry',
  'Robinson, Marilynne',
  'Smith, Zadie',
  'Stephenson, Neal',
  'Tartt, Donna',
  'Woolf, Virginia',
  'Zusak, Markus',
])

/**
 * How tall a spine may honestly be, drawn both ways.
 *
 * The catalogue holds `pages` and no height at all, so width is the dimension
 * that can be told the truth about. `Shelf.tsx` explains both answers; this is
 * where they sit next to each other on the same thirty books.
 */
function Spines(go: Go) {
  return (
    <Specimen
      title="How big is a book"
      note="The same thirty books twice. Both draw width from the page count, which is the one measurement we hold."
      go={go}
    >
      <Side
        word="Flat tops"
        says="Width from the page count, every book the same height. Nothing here is invented."
      >
        <div className="wf-bleed">
          <Shelf label="2C" note="30 books" items={THIRTY} />
        </div>
      </Side>

      <Side
        word="Varied tops"
        says="Height estimated from the shape of the spine photograph. Truthful in proportion, and only as good as the crop."
      >
        <div className="wf-bleed">
          <Shelf label="2C" note="30 books" items={THIRTY} heights="photograph" />
        </div>
      </Side>

      <Card kind="What is real here" title="Pages are thickness, not height">
        <p>
          A page count is a real measurement of how thick a book is, so a fatter
          book is drawn wider and it always will be. Nothing in the catalogue says
          how tall a book is.
        </p>
      </Card>

      <Card weight="quiet" title="What the second one is guessing">
        <p>
          A spine photograph has a true shape but no scale, so its height is an
          estimate built on the thickness above, and it is clamped so a bad crop
          cannot draw a book the height of the screen.
        </p>
      </Card>
    </Specimen>
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
  { id: 'furniture', name: 'Your bookcases', group: 'Your furniture', render: Furniture },
  { id: 'bookcase', name: 'One bookcase', group: 'Your furniture', render: Bookcase },
  { id: 'area', name: 'One area', group: 'Your furniture', render: Area },
  { id: 'addarea', name: 'Adding an area', group: 'Your furniture', render: AddArea },
  { id: 'belongs', name: 'What belongs here', group: 'Your furniture', render: Belongs },
  { id: 'sorting', name: 'How an area is ordered', group: 'Your furniture', render: Sorting },
  { id: 'claimed', name: 'Why a book is here', group: 'Your furniture', render: Claimed },
  { id: 'carry', name: 'Books to carry', group: 'Putting things right', render: Carry },
  { id: 'move', name: 'Move non-fiction', group: 'Putting things right', render: Move },
  { id: 'plan', name: 'The plan', group: 'Putting things right', render: Plan },
  { id: 'type', name: 'Which face for the counts', group: 'Two to choose between', render: Type },
  { id: 'spines', name: 'How big is a book', group: 'Two to choose between', render: Spines },
]

export const GROUPS = [
  'Every day',
  'Finding a book',
  'Cataloguing',
  'Your furniture',
  'Putting things right',
  'Two to choose between',
]
