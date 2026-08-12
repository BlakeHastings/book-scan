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
import { Card, Confirmation, Instruction, Nothing, Said } from '../Card'
import { Cat } from '../Cat'
import { Button, Choice, Field, Segmented } from '../Controls'
import { AddBox, AreaBox, Claim, Must, Musts, Nest, Order } from '../Furniture'
import { IconEdit, IconFind } from '../Icons'
import { List, Place, Row, Stats, Tag, Tags } from '../List'
import { Shelf, spines, type ShelfItem } from '../Shelf'
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
    find: 'find',
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

function Home(go: Go) {
  return (
    <Phone tab="home" go={go} top={<TopBar title="Book scan" sub="1,204 books on four bookcases" />}>
      <Card weight="sunk">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Cat pose="sitting" size={52} />
          <div>
            <p style={{ margin: 0, fontFamily: 'var(--face-book)', fontSize: 17 }}>
              Eighteen books are waiting on the table.
            </p>
            <Said>Nothing has gone missing since Tuesday.</Said>
          </div>
        </div>
      </Card>

      <Stats
        items={[
          { n: '1,204', word: 'catalogued' },
          { n: '18', word: 'in the queue' },
          { n: '3', word: 'to carry' },
        ]}
      />

      <Card
        kind="Next"
        title="Photograph a book"
        foot={
          <Button tone="primary" block onPress={() => go('camera')}>
            Open the camera
          </Button>
        }
      >
        <p>Spine first, then the front. It reads the barcode while you hold it.</p>
      </Card>

      <Card kind="Waiting" title="Six are ready to shelve">
        <List label="Ready to shelve">
          <Row
            title="Never Let Me Go"
            sub="Ishiguro, Kazuo"
            cloth="moss"
            meta="Ready"
            onPress={() => go('where')}
          />
          <Row
            title="The City &amp; the City"
            sub="Mi&eacute;ville, China"
            cloth="plum"
            meta="Ready"
            onPress={() => go('where')}
          />
        </List>
        <Button tone="quiet" onPress={() => go('queue')}>
          All eighteen
        </Button>
      </Card>

      <Card kind="Needs attention" title="Three books to carry">
        <p>
          Saying 2C was full moved these along. They are still recorded where they
          were.
        </p>
        <Button tone="secondary" onPress={() => go('carry')}>
          Show me
        </Button>
      </Card>
    </Phone>
  )
}

function Library(go: Go) {
  const one: ShelfItem[] = [
    ...spines(['Adams, Douglas', 'Atwood, Margaret', 'Banks, Iain M.', 'Bradbury, Ray']),
    { kind: 'divider' },
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
      <Segmented
        label="Fiction or non-fiction"
        on="fiction"
        options={[
          { value: 'fiction', word: 'Fiction' },
          { value: 'nonfiction', word: 'Non-fiction' },
        ]}
      />

      {/* No caption under these. There was one, saying you could tap a spine
          and what the cat meant, and it went: a shelf that has to be explained
          in a paragraph underneath it is a shelf that has not worked. */}
      <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
        <p className="wf-heading">Bookcase 1</p>
        <Shelf label="1A" note="7 books, 2 areas" items={one} />
        <p className="wf-heading">Bookcase 2</p>
        <Shelf label="2C" note="8 books" items={two} />
        <p className="wf-heading">Bookcase 4</p>
        <Shelf label="4A" note="6 books" items={three} />
      </div>

      <Card
        kind="Your furniture"
        title="Three bookcases and a crate"
        foot={
          <Button tone="secondary" block onPress={() => go('furniture')}>
            See the bookcases
          </Button>
        }
      >
        <p>Add one, divide it into areas, and say what belongs in each.</p>
      </Card>
    </Phone>
  )
}

function Book(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    { kind: 'spine', text: 'Ishiguro, Kazuo', cloth: 'moss', pages: 288, ratio: 8.5, here: true },
    ...spines(['Mitchell, David', 'Morrison, Toni'], 3),
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Never Let Me Go"
          sub="Ishiguro, Kazuo"
          onBack={() => go('library')}
          action={{ word: 'Edit', icon: <IconEdit /> }}
        />
      }
    >
      <Card>
        <Tags>
          <Tag tone="fiction">Fiction</Tag>
          <Tag>Bookcase 2</Tag>
          <Tag>Area C</Tag>
        </Tags>
        <p>
          Faber, 2005. 288 pages. Files under <strong>Ishiguro, Kazuo</strong>. ISBN
          9780571224142.
        </p>
      </Card>

      <div className="wf-bleed">
        <Shelf label="2C" note="Third along" items={row} />
      </div>

      <Card
        weight="sunk"
        kind="Where it is"
        title="On the bookcase, where it should be"
        foot={
          <>
            <Button tone="secondary">Check it out</Button>
            <Button tone="quiet" onPress={() => go('where')}>
              It moved
            </Button>
            <Button tone="quiet" onPress={() => go('claimed')}>
              Why it is here
            </Button>
          </>
        }
      >
        <p>Last confirmed there on 4 August.</p>
      </Card>
    </Phone>
  )
}

function Find(go: Go) {
  return (
    <Phone tab="find" go={go} top={<TopBar title="Find" />}>
      <Field label="Title, author or ISBN" value="le guin" />

      <List label="Results">
        <Row title="A Wizard of Earthsea" sub="Le Guin, Ursula K." cloth="sky" place="1C" onPress={() => go('book')} />
        <Row title="The Lathe of Heaven" sub="Le Guin, Ursula K." cloth="moss" place="1C" onPress={() => go('book')} />
        <Row title="The Left Hand of Darkness" sub="Le Guin, Ursula K." cloth="plum" place="1C" onPress={() => go('book')} />
        <Row title="The Dispossessed" sub="Le Guin, Ursula K." cloth="wood" meta="Checked out" onPress={() => go('book')} />
      </List>

      {/* Kept, and it is worth saying why when three cards like it went. This
          one is a fact about the answer, not an explanation of the screen. */}
      <Card weight="quiet" title="Nothing else under that name">
        <p>Four books, three of them together on 1C.</p>
      </Card>
    </Phone>
  )
}

/* --- Cataloguing --------------------------------------------------------- */

function Camera(go: Go) {
  return (
    <Phone
      tab="scan"
      go={go}
      top={<TopBar title="Photograph the book" sub="Spine, then the front" onBack={() => go('home')} />}
    >
      <div className="wf-cam">
        <div className="wf-cam__frame" />
        <p className="wf-cam__hint">Line the spine up inside the frame</p>
      </div>

      <Segmented
        label="Which photograph"
        on="spine"
        options={[
          { value: 'spine', word: 'Spine' },
          { value: 'front', word: 'Front' },
          { value: 'back', word: 'Back' },
        ]}
      />

      <button type="button" className="wf-shutter" aria-label="Take the photograph">
        <span className="wf-shutter__inner" />
      </button>

      <div className="wf-slots">
        <div className="wf-slot wf-slot--done">
          <span className="wf-slot__box" />
          <span>Spine</span>
        </div>
        <div className="wf-slot">
          <span className="wf-slot__box" />
          <span>Front</span>
        </div>
        <div className="wf-slot">
          <span className="wf-slot__box" />
          <span>Back</span>
        </div>
      </div>

      <Button tone="primary" block onPress={() => go('review')}>
        Done with this book
      </Button>
    </Phone>
  )
}

function Review(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Check the details" sub="Read off the barcode" onBack={() => go('queue')} />}
    >
      <Card kind="Found in Open Library" title="Never Let Me Go">
        <p>Ishiguro, Kazuo &middot; Faber &middot; 2005 &middot; 288 pages</p>
      </Card>

      <Field label="Title" value="Never Let Me Go" />
      <Field label="Author" value="Kazuo Ishiguro" />
      <Field label="Files under" value="Ishiguro, Kazuo" />
      <Field label="Series" placeholder="Not in a series" />

      <div>
        {/* Was "Range", which is `books.shelf_range` wearing a coat. */}
        <span className="wf-field__label">Fiction or non-fiction</span>
        <div style={{ height: 4 }} />
        <Segmented
          label="Fiction or non-fiction"
          on="fiction"
          options={[
            { value: 'fiction', word: 'Fiction' },
            { value: 'nonfiction', word: 'Non-fiction' },
          ]}
        />
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
      <Said>Both are on 2C. Third book along, counting from the left.</Said>

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
      >
        <p>
          If it will not go in, say so and the last book on 2C moves to 2D.
        </p>
      </Card>
    </Phone>
  )
}

function Done(go: Go) {
  return (
    <Phone tab="queue" go={go} top={<TopBar title="Shelved" />}>
      <Confirmation
        said="Never Let Me Go is on 2C."
        where="Third along, between The City &amp; the City and Cloud Atlas."
      />

      <Button tone="primary" block onPress={() => go('camera')}>
        Next book
      </Button>
      <Button tone="quiet" block onPress={() => go('home')}>
        That is enough for today
      </Button>

      <Card weight="quiet" kind="Still waiting" title="Seventeen in the queue">
        <p>Five of them are ready to shelve in one tap.</p>
      </Card>
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
        <p>
          Bookcase 1 is the one you reach first. Move a piece and everything on
          it is renamed with it, so 4A becomes 3A without a book leaving the
          room.
        </p>
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
      <Said>
        Tap the bookcase to say what belongs on the whole of it, or an area to
        say what belongs in that one.
      </Said>

      <Field label="What you call it" placeholder="Not named" />
      <Said>
        Without a name it is Bookcase 2, and the areas on it read 2A, 2B and 2C.
        Call it Landing and the same areas read Landing · A.
      </Said>

      <Field label="What it is" value="Bookcase" />
      <Said>
        Your word for it. A crate by the door and a windowsill are just as good,
        and nothing in the app treats one differently from another.
      </Said>

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
      <Said>
        Second of five. Moving it renumbers this piece and the one it passes,
        and every area on both of them.
      </Said>

      <Card weight="sunk" kind="What it will be called" title="2A, 2B, 2C">
        <p>
          Worked out from where the bookcase stands and what things are called,
          every time it is read. There is nothing to type here and nothing that
          can go stale.
        </p>
      </Card>

      <Button tone="primary" block onPress={() => go('furniture')}>
        Save
      </Button>

      <Card weight="quiet" kind="Taking it out of the room" title="The books do not vanish with it">
        <p>
          Books recorded on a bookcase that has gone still say where they were
          put, so they turn up in books to carry until you have moved them.
        </p>
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
      <Said>
        Yours to leave empty. Named, it reads 2 · Cookery; unnamed, it reads
        2C. Either way what you are naming is the area, never the label.
      </Said>

      <Card
        kind="What belongs here"
        title="Anything tagged Cookery"
        foot={
          <Button tone="secondary" block onPress={() => go('belongs')}>
            Change what belongs here
          </Button>
        }
      >
        <p>Eighteen books match it today, and one of them two rules wanted.</p>
      </Card>

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

      <Card weight="quiet" kind="Taking this area away" title="What it held becomes part of the one before">
        <p>
          Books put here still say they are here, so they turn up in books to
          carry until you have moved them.
        </p>
      </Card>
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
      <Said>
        It starts at the book you pick, and everything from there on belongs to
        it. That is the one thing an area is: the book its stretch begins at.
      </Said>

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

      <Card weight="sunk" kind="What it does" title="Cookery keeps 11 books, the new one takes 7">
        <p>
          The new one reads 2D, because it is fourth on this bookcase. Had
          there been an area after it, that one would read 2E from today, and
          every book on it would say 2E too: a label is worked out fresh each
          time it is read rather than written down anywhere.
        </p>
      </Card>

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
      <Said>
        Every line has to be true of a book before this rule takes it. If you
        want one thing or the other, that is a second rule, and two rules you
        can read beat one you cannot.
      </Said>

      <Card kind="When two rules want the same book" title="The one about the smaller place wins">
        <p>
          Bookcase 2 has a rule of its own, and this one is about a single area
          on it. A rule about one area beats a rule about a whole bookcase. Two
          rules about the same place are read from the top, and the first one to
          fit takes the book.
        </p>
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

      <Card weight="quiet" kind="Claimed by nothing" title="Three books match no rule at all">
        <p>
          They stay where they are and the plan says so, rather than being filed
          somewhere nobody asked for.
        </p>
      </Card>

      <Button tone="primary" block onPress={() => go('plan')}>
        Show me what would move
      </Button>
      <Said>Nothing is written until you say so on the next screen.</Said>
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
      <Card weight="sunk" kind="Right now" title="By the author’s surname">
        <p>
          2C takes its order from bookcase 2, and bookcase 2 takes it from the
          whole library. Change it once there and everything that has not
          chosen for itself changes with it.
        </p>
      </Card>

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

      <Card kind="If you choose one here" title="2C becomes a place of its own">
        <p>
          Books stop flowing into it from the area before, because a stretch of
          books can only carry on across two places if both are ordered the
          same way. From then on 2C holds what its own rule sends it and
          nothing else.
        </p>
      </Card>

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
          <Tag tone="nonfiction">Non-fiction</Tag>
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

      <Card weight="quiet" kind="Not on this list" title="Two books are checked out">
        <p>They are not on a bookcase, so there is nothing to disagree with.</p>
      </Card>
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
      <Said>Nothing is written until you say so.</Said>
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

      {/* Not a caption: this is the difference between the plan and the
          carrying, and it is the one thing somebody could get wrong here. */}
      <Card weight="quiet">
        <p>
          This writes down where each book belongs. It does not move any book: they
          move when you carry them.
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
      <Nothing said="The table is clear.">
        <p>Photograph a book and it turns up here.</p>
      </Nothing>
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

const COUNTS = [
  { n: '1,204', word: 'catalogued' },
  { n: '18', word: 'in the queue' },
  { n: '3', word: 'to carry' },
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
  { id: 'library', name: 'Library', group: 'Every day', render: Library },
  { id: 'book', name: 'A book', group: 'Every day', render: Book },
  { id: 'find', name: 'Find', group: 'Every day', render: Find },
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
  'Cataloguing',
  'Your furniture',
  'Putting things right',
  'Two to choose between',
]
