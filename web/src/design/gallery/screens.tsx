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
 */

import type { ReactElement } from 'react'
import { Card, Confirmation, Instruction, Nothing, Said } from '../Card'
import { Cat } from '../Cat'
import { Button, Field, Segmented } from '../Controls'
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
        eyebrow="Next"
        title="Photograph a book"
        foot={
          <Button tone="primary" block onPress={() => go('camera')}>
            Open the camera
          </Button>
        }
      >
        <p>Spine first, then the front. It reads the barcode while you hold it.</p>
      </Card>

      <Card eyebrow="Waiting" title="Six are ready to shelve">
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

      <Card eyebrow="Needs attention" title="Three books to carry">
        <p>
          Marking 2C full pushed a run along. They are still recorded where they were.
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

  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Library" sub="1,204 books" action={{ word: 'Find', onPress: () => go('find') }} />}
    >
      <Segmented
        label="Which range"
        on="fiction"
        options={[
          { value: 'fiction', word: 'Fiction' },
          { value: 'nonfiction', word: 'Non-fiction' },
        ]}
      />

      <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
        <p className="wf-heading">Bookcase 1</p>
        <Shelf label="1A" note="7 books, 2 areas" items={one} />
        <p className="wf-heading">Bookcase 2</p>
        <Shelf label="2C" note="8 books" items={two} />
      </div>

      <Card weight="quiet">
        <p>
          Tap a spine to open the book. The cat marks where a run ends.
        </p>
      </Card>
    </Phone>
  )
}

function Book(go: Go) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    { kind: 'spine', text: 'Ishiguro, Kazuo', cloth: 'moss', here: true },
    ...spines(['Mitchell, David', 'Morrison, Toni'], 3),
  ]

  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Never Let Me Go" sub="Ishiguro, Kazuo" onBack={() => go('library')} action={{ word: 'Edit' }} />}
    >
      <Card>
        <Tags>
          <Tag tone="fiction">Fiction</Tag>
          <Tag>Bookcase 2</Tag>
          <Tag>Area C</Tag>
        </Tags>
        <p>
          Faber, 2005. Files under <strong>Ishiguro, Kazuo</strong>. ISBN 9780571224142.
        </p>
      </Card>

      <div className="wf-bleed">
        <Shelf label="2C" note="Third along" items={row} />
      </div>

      <Card
        weight="sunk"
        eyebrow="Where it is"
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
      <Card eyebrow="Found in Open Library" title="Never Let Me Go">
        <p>Ishiguro, Kazuo &middot; Faber &middot; 2005</p>
      </Card>

      <Field label="Title" value="Never Let Me Go" />
      <Field label="Author" value="Kazuo Ishiguro" />
      <Field label="Files under" value="Ishiguro, Kazuo" />
      <Field label="Series" placeholder="Not in a series" />

      <div>
        <span className="wf-field__label">Range</span>
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

      <Card weight="quiet" eyebrow="Still waiting" title="Seventeen in the queue">
        <p>Five of them are ready to shelve in one tap.</p>
      </Card>
    </Phone>
  )
}

function Queue(go: Go) {
  return (
    <Phone tab="queue" go={go} top={<TopBar title="Queue" sub="18 books on the table" />}>
      <Segmented
        label="Which ones"
        on="ready"
        options={[
          { value: 'ready', word: 'Ready 6' },
          { value: 'reading', word: 'Reading 9' },
          { value: 'stuck', word: 'Stuck 3' },
        ]}
      />

      <List label="Ready to shelve">
        <Row title="Never Let Me Go" sub="Ishiguro, Kazuo" cloth="moss" place="2C" onPress={() => go('review')} />
        <Row title="Cloud Atlas" sub="Mitchell, David" cloth="sky" place="2C" onPress={() => go('review')} />
        <Row title="Underland" sub="Macfarlane, Robert" cloth="wood" place="4A" onPress={() => go('review')} />
        <Row title="Piranesi" sub="Clarke, Susanna" cloth="plum" place="1B" onPress={() => go('review')} />
      </List>

      <Card eyebrow="Stuck" title="Three need a hand">
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
      <Card weight="sunk">
        <p>
          These are recorded where they used to be. Carry each one and say it landed.
        </p>
      </Card>

      <List label="Books to carry">
        <Row title="Guards! Guards!" sub="Pratchett, Terry" cloth="sun" meta="2C to 2D" onPress={() => go('where')} />
        <Row title="Snow Crash" sub="Stephenson, Neal" cloth="sky" meta="2C to 2D" onPress={() => go('where')} />
        <Row title="The Book Thief" sub="Zusak, Markus" cloth="plum" meta="2D to 3A" onPress={() => go('where')} />
      </List>

      <Button tone="primary" block onPress={() => go('where')}>
        Start with the first one
      </Button>

      <Card weight="quiet" eyebrow="Not on this list" title="Two books are checked out">
        <p>They are not on a bookcase, so there is nothing to disagree with.</p>
      </Card>
    </Phone>
  )
}

function Run(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Move non-fiction" onBack={() => go('library')} />}
    >
      <Card eyebrow="Where it lives now" title="Bookcase 4">
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

      <Card weight="sunk">
        <p>
          The run takes its own cuts with it, so the same books land together and
          nothing has to be worked out about capacity.
        </p>
      </Card>

      <Button tone="primary" block onPress={() => go('plan')}>
        Show me the plan
      </Button>
      <Said>Planning writes nothing. You can change your mind about the number.</Said>
    </Phone>
  )
}

function Plan(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="The plan" sub="50 books to carry" onBack={() => go('run')} />}
    >
      <Card eyebrow="What would happen" title="Bookcase 4 to bookcase 3">
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

      <Card eyebrow="Left alone" title="Four books">
        <p>One pinned. Two checked out. One never confirmed onto a bookcase.</p>
      </Card>

      <Card weight="quiet">
        <p>
          Applying this writes down where each book belongs. It does not move any
          book: they move when you carry them.
        </p>
      </Card>

      <Button tone="primary" block onPress={() => go('carry')}>
        Apply it
      </Button>
      <Button tone="quiet" block onPress={() => go('run')}>
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
  { id: 'run', name: 'Move a run', group: 'Putting things right', render: Run },
  { id: 'plan', name: 'The plan', group: 'Putting things right', render: Plan },
]

export const GROUPS = ['Every day', 'Cataloguing', 'Putting things right']
