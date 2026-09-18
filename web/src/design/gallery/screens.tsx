/**
 * The screens, drawn with the component library and nothing else.
 *
 * Static content: nothing here fetches, and no screen holds state beyond
 * what the gallery hands it.
 *
 * A person owns bookcases, each holding areas, each holding books; they do
 * not own runs, ranges, planks, separators, sort keys or captures.
 * `design.test.tsx` pins the vocabulary list, so a screen cannot
 * reintroduce one of those words.
 */

import type { ReactElement, ReactNode } from 'react'
import { Actions, Amiss, Head, Part, Tagged, Tagging, Where } from '../Book'
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
import { WaitingList, WayIn } from '../Gate'
import { signInTroubleSaid } from '../../lib/signInWords'
import { CANNOT_REACH } from '../../lib/reachWords'
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

export type Go = (screen: string) => void

export interface Screen {
  id: string
  name: string
  group: string
  render: (go: Go) => ReactElement
}

/**
 * The corner shown on the screens with no back arrow: the one action such
 * a screen offers. Written once because six screens use it identically.
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
 * Exported so `design.test.tsx` can check a screen's doors against this
 * table rather than a copy of it.
 */
export const TAB_SCREENS: Record<TabName, string> = {
  home: 'home',
  library: 'library',
  scan: 'camera',
  queue: 'queue',
}

function Phone({
  children,
  tab,
  go,
  top,
  over,
}: {
  /*
   * `ReactNode`, not a narrower type: children sometimes include
   * `undefined` when a screen only conditionally renders something, and
   * the frame handles that.
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

function Home(go: Go, over?: ReactElement, trouble?: ReactElement) {
  return (
    <Phone
      tab="home"
      go={go}
      over={over}
      top={<TopBar title="Book scan" action={you(go, over !== undefined)} />}
    >
      {trouble}

      <Stats
        items={[
          { n: '1,204', word: 'catalogued', onPress: () => go('library') },
          { n: '2', word: 'checked out', onPress: () => go('listing') },
          { n: '6', word: 'ready to shelve', onPress: () => go('queue') },
          { n: '53', word: 'to carry', onPress: () => go('carry') },
          { n: '3', word: 'stuck', onPress: () => go('queue') },
        ]}
      />

      <Doors cat="lying">
        <InHand onPress={() => go('inhand')} />
        <CarryBooks onPress={() => go('carry')} />
        <SayWhat onPress={() => go('unclaimed')} />
      </Doors>
    </Phone>
  )
}

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

function Adrift(go: Go) {
  return Home(
    go,
    undefined,
    <Trouble
      kind="Where books stand"
      title="Twelve books are drawn in one place and claimed by another"
    >
      Your bookcases and the rules that file books into them no longer agree
      about where these go, so neither answer can be trusted. Nothing has been
      moved and nothing will be: this is never repaired, because a repair would
      erase how it happened. They are named in your library, under "Books that
      are not where they should be".
    </Trouble>,
  )
}

function Unanswered(go: Go) {
  return (
    <Phone
      tab="home"
      go={go}
      top={<TopBar title="Book scan" action={you(go)} />}
    >
      <Trouble kind="Counts" title={CANNOT_REACH.title}>{CANNOT_REACH.said}</Trouble>
    </Phone>
  )
}

/**
 * Which of the three views a library screen is drawing.
 *
 * The control never says "spines" to the person using it: covers, a list,
 * and the books standing up.
 */
type View = Look

const VIEW_SCREENS: Record<View, string> = {
  covers: 'covers',
  list: 'listing',
  spines: 'library',
}

/**
 * What every library screen wears above its books, which is `Filter`.
 *
 * See `Finding.tsx` for the row itself. Here, picking a view walks to
 * another screen; in the app it redraws in place.
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
 * One row is one area: an area is never split by a divider inside a row.
 *
 * The label is derived and never stored: the piece's name and the area's
 * position, `1A` then `1B`. `design.test.tsx` pins this.
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

      <div className="wf-bleed" style={{ display: 'grid', gap: 20 }}>
        <p className="wf-heading">Bookcase 1</p>
        <Shelf label="1A" note="4 books" items={oneA} />
        <Shelf label="1B" note="3 books" items={oneB} />
        <p className="wf-heading">Bookcase 2</p>
        <Shelf label="2C" note="8 books" items={two} />
        <p className="wf-heading">Bookcase 4</p>
        <Shelf label="4A" note="6 books" items={three} />
      </div>

      <div className="wf-under">
        {/* Not "see the bookcases": the furniture screen also holds
            pieces that are not bookcases, like a crate and a desk. */}
        <Button tone="quiet" onPress={() => go('furniture')}>
          See your fixtures
        </Button>
      </div>
    </Phone>
  )
}

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

      <Covers items={some} label="Books tagged Fantasy and Lent out" onPress={() => go('book')} />
    </Phone>
  )
}

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

/**
 * Never gendered: the catalogue holds no gender field for an author, so
 * this says "theirs", not "hers".
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

      {/* "It moved" and "Move it" are deliberately absent: a book nobody
          has placed anywhere has not moved. */}
      <Actions>
        <Button tone="secondary" small onPress={() => go('where')}>
          Put it back
        </Button>
        <Button tone="quiet" small>
          Say what it is
        </Button>
      </Actions>

      <Where>
        {/* Wrapped: a grid section stretches what's inside it, so
            without this the label would stretch to the full width. */}
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

function Details({ go, amiss = false, out = false }: {
  go: Go
  /** The order wants it somewhere else. */
  amiss?: boolean
  /** It is off the bookcase entirely, so it stands in no row. */
  out?: boolean
}) {
  const row: ShelfItem[] = [
    ...spines(['Mantel, Hilary', 'Miéville, China']),
    amiss
      ? { kind: 'gap' }
      : {
          kind: 'spine',
          text: 'Ishiguro, Kazuo',
          cloth: 'moss',
          pages: 288,
          here: true,
        },
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
          onBack={() => go('book')}
        />
      }
    >
      {amiss && <Amiss onPress={() => go('where')} />}

      {/* Never both at once: a book that is out of the house holds no
          shelf position for `amiss` to disagree with. */}
      {out && (
        <Card weight="quiet" title="Off the bookcase">
          <p>
            Checked out on 4 August. Nothing is filed next to it, and the
            bookcase has closed up behind it.
          </p>
        </Card>
      )}

      <Head
        title="Never Let Me Go"
        by="Kazuo Ishiguro"
        shots={[
          { word: 'Front', cloth: 'moss' },
          { word: 'Spine', cloth: 'moss', sliver: true },
          { word: 'Back', cloth: 'moss' },
          { word: 'Downloaded', cloth: 'sky', catalogue: true },
        ]}
        facts={[
          'Faber, 2005. 288 pages.',
          'ISBN 9780571224142',
          'Files under Ishiguro, Kazuo',
        ]}
        tags={
          <Tagging>
            <Tagged word="Fiction" from="catalogue" who="Open Library says so" />
            <Tagged word="Science fiction" from="person" who="You said so, on 9 July" />
          </Tagging>
        }
      />

      <Actions>
        {out ? (
          <Button tone="secondary" small onPress={() => go('where')}>
            Check it in
          </Button>
        ) : (
          <Button tone="secondary" small>
            Check it out
          </Button>
        )}
        <Button tone="quiet" small>
          Edit the details
        </Button>
        <Button tone="quiet" small onPress={() => go('library')}>
          Back to the library
        </Button>
      </Actions>

      <Where>
        {out ? (
          <div>
            <Place quiet>Out of the house</Place>
          </div>
        ) : (
          <div className="wf-bleed">
            <Shelf label="2C" items={row} />
          </div>
        )}
      </Where>

      <Button tone="danger" block>
        Delete this book and its photos
      </Button>
    </Phone>
  )
}

const BookDetails = (go: Go) => <Details go={go} />
const BookAmiss = (go: Go) => <Details go={go} amiss />
const BookOut = (go: Go) => <Details go={go} out />

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
 * Demonstrates diacritic-insensitive search: "mieville" (no accent) must
 * still match "Miéville".
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
 * The hierarchy is said in words ("under Fantasy, under Genre"), never as
 * the stored slug.
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

      <Covers items={TWELVE.slice(0, 6)} label="Every book" onPress={() => go('book')} />
    </Phone>
  )
}

/**
 * Tags form a hierarchy stored in the slug, Obsidian style; see
 * docs/data-model.md.
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

function shotsOf(go: Go): Shot[] {
  return [
    { word: 'Spine', cloth: 'moss', sliver: true, onPress: () => go('spine') },
    { word: 'Front', cloth: 'wood', onPress: () => go('camera') },
    { word: 'Back', next: true, onPress: () => go('camera') },
  ]
}

function spineFirst(go: Go): Shot[] {
  return [
    { word: 'Spine', next: true, sliver: true, onPress: () => go('spine') },
    { word: 'Front', onPress: () => go('camera') },
    { word: 'Back', onPress: () => go('camera') },
  ]
}

function detailSlots(go: Go, downloaded?: Cloth) {
  return threeSlots(
    { word: 'Spine', cloth: 'moss', sliver: true, onPress: () => go('spine') },
    /* Not pressable: it's the publisher's picture of the edition, not a
       photo of this copy, so there's no shutter to retake it. Change it
       via the ISBN field. */
    { word: 'Downloaded', catalogue: true, cloth: downloaded },
    [
      { word: 'Front', cloth: 'wood', onPress: () => go('camera') },
      { word: 'Back', next: true, onPress: () => go('camera') },
    ],
  )
}

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

function CameraOnAPage(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={shotsOf(go)}
        picture={<div className="wf-view__picture wf-view__picture--page" aria-hidden="true" />}
        said={inHand}
        also={nextBook(go)}
        onLeave={() => go('home')}
        onDone={() => go('review')}
      />
    </div>
  )
}

function CameraOnACover(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={shotsOf(go)}
        picture={<div className="wf-view__picture wf-view__picture--cover" aria-hidden="true" />}
        said={inHand}
        also={nextBook(go)}
        onLeave={() => go('home')}
        onDone={() => go('review')}
      />
    </div>
  )
}

const AIMING = (
  <div className="wf-view__picture wf-view__picture--held" aria-hidden="true" />
)

/**
 * The frame modifier goes through `over`, not `guide`: `guide` is the crop
 * the camera will keep, `over` is the region past the controls.
 * `FrameScreen` is the one exception, using `guide` on purpose because it
 * measures the frame against the whole screen.
 */
function aimedWith(guide: string) {
  return (go: Go) => (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={shotsOf(go)}
        picture={AIMING}
        guide={<></>}
        over={<div className={`wf-view__guide${guide}`} aria-hidden="true" />}
        said={inHand}
        also={nextBook(go)}
        onLeave={() => go('home')}
        onDone={() => go('review')}
      />
    </div>
  )
}

/* The shipped rule: no modifier, named rather than left out so it doesn't
   read as a missing candidate. */
const FrameKeyline = aimedWith('')
const FrameNow = aimedWith(' wf-view__guide--now')
const FrameDark = aimedWith(' wf-view__guide--dark')
const FrameDim = aimedWith(' wf-view__guide--dim')

const FrameScreen = (go: Go) => (
  <div className="wf-screen wf-screen--camera">
    <Viewfinder
      shots={shotsOf(go)}
      picture={AIMING}
      guide={<div className="wf-view__guide wf-view__guide--screen" aria-hidden="true" />}
      said={inHand}
      also={nextBook(go)}
      onLeave={() => go('home')}
      onDone={() => go('review')}
    />
  </div>
)

const FrameBar = aimedWith('')

const inHand = (
  <p className="wf-view__found">
    <strong>The Left Hand of Darkness</strong>
    {' · Ursula K. Le Guin'}
  </p>
)

const nextBook = (go: Go) => ({ word: 'Next book 2/3', onPress: () => go('camera') })

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

function InHandCamera(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={[]}
        top={<span className="wf-view__chip">Hold a book up</span>}
        onShutter={() => go('book')}
        shutterName="Find this book"
        onLeave={() => go('home')}
        onDone={() => go('home')}
        done="Done"
      />
    </div>
  )
}

function InHandCameraSaying(go: Go) {
  return (
    <div className="wf-screen wf-screen--camera">
      <Viewfinder
        shots={[]}
        top={<span className="wf-view__chip">Hold a book up</span>}
        onShutter={() => go('book')}
        shutterName="Find this book"
        said={
          <p className="wf-view__found">
            9780441013593 is not in the library yet. Add it first.
          </p>
        }
        onLeave={() => go('home')}
        onDone={() => go('home')}
        done="Done"
      />
    </div>
  )
}

/**
 * Fiction and non-fiction are one question with two answers, at most one
 * true; every other tag is a set added to freely. Both draw as one row.
 */
function reviewTags(go: Go, mine: string[] = []) {
  return (
    <div>
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

function reviewScreen(go: Go, mine: string[], over?: ReactElement) {
  return (
    <Phone
      tab="queue"
      go={go}
      over={over}
      top={<TopBar title="Check the details" sub="Read off the barcode" onBack={() => go('queue')} />}
    >
      <Shots {...detailSlots(go, 'sky')} act size="big" />

      <Card kind="Found in Open Library" title="Never Let Me Go">
        <p>Ishiguro, Kazuo &middot; Faber &middot; 2005 &middot; 288 pages</p>
      </Card>

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

/**
 * Tags show their word and count, never their slug: `design.test.tsx`
 * refuses a screen that draws one.
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

      <Make name="Comic" where="Subject" onPress={() => go('review')} />
    </Naming>,
  )
}

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

function ReviewNone(go: Go) {
  return (
    <Phone
      tab="queue"
      go={go}
      top={<TopBar title="Check the details" sub="Typed in by hand" onBack={() => go('queue')} />}
    >
      <Shots {...detailSlots(go)} act size="big" />

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

      <div>
        <span className="wf-field__label">Tags</span>
        <div style={{ height: 6 }} />
        <Tags>
          <AddTag onPress={() => go('naming')}>Add a tag</AddTag>
        </Tags>
      </div>

      {/* No tooltip: this is a phone, there is no hover, so the reason
          goes under the button instead. */}
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
 * Where one book goes, which is the same three things whatever put the
 * book in somebody's hand.
 *
 * Shared between the carry flow and initial shelving so they cannot drift
 * apart: do not add something to one call site without the other.
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

function queued(cloth: Cloth, spine: Cloth = 'wood'): Shot[] {
  return [
    { word: 'Spine', cloth: spine, sliver: true },
    { word: 'Front', cloth },
  ]
}

/** The app's real row is this plus a swipe gesture, not drawn here. */
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

/**
 * The menu the corner opens, over the screen it was opened from.
 *
 * The two counts here must read exactly as their destination screens do,
 * word for word, so the two do not drift out of agreement.
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
      /* This is the only line in the app that says which person's books
         are being shown, which matters on a shared machine. */
      out={{ word: 'Sign out', note: 'alex@example.com', onPress: () => go('wayin') }}
      onClose={() => go('home')}
    />,
  )
}

/**
 * Settings, which is two answers this app already holds and had nowhere
 * to ask for: how books are ordered
 * (`collection.default_sort_strategy`) and which hand holds the phone.
 *
 * Everything else considered (day and night, backup and export, a
 * collection name, an account) is deliberately left off: each already has
 * a home elsewhere or nothing real behind it.
 */
function SettingsScreen(go: Go) {
  return (
    <Phone tab="home" go={go} top={<TopBar title="Settings" onBack={() => go('menu')} />}>
      <div>
        <span className="wf-field__label">How your books are ordered</span>
        <div style={{ height: 6 }} />
        {/* Same four answers as the area's ordering screen, minus "the
            way it does" (nothing above a collection to defer to), kept
            in the same words so the two do not drift. */}
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
      {/* This sentence is what makes it a setting rather than a
          preference: it's the default every area and piece falls back to
          until it is given its own answer. */}
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

interface Place {
  reads: string
  books: number
  holds: string
}

/*
 * A named piece renames its areas too: "By the window · A", not "1A".
 * See docs/data-model.md.
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
 * A desk demonstrates that areas are chosen by a person, not read off the
 * carpentry: one top, split into two areas by where things sit on it.
 */
const AREAS_5: Place[] = [
  { reads: 'Desk · Left side', books: 6, holds: 'Put here by hand' },
  { reads: 'Desk · Right side', books: 4, holds: 'Put here by hand' },
]

/*
 * An unnamed piece is drawn as what it is and where it stands (see
 * `pieceSaid`), not as "Not named".
 */
const ROOM = [
  { name: 'By the window' },
  { name: 'Bookcase 2' },
  { name: 'The landing' },
  { name: 'Hall crate' },
  { name: 'Desk' },
]

/**
 * Demonstrates that the three orderings (surname, title, year) sort this
 * data in visibly different ways.
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
 * The second column shows the author when the first is the title, so
 * title order does not print the same string twice.
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
 * Written out rather than derived from `COOKERY`: that sample has six
 * books, but the area holds eighteen, so the two ends are not `COOKERY`'s
 * ends.
 */
const COOKERY_ENDS: Record<'who' | 'title' | 'year', OrderEnds> = {
  who: { first: 'Acton, Eliza', last: 'Slater, Nigel' },
  title: { first: 'A Book of Mediterranean Food', last: 'The Vegetarian Epicure' },
  year: { first: '1845', last: '2017' },
}

const PIECE_ENDS: Record<'who' | 'year', OrderEnds> = {
  who: { first: 'Acton, Eliza', last: 'Woolf, Virginia' },
  year: { first: '1845', last: '2021' },
}

/**
 * Filing names, since that's what's printed on a spine; the app draws
 * this board from `authorFiling` for the same reason.
 */
const COOKERY_BOARD = [
  'Acton, Eliza', 'Beeton, Isabella', 'Blumenthal, Heston', 'Child, Julia',
  'David, Elizabeth', 'Dahl, Sophie', 'Fisher, M. F. K.', 'Grigson, Jane',
  'Hopkinson, Simon', 'Lawson, Nigella', 'Locatelli, Giorgio', 'McGee, Harold',
  'Nosrat, Samin', 'Ottolenghi, Yotam', 'Roden, Claudia', 'Rogers, Ruth',
  'Slater, Nigel', 'Smith, Delia',
]

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

      {/* A piece whose areas have all been carried off: gone areas draw
          outlined rather than filled, and the count is what's actually
          standing there. */}
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

      {/* Never "add a bookcase": pieces are called what they are (a desk,
          a crate), and the generic action says "fixture" since it does
          not assume a shape. */}
      <Button tone="primary" block onPress={() => go('bookcase')}>
        Add a fixture
      </Button>
      <Button tone="quiet" block onPress={() => go('bookcase')}>
        Change the order
      </Button>
    </Phone>
  )
}

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
      <Field label="What you call it" placeholder="Not named" />

      <Field label="What it is" value="Bookcase" />

      <div>
        <span className="wf-field__label">Where it stands</span>
        <div style={{ height: 6 }} />
        <Order slots={ROOM.map((slot) => ({ ...slot, on: slot.name === 'Bookcase 2' }))} />
      </div>

      <Card weight="sunk" kind="What it will be called" title="2A, 2B, 2C" />

      <Button tone="primary" block onPress={() => go('furniture')}>
        Save
      </Button>

      {/* A piece's rule inherits from the whole library, not from
          anything above it; and there is no "overflow from before it"
          here, since books flow along a piece rather than between
          pieces. */}
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

      <SortRule
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

      {!writing && <MoveBooks onPress={() => go('move')} />}

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
 * A piece's rule is where a stretch of books begins and carries through
 * every area after it, so it's a bigger change than an area's own rule;
 * the line under the editor says so.
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
 * Five options, so they stack rather than sit in a segmented control
 * (which stops working past four). The "inherit" wording is
 * parameterized because an area inherits from its piece and a piece from
 * the library, and neither sentence fits the other.
 */
const ORDERINGS = (from: string) => [
  { value: 'inherit', word: `The way ${from} does`, sub: 'By the author today' },
  { value: 'author', word: 'By the author' },
  { value: 'title', word: 'By the title' },
  { value: 'published', word: 'By the year it came out' },
  { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
]

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
   * Whether the door to move a stretch of books elsewhere is drawn.
   *
   * Off when the rule is about one area, not a whole run: a shelf
   * holding no books gets no such offer.
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
  /** The books standing here, drawn as the shelf board rather than a list. */
  board?: ShelfItem[]
  /** An area somebody has cleared and written a rule for, holding nothing. */
  empty?: boolean
  /** A second sort-rule drawing shown beside the first, for direct comparison. */
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

      {(board || empty) && (
        <div className="wf-bleed">
          {/* No count here: the bar above already gives it. "Empty" must
              come from the area's own state, not from an empty list,
              since a list is also empty mid-load. */}
          <Shelf label={label} note={empty ? 'Empty' : undefined} items={board ?? []} />
        </div>
      )}

      {!writing && !would && !done && (
        <MoveBooks
          onPress={rules?.length && retarget ? () => go('move') : undefined}
          refused={refused}
        />
      )}

      <Button tone="danger" block onPress={() => go('removearea')}>
        Remove this area
      </Button>
    </Phone>
  )
}

const COOKERY_RULE = {
  name: 'Cookery',
  lines: [
    { operator: 'is' as const, tag: 'Non-fiction', carried: 412 },
    { operator: 'under' as const, tag: 'Cookery', carried: 18 },
  ],
  enabled: true,
}

/*
 * Both rules reach this area; the more specific one (the smaller place)
 * wins the tie. This screen draws both, not just the winner.
 */
const COOKERY_REACHING = [
  { id: 1, name: 'Cookery', place: '2 · Cookery', wide: false },
  { id: 2, name: 'Non-fiction', place: 'bookcase 2', wide: true },
]

const COOKERY_BOOKS: ShelfItem[] = spines(COOKERY_BOARD)

/**
 * A genuinely different order, not the same list relabelled: the board
 * must actually match the ordering the card claims.
 */
const COOKERY_BY_YEAR: ShelfItem[] = spines([
  'Acton, Eliza', 'Beeton, Isabella', 'Fisher, M. F. K.', 'David, Elizabeth',
  'Child, Julia', 'Grigson, Jane', 'Roden, Claudia', 'Smith, Delia',
  'McGee, Harold', 'Rogers, Ruth', 'Hopkinson, Simon', 'Slater, Nigel',
  'Lawson, Nigella', 'Blumenthal, Heston', 'Locatelli, Giorgio', 'Dahl, Sophie',
  'Ottolenghi, Yotam', 'Nosrat, Samin',
], 3)

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

/** The four real orderings, with no "follow" among them. That is the point. */
const FOUR = [
  { value: 'author', word: 'By the author' },
  { value: 'title', word: 'By the title' },
  { value: 'published', word: 'By the year it came out' },
  { value: 'tag', word: 'By tag', sub: 'Not ready to be offered yet', off: true },
]

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
      /* Kept identical to the built version: the two answers must differ
         only in how the change is asked, or the comparison is noise. */
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
 * Two lines, joined by "and": there is no control for "or" here, since
 * two separate rules would each need their own place.
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
           * Matches anywhere in the word, not just the front: "Second
           * World War" appears here on the strength of its middle.
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
 * Not a second way to make a tag: `domain/tagging/naming.ts` decides
 * what a word means, the same as it does on a book.
 *
 * Nothing is written here. The word becomes a tag only when the rule is
 * saved, so walking away leaves no trace.
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
 * A prepared shelf, not a broken one: the rule matches a tag nothing
 * carries yet. Same phrasing as an empty rule ("claims nothing"), with
 * the one word added.
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
 * A rule with no conditions claims nothing, not everything (see
 * `domain/placement/rules`): that's what makes it safe mid-edit.
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
 * "Add a tag" extends one rule (AND); "Allow something else as well"
 * creates a second rule (OR). `domain/placement/rules.ts` has no boolean
 * tree, only separate rules that each file the book.
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
 * Nothing is written yet; this previews what applying the draft rule
 * would do. Pinned books are never silently subtracted: a pin overrules
 * the rules permanently.
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
 * Applying the rule moved nothing: a book only moves when someone picks
 * it up and says so.
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
 * Removing an area merges its books into another area; only the label
 * changes. Three states: something before it (`Removing`), nothing
 * before it so labels shuffle up (`RemovingFirst`), or neither before
 * nor after, which goes to the plan instead (`RemovingOnly`).
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

/*
 * No "picked up" state is ever recorded: the model only tracks where a
 * book was last put down, so nothing here writes until a book is placed.
 * There is no plan table either; `domain/placement/plan.ts` recomputes
 * what needs carrying fresh each time this list is drawn.
 */

/** Fifty-three books: the size this has to survive, not a size chosen to draw well. */
function Carry(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar title="Books to carry" sub="53 books, five trips" onBack={() => go('home')} />
      }
    >
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

      <Button tone="quiet" block onPress={() => go('carryleft')}>
        Leave them where they are
      </Button>

      {/* Must list what it excludes (pinned, checked out, unconfirmed)
          in the same words as the plan: a list that quietly dropped
          them would be believed anyway. */}
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
 * Must not read as "every book is where the rules want it" (a person
 * overrode them, so they do not agree), and must not forget which rule
 * was overridden: both stay visible with a way to put the work back.
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
 * "I have all eight" writes nothing: it is the one step in this flow
 * that is pure navigation, since the books are not anywhere yet.
 */
function Trip4A(go: Go) {
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

      <Button tone="quiet" block onPress={() => go('carry')}>
        Put them back on 4A
      </Button>
    </Phone>
  )
}

/**
 * Cascades exactly as `docs/shelving.md` specifies: if an area is full,
 * its last book bumps to the next one, which may itself be full, asking
 * again. The armful can grow.
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
 * Demonstrates one area feeding two destinations (4B appears in two
 * trips): grouping by where books come off means you still only read 4B
 * once.
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
 * No accept or dismiss: the list already changed when the rule did,
 * this just explains it, and the only way on is doing the work.
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

/**
 * Never guesses or preselects a tag: the app writes one only when the
 * person says so, and saying so never itself moves the book, only queues
 * it for the carry list if a rule then wants it elsewhere. Both blocks
 * are drawn in full, not summarized: summarizing these specific books
 * was the original complaint.
 */
function Unclaimed(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar title="Unfiled books" sub="Twelve books" onBack={() => go('home')} />
      }
    >
      <Instruction>
        No rule asks for these twelve, so nothing will ever move them.
      </Instruction>

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
 * Only offers tags a rule actually asks for, since anything else changes
 * nothing when chosen. Nothing is preselected: a default here would be
 * the app quietly guessing, which is the one thing this screen must
 * never do.
 */
function Saying(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={<TopBar title="Say what it is" sub="The Peregrine" onBack={() => go('unclaimed')} />}
    >
      <Instruction>Nothing knows what this book is, so no rule can ask for it.</Instruction>

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

function UnclaimedNone(go: Go) {
  return (
    <Phone
      tab="library"
      go={go}
      top={
        <TopBar
          title="Unfiled books"
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

/**
 * Buttons are whatever `GET /api/auth/providers` lists; the development
 * provider is deliberately not told apart from a real one by the
 * client.
 */
function WayInOne() {
  return (
    <WayIn
      ways={[{ id: 'google', label: 'Google' }]}
      said="These are somebody's own books. Sign in, and the person whose books they are can let you in."
    />
  )
}

function WayInTwo() {
  return (
    <WayIn
      ways={[
        { id: 'google', label: 'Google' },
        { id: 'dev', label: 'this machine' },
      ]}
      said="These are somebody's own books. Sign in, and the person whose books they are can let you in."
    />
  )
}

function WayInCancelled() {
  return (
    <WayIn
      ways={[{ id: 'google', label: 'Google' }]}
      said="These are somebody's own books. Sign in, and the person whose books they are can let you in."
      trouble={signInTroubleSaid('cancelled', 'Google')}
    />
  )
}

function WayInStale() {
  return (
    <WayIn
      ways={[{ id: 'google', label: 'Google' }]}
      said="These are somebody's own books. Sign in, and the person whose books they are can let you in."
      trouble={signInTroubleSaid('stale')}
    />
  )
}

function WaitingScreen() {
  return <WaitingList email="alex@example.com" />
}

export const SCREENS: Screen[] = [
  { id: 'wayin', name: 'A way in', group: 'Getting in', render: WayInOne },
  { id: 'wayintwo', name: 'Two ways in', group: 'Getting in', render: WayInTwo },
  { id: 'wayincancelled', name: 'Cancelled at the door', group: 'Getting in', render: WayInCancelled },
  { id: 'wayinstale', name: 'Back after a sign-in', group: 'Getting in', render: WayInStale },
  { id: 'waiting', name: 'Signed in, not in yet', group: 'Getting in', render: WaitingScreen },
  { id: 'home', name: 'Today', group: 'Every day', render: Home },
  /* Screen names show in a bar that truncates around twenty-four
     characters; keep them short. */
  { id: 'unbacked', name: 'Nothing backed up', group: 'Every day', render: Unbacked },
  { id: 'nodisk', name: 'Backups unreadable', group: 'Every day', render: NoDisk },
  { id: 'adrift', name: 'Not where claimed', group: 'Every day', render: Adrift },
  { id: 'unanswered', name: 'Nothing answered', group: 'Every day', render: Unanswered },
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
  { id: 'details', name: 'The details of a book', group: 'Every day', render: BookDetails },
  { id: 'amiss', name: 'A book to be moved', group: 'Every day', render: BookAmiss },
  { id: 'detailsout', name: 'A book that is out', group: 'Every day', render: BookOut },
  { id: 'find', name: 'Find, before you type', group: 'Finding a book', render: Find },
  { id: 'finding', name: 'Typing a name', group: 'Finding a book', render: Finding },
  { id: 'findisbn', name: 'Typing an ISBN', group: 'Finding a book', render: FindIsbn },
  { id: 'findtag', name: 'Typing a tag', group: 'Finding a book', render: FindTag },
  { id: 'findnone', name: 'Nothing matches', group: 'Finding a book', render: FindNone },
  { id: 'tags', name: 'All twenty-three tags', group: 'Finding a book', render: TagsScreen },
  /* Filed under "Finding a book", not Cataloguing: this is the camera
     for a book you already own, not one you are adding. */
  {
    id: 'inhand',
    name: 'The book in your hand',
    group: 'Finding a book',
    render: InHandCamera,
  },
  {
    id: 'inhandsaid',
    name: 'The book it could not find',
    group: 'Finding a book',
    render: InHandCameraSaying,
  },
  { id: 'spine', name: 'Framing the spine', group: 'Cataloguing', render: SpineShot },
  { id: 'camera', name: 'The camera', group: 'Cataloguing', render: Camera },
  { id: 'camerapage', name: 'The camera on a page', group: 'Cataloguing', render: CameraOnAPage },
  { id: 'cameracover', name: 'The camera on a dark cover', group: 'Cataloguing', render: CameraOnACover },
  /* Own group rather than four more Cataloguing entries: these four are
     one screen with one variable, meant to be walked and compared in
     this order: the defect, the obvious answer, the expensive answer,
     and the one that shipped. */
  {
    id: 'framenow',
    name: 'The line on its own',
    group: 'Four ways to draw the aiming frame',
    render: FrameNow,
  },
  {
    id: 'framedark',
    name: 'The line, dark instead',
    group: 'Four ways to draw the aiming frame',
    render: FrameDark,
  },
  {
    id: 'framedim',
    name: 'The room around it, dimmed',
    group: 'Four ways to draw the aiming frame',
    render: FrameDim,
  },
  {
    id: 'framekeyline',
    name: 'The line with a keyline',
    group: 'Four ways to draw the aiming frame',
    render: FrameKeyline,
  },
  /* A second group, not five screens inside the first: these two ask
     where the frame's bottom sits, not what colour it is. Walk them at
     two sizes (414 by 896, then something shorter); at one size they
     draw nearly the same frame on purpose. */
  {
    id: 'framescreen',
    name: 'Measured against the screen',
    group: 'Two ways to keep the frame clear of the controls',
    render: FrameScreen,
  },
  {
    id: 'framebar',
    name: 'Measured against the picture above the bar',
    group: 'Two ways to keep the frame clear of the controls',
    render: FrameBar,
  },
  { id: 'review', name: 'Check the details', group: 'Cataloguing', render: Review },
  {
    id: 'reviewnone',
    name: 'Nothing came back',
    group: 'Cataloguing',
    render: ReviewNone,
  },
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
  { id: 'queuemany', name: 'A queue of forty', group: 'Cataloguing', render: QueueMany },
  { id: 'queuestuck', name: 'Four kinds of stuck', group: 'Cataloguing', render: QueueStuck },
  { id: 'empty', name: 'An empty queue', group: 'Cataloguing', render: Empty },
  { id: 'menu', name: 'The corner opened', group: 'The corner', render: RoomMenu },
  { id: 'settings', name: 'Settings', group: 'The corner', render: SettingsScreen },
  /* The ids are the URLs and must not change once shipped; the names are
     read, and use the neutral word since not every piece in the room is
     a bookcase. */
  { id: 'furniture', name: 'All six pieces', group: 'Your fixtures', render: Furniture },
  { id: 'bookcase', name: 'One fixture', group: 'Your fixtures', render: Bookcase },
  {
    id: 'fixturesort',
    name: 'A fixture’s sort rule',
    group: 'Your fixtures',
    render: BookcaseSorting,
  },
  {
    id: 'fixturerule',
    name: 'What a fixture allows',
    group: 'Your fixtures',
    render: BookcaseRule,
  },
  { id: 'area', name: 'One area', group: 'Your fixtures', render: Area },
  { id: 'sortrule', name: 'An area’s sort rule', group: 'Your fixtures', render: AreaSorting },
  {
    id: 'areaown',
    name: 'An area ordered its own way',
    group: 'Your fixtures',
    render: AreaOwn,
  },
  {
    id: 'rulewriting',
    name: 'Changing what belongs',
    group: 'Your fixtures',
    render: RuleWriting,
  },
  { id: 'ruletag', name: 'Choosing a tag', group: 'Your fixtures', render: RuleTag },
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
  {
    id: 'claimednone',
    name: 'Nothing claims this one',
    group: 'Your fixtures',
    render: ClaimedNone,
  },
  { id: 'move', name: 'Move non-fiction', group: 'Putting things right', render: Move },
  { id: 'plan', name: 'The plan', group: 'Putting things right', render: Plan },
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
  { id: 'unclaimed', name: 'Unfiled books', group: 'Putting things right', render: Unclaimed },
  { id: 'saying', name: 'Say what a book is', group: 'Putting things right', render: Saying },
  {
    id: 'unclaimednone',
    name: 'Everything is filed',
    group: 'Putting things right',
    render: UnclaimedNone,
  },
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
 * Temporary: "Two ways to say the order" and its two screens, plus
 * `OtherOrder` and the `instead` prop on `AreaScreen`, all go together
 * the day the sort-rule question is answered.
 */
export const GROUPS = [
  'Getting in',
  'Every day',
  'Finding a book',
  'Cataloguing',
  /* Temporary: this heading, its four screens, `aimedWith` and the
     three `.wf-view__guide` modifiers all go together the day the
     aiming frame is chosen. */
  'Four ways to draw the aiming frame',
  'The corner',
  'Your fixtures',
  'Putting things right',
  'Two ways to say the order',
]
