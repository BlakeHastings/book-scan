/**
 * Every icon in the redesign, drawn inline. There are fifteen, and that is
 * the whole set on purpose: an icon here exists only where a word is already
 * beside it (the tab bar, a full-width action row), where the target is a
 * corner of the screen (back, the one top-right action), or where the target
 * sits inside a control that is already labelled by its own word. Anywhere
 * else the answer in this app is the word itself.
 *
 * One stroke weight, one cap style, one 24 grid, and `currentColor` so an
 * icon is coloured by the thing it sits in rather than by a prop.
 */

interface Props {
  size?: number
  className?: string
}

function Glyph({ size = 22, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** Home: a book lying open, which is what the first screen is about. */
export function IconHome(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M12 7.2C10 5.4 6.8 5 4.5 5.2v12C6.8 17 10 17.4 12 19.2c2-1.8 5.2-2.2 7.5-2v-12C17.2 5 14 5.4 12 7.2Z" />
      <path d="M12 7.2v12" />
    </Glyph>
  )
}

/** Shelves: a bookcase, two planks, spines standing on them. */
export function IconShelves(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M3.5 4.5h17M3.5 12h17M3.5 19.5h17" />
      <path d="M6.5 12V7.5M9.5 12V7.5M12.5 12V6.5M7 19.5V15M10 19.5V15M13 19.5V14" />
    </Glyph>
  )
}

/** Camera. */
export function IconCamera(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M3.5 8.5A2 2 0 0 1 5.5 6.5h1.8l1.2-2h6.9l1.2 2h1.9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.5" r="3.6" />
    </Glyph>
  )
}

/** Queue: a pile waiting to be dealt with. */
export function IconQueue(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M4 17.5h16M4 12.5h16M6.5 7.5h11" />
      <path d="M9 4h6" />
    </Glyph>
  )
}

/** Find. */
export function IconFind(p: Props) {
  return (
    <Glyph {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20 20" />
    </Glyph>
  )
}

/**
 * The book in your hand: a closed book, and a lens looking at it. Deliberately
 * not a camera: this app has two cameras (cataloguing and identifying a book
 * you already own) and they must never be mistaken for each other on the
 * screen that offers both. It is `IconFind` with a book in front of it,
 * deliberately, since both mean finding, just by typing versus by holding.
 */
export function IconInHand(p: Props) {
  return (
    <Glyph {...p}>
      <rect x="2.8" y="4" width="8.6" height="12.4" rx="1.3" />
      <path d="M5.2 4v12.4" />
      <circle cx="16.4" cy="13.6" r="4.2" />
      <path d="M19.5 16.7 21.6 18.8" />
    </Glyph>
  )
}

/**
 * Carrying: a book, and the way it has to go. The arrow sits beside the book
 * rather than over it: an arc across the top of a small rectangle reads as a
 * padlock. Not drawn as a stack either, since that is `IconQueue`.
 */
export function IconCarry(p: Props) {
  return (
    <Glyph {...p}>
      <rect x="2.6" y="4.4" width="8" height="15.2" rx="1.3" />
      <path d="M5.2 4.4v15.2" />
      <path d="M13.2 12h7.6" />
      <path d="M17.6 8.6 21 12l-3.4 3.4" />
    </Glyph>
  )
}

/**
 * Saying what a book is: a book, and a label to put on it. Must not be
 * mistaken for `IconInHand`, directly above it on the screen that draws both:
 * the tag is wide and flat where that glyph's lens is round.
 */
export function IconSaying(p: Props) {
  return (
    <Glyph {...p}>
      <rect x="2.6" y="4.4" width="8" height="15.2" rx="1.3" />
      <path d="M5.2 4.4v15.2" />
      <path d="M14 8.4h6.6a1.4 1.4 0 0 1 1.4 1.4v4.4a1.4 1.4 0 0 1-1.4 1.4H14l-2.4-3.6Z" />
      <circle cx="15.4" cy="12" r="0.9" />
    </Glyph>
  )
}

/**
 * A person: a head and the shoulders under it, deliberately the plainest
 * drawing of one there is. It is a door to your own room rather than a claim
 * about who is holding the phone, so nothing here may look like a particular
 * person. See `Portrait`.
 */
export function IconPerson(p: Props) {
  return (
    <Glyph {...p}>
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5.8 19.6a6.2 6.2 0 0 1 12.4 0" />
    </Glyph>
  )
}

/** Edit: a pencil laid across the corner, nib down. */
export function IconEdit(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M16.4 3.9a2.1 2.1 0 0 1 3 3L9.6 16.7l-3.9.9.9-3.9Z" />
      <path d="M14.6 5.7 17.6 8.7" />
      <path d="M5 20.5h14" />
    </Glyph>
  )
}

/** Back. */
export function IconBack(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M14.5 5 8 12l6.5 7" />
    </Glyph>
  )
}

/** Onward, on a list row. */
export function IconOnward(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M9.5 5 16 12l-6.5 7" />
    </Glyph>
  )
}

/** Covers: the gallery, drawn as the grid it is. */
export function IconCovers(p: Props) {
  return (
    <Glyph {...p}>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </Glyph>
  )
}

/**
 * A list: a column of rows, each with something at the front of it.
 *
 * The bullets are what keep it apart from `IconQueue`, which is bare lines and
 * sits in the tab bar two inches below it.
 */
export function IconList(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M9.5 7.5h10.5M9.5 12h10.5M9.5 16.5h7.5" />
      <circle cx="5" cy="7.5" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5" cy="16.5" r="1.05" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/**
 * Spines: books of different heights standing on a board.
 *
 * The board is the line at the bottom, and it is not decoration: five bars
 * rising off nothing is a bar chart, and five bars standing on a plank is a
 * shelf. One rail, so it does not read as `IconShelves`, which is a whole
 * bookcase and has three.
 */
export function IconSpines(p: Props) {
  return (
    <Glyph {...p}>
      <path d="M3.5 19.5h17" />
      <path d="M5.6 19.5V8.2M9.8 19.5V6.2M14 19.5V8.8" />
      <path d="M20 19.5 16.6 8.6" />
    </Glyph>
  )
}
