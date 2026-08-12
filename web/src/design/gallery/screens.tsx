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
import { Button, Field, Segmented } from '../Controls'
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
  { id: 'carry', name: 'Books to carry', group: 'Putting things right', render: Carry },
  { id: 'move', name: 'Move non-fiction', group: 'Putting things right', render: Move },
  { id: 'plan', name: 'The plan', group: 'Putting things right', render: Plan },
  { id: 'type', name: 'Which face for the counts', group: 'Two to choose between', render: Type },
  { id: 'spines', name: 'How big is a book', group: 'Two to choose between', render: Spines },
]

export const GROUPS = [
  'Every day',
  'Cataloguing',
  'Putting things right',
  'Two to choose between',
]
