/**
 * Every icon in the redesign, drawn inline.
 *
 * There are seven, and that is the whole set on purpose. An icon here only
 * exists where a word is already beside it (the tab bar) or where the target
 * is a corner of the screen too small for a word (back, close). Anywhere
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
