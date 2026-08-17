/**
 * Every icon in the redesign, drawn inline.
 *
 * There are fifteen, and that is the whole set on purpose. An icon here exists
 * only where a word is already beside it (the tab bar), where the target is a
 * corner of the screen (back, and the one action in the top right), or where
 * the target sits inside a control that has no room for a word and is already
 * labelled by it. Anywhere else the answer in this app is the word itself.
 *
 * **The last two arrived with the first screen's actions** (#361), and they are
 * the first clause rather than a fourth: an action there is a full-width row
 * with its sentence written across it, which is a word already beside the
 * glyph, exactly as a tab is. The owner asked for one of them by name:
 *
 * > And then underneath those, we have the button for "find the book in your
 * > hand", and that should have an icon.
 *
 * `IconInHand` is that one and `IconCarry` is the other action beside it, drawn
 * at the same weight so the two read as one list rather than as one button and
 * one row that happens to look like it. `IconSaying` joined them in #341 and is
 * the third of that clause rather than a fourth kind of exception.
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
 * **The twelfth is `IconPerson`, and it arrived by the owner overruling the
 * drawing** (#350). #329 drew the corner as the cat and added nothing here,
 * on the argument that a face in that ring is a portrait of an account nobody
 * has. The owner read that argument and chose the other way, saying in the
 * same breath that multi-user is coming and that we are not there yet: he is
 * taking the shape that will be right later over the one that is honest today,
 * and it is his call. So there is a person in the set now, and everything the
 * drawing put underneath it is kept, which is `Chrome.tsx`'s note.
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

/**
 * The book in your hand: a closed book, and a lens looking at it.
 *
 * **It is deliberately not a camera**, and that is the whole reason it exists.
 * This app has two cameras, one that catalogues a book nobody has photographed
 * and one that identifies a book you already own, and #355 was the cost of the
 * two being confused. The first screen draws both: the cataloguing one is the
 * tab in the bar with `IconCamera` under the word "Scan", and this is the row
 * above it. Giving the row a camera would have put one glyph on the two doors
 * that must never be mistaken for each other, on the one screen that offers
 * both, which is how somebody photographs a book they already own into a second
 * record.
 *
 * **It is `IconFind` with a book in front of it, and the resemblance is the
 * point.** That one is the magnifier on the row above the books and means
 * finding a book by typing its name; this one means finding the book you are
 * holding. Both are finding, so both may look like finding; the pair that must
 * never look alike is this and the camera.
 *
 * Three drawings of it were rendered at 20px before this one was kept. A book
 * on an open palm is the obvious idea and it is a blob at this size: the arc of
 * the hand closes the bottom of the book and the whole thing reads as a bag.
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
 * Carrying: a book, and the way it has to go.
 *
 * The other action on the first screen, and the job is one book at a time
 * moving from where it stands to where it now belongs, so the drawing is a book
 * with an arrow beside it. Beside rather than over it, which was the first
 * attempt: an arc drawn across the top of a small rectangle reads as a padlock.
 *
 * Not an armful either. A stack of three rounded bars at this size is
 * `IconQueue` with different spacing, and that one is two inches below it in
 * the tab bar.
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
 * Saying what a book is: a book, and a label to put on it.
 *
 * The third action on the first screen (#341), drawn to the pattern the other
 * two already set: the book on the left at the same size and weight, and the
 * one thing this action does to it on the right. `IconCarry` puts an arrow
 * there because the job is a walk; this puts a tag there because the job is a
 * word, and a rule claims a book by its tags.
 *
 * **The pair it must not be mistaken for is `IconInHand`**, which is directly
 * above it on the screen that draws both. That was found by looking rather than
 * reasoned: the tag was first drawn as a small rotated square with a hole in it,
 * and at 20px beside a book it is a blob, which is what the lens on the other
 * glyph also is at that size. So the two doors read as the same picture. The tag
 * is now a label pointing at the book, wide and flat where the lens is round,
 * and its hole is far enough from the edge to survive being drawn at 20px.
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
 * A person: a head and the shoulders under it.
 *
 * The glyph in the ring in the top right, and the plainest drawing of one
 * there is, on purpose. It is a door to your own room rather than a claim
 * about who is holding the phone, so it is not initials, not a photograph and
 * not a silhouette with hair on it: anything that looks like a *particular*
 * person is the app asserting there is one, and there is not. See `Portrait`.
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
