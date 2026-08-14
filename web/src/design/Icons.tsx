/**
 * Every icon in the redesign, drawn inline.
 *
 * There are eleven, and that is the whole set on purpose. An icon here exists
 * only where a word is already beside it (the tab bar), where the target is a
 * corner of the screen (back, and the one action in the top right), or where
 * the target sits inside a control that has no room for a word and is already
 * labelled by it. Anywhere else the answer in this app is the word itself.
 *
 * The third of those is the camera at the end of the ISBN field, and it is the
 * owner's: "on the right side of it, we should show like a camera icon for
 * them to change the ISBN." The field's own label says what the value is, so
 * the icon only has to say how else you can give one. It still carries an
 * accessible name; see `Controls.tsx`.
 *
 * The top right used to be a word, and the owner asked for both of the words
 * that ever appeared there to become icons instead: "The find in the top right
 * corner there shouldn't just be a word. That should be like a search icon",
 * and the same for edit. That is what `IconEdit` is for and it is why the rule
 * above now names the corner rather than only the back arrow. A corner action
 * still carries an accessible name; see `Chrome.tsx`.
 *
 * **Nothing was added here for the portrait in the corner** (#329), and that
 * is worth saying because it is the obvious place to have put one. It is the
 * cat, framed, and he lives in `Cat.tsx` where his other three jobs are. A
 * twelfth glyph drawn to stand in for a cat that is already drawn is a second
 * cat, and the set is eleven for the same reason it was eleven before.
 *
 * `IconFind` is drawn a row lower than it used to be, in the filter row rather
 * than the top bar, and it is the same glyph doing the same job. See `Filter`.
 *
 * ## The last three, and why they are drawings rather than words
 *
 * Covers, list and spines were three words in a segmented control taking a
 * whole row at the top of every library screen, and the owner took the row
 * off: "a little circle that when clicked changes between covers, list and
 * spines, and we should use icons to represent those [...] that way you don't
 * take up all this space for choosing between those different views."
 *
 * So each of the three is a glyph, and the button carrying it is named for
 * what pressing it does rather than for where you are. `IconSpines` is the one
 * with no convention behind it, and it is drawn as what the shelf underneath
 * it already looks like: books of different heights standing on a board. That
 * is the whole reason it reads without being taught.
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
