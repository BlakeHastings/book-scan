/**
 * Finding a book, and the tags that narrow what you are looking at.
 *
 * ## One field, and the field works out what you meant
 *
 * The owner asked for one place to type and no mode switch:
 *
 * > We look and see whether they're putting in an ISBN. We look and see
 * > whether they're putting in the title or the author, and we fuzzy search by
 * > title and author. And we also look for tags. If the user wants to, they can
 * > put in like a pound sign and a tag, and we only show the books in that tag.
 *
 * So the field decides, and it says out loud what it decided, in one quiet line
 * under itself. That line is the whole of the interface for a feature that
 * would otherwise be four radio buttons nobody would ever press: it is only
 * drawn when the answer is not obvious from what was typed, which in practice
 * means a number that turned out to be an ISBN, and a tag.
 *
 * ## Why there is no row of tag buttons anywhere
 *
 * Fiction and non-fiction used to be a two-button control at the top of the
 * library, and they are now two tags out of however many somebody keeps. A
 * person with twenty tags is the ordinary case rather than the extreme one, and
 * twenty buttons is not a control, it is a wall.
 *
 * Two things replace it. A **single row** says what is being shown and opens
 * the tags, so the top of the library costs one line whether you keep two tags
 * or forty. And the tags themselves are **nested**, because they really are:
 * `docs/data-model.md` puts the hierarchy in the slug, Obsidian style, so
 * "fantasy" sits under "genre" and "lent out" sits under "mine". Five groups
 * that open one at a time fit on a phone; twenty-two flat chips do not, and
 * would say the groups are not there.
 *
 * **Only the label is ever drawn.** The slug is the identity and a person never
 * sees it, so nothing in this file renders one and `design.test.tsx` refuses a
 * screen that does. What shows the nesting is the indent and the "under Genre"
 * line, never a `genre/fantasy` written out.
 */

import type { ReactElement, ReactNode } from 'react'
import { Cycle, Round } from './Controls'
import { IconCovers, IconFind, IconList, IconOnward, IconSpines } from './Icons'

/**
 * The one field.
 *
 * Drawn rather than editable, like every other field in this wireframe.
 *
 * **A chosen tag is not drawn in here**, and that took a pass to settle. It
 * could have been a chip inside the box, because `#fantasy` and tapping
 * Fantasy in the list really are the same query said two ways. But then a live
 * filter would be shown in two places, here and on the row at the top of the
 * library, and the two would have to be kept saying the same thing. Choosing a
 * tag hands you back to the library wearing it, so `Picked` is the one place a
 * filter is ever drawn.
 */
export function SearchField({
  typed,
  placeholder = 'Title, author, ISBN, or # for a tag',
  caret = false,
  reads,
  onType,
  label = 'Find a book',
}: {
  /** What has been typed so far. Empty is a state this screen has to show. */
  typed?: string
  placeholder?: string
  /** Whether the cursor is sitting in it. */
  caret?: boolean
  /** What the field made of what was typed, when that is worth saying. */
  reads?: ReactNode
  /**
   * Somebody typing into it, in the app.
   *
   * Given this, the box is a real field and `typed` is what is in it; without
   * it, the box is the drawing it has always been. One component rather than
   * two, because the wireframe and the screen have to look the same and the way
   * that stops being true is a second box drawn beside the first.
   *
   * **It does not take the focus on its own**, deliberately. A field that opens
   * the keyboard on arrival covers two thirds of the phone with it, and the
   * screen underneath, the one somebody sees before they have typed anything, is
   * most of what this screen is for.
   */
  onType?: (value: string) => void
  /** What the field is called, for anybody who cannot see the box it is in. */
  label?: string
}) {
  if (onType) {
    return (
      <div className="wf-search">
        <div className="wf-search__box">
          <span className="wf-search__glyph" aria-hidden="true">
            <IconFind size={18} />
          </span>
          <input
            className="wf-search__input"
            type="search"
            value={typed ?? ''}
            placeholder={placeholder}
            aria-label={label}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => onType(event.currentTarget.value)}
          />
        </div>
        {reads && <p className="wf-search__reads">{reads}</p>}
      </div>
    )
  }

  return (
    <div className="wf-search">
      <div className="wf-search__box">
        <span className="wf-search__glyph" aria-hidden="true">
          <IconFind size={18} />
        </span>
        {/* The cursor goes before an untouched placeholder and after anything
            actually typed. Drawn the other way round the placeholder read as
            words somebody had entered, which is the one thing a placeholder
            must never look like. Found by looking at it. */}
        {caret && !typed && (
          <span className="wf-search__caret wf-search__caret--lead" aria-hidden="true" />
        )}
        <span className={`wf-search__typed${typed ? '' : ' wf-search__typed--empty'}`}>
          {typed || placeholder}
        </span>
        {caret && typed && <span className="wf-search__caret" aria-hidden="true" />}
      </div>
      {reads && <p className="wf-search__reads">{reads}</p>}
    </div>
  )
}

/**
 * What the library is showing, and the way into the tags.
 *
 * One row, whatever somebody keeps. With nothing chosen it says so; with tags
 * chosen it wears them, and past three it counts the rest rather than growing
 * down the screen. This is what a two-button segmented control turned into
 * once fiction stopped being half of everything.
 */
export function Picked({
  tags = [],
  note,
  onPress,
}: {
  /** The chosen tags, as labels. */
  tags?: string[]
  /** How many books that leaves. Words, not a bare number. */
  note: string
  onPress?: () => void
}) {
  const shown = tags.slice(0, 3)
  const rest = tags.length - shown.length

  return (
    <button type="button" className="wf-picked" onClick={onPress}>
      <span className="wf-picked__what">
        {tags.length === 0 ? (
          <span className="wf-picked__all">Every book</span>
        ) : (
          shown.map((tag) => (
            <span key={tag} className="wf-tag wf-tag--on">
              {tag}
            </span>
          ))
        )}
        {rest > 0 && <span className="wf-picked__more">and {rest} more</span>}
      </span>
      <span className="wf-picked__note">{note}</span>
      <IconOnward size={18} />
    </button>
  )
}

/**
 * Which of the three ways of looking at the books somebody is on.
 *
 * All three stay, and the owner said so plainly: "the user should be able to
 * switch between gallery, list, and shelf views. Let's still keep that." The
 * words are not those three, because one of them is a word this interface does
 * not say. Covers, a list, and the books standing up.
 */
export type Look = 'covers' | 'list' | 'spines'

/** All three, in the order the button steps through them. */
const LOOKS: readonly Look[] = ['covers', 'list', 'spines']

/**
 * Pressing the switcher takes you to the next of the ones the screen offers,
 * and round again.
 *
 * A list and a function rather than the fixed table this was, because the queue
 * offers two of these three: a queued book is either face up in your hands or
 * shelved end on, and there is no list view of one book's photograph. The
 * alternative was a second switcher with its own two words for the same two
 * pictures, and two controls that mean the same thing is the fault the design
 * rules already name.
 *
 * A `look` that is not among them lands on the first rather than throwing: this
 * is a drawing decision, and no screen should go blank over one.
 */
function after(look: Look, looks: readonly Look[]): Look {
  const at = looks.indexOf(look)
  return looks[(at + 1) % looks.length] ?? looks[0]!
}

/**
 * What the switcher draws, which is the view it would move you to.
 *
 * Not the one you are in. `Controls.tsx` has the argument; the short of it is
 * that the screen underneath is already the loudest possible statement of which
 * view you are in, and nothing else on it says what this button does.
 */
const ICON: Record<Look, ReactElement> = {
  covers: <IconCovers size={20} />,
  list: <IconList size={20} />,
  spines: <IconSpines size={20} />,
}

/** And what it is called, in the same direction: the outcome, as a sentence. */
const NAME: Record<Look, string> = {
  covers: 'Show the covers',
  list: 'Show them as a list',
  spines: 'Show them standing up',
}

/**
 * What every library screen wears above its books.
 *
 * **One row, and that is the point of it.** It was two: the filter, and under it
 * a segmented control with Covers, List and Spines side by side. The owner took
 * the second row off and said why:
 *
 * > Instead of showing covers, list and spines as this very big thing that we
 * > can select one of three options for, can we put it to the right of the
 * > "every book" filter, underneath where the search symbol is in the top right
 * > corner? [...] That way you don't take up all this space for choosing between
 * > those different views.
 *
 * He is right, and the reason generalises the way the tag row's did. Which of
 * three ways you like looking at your books is a preference somebody sets rarely
 * and then lives with; the filter beside it is a question they answer
 * constantly. Charging the same rent for both, on the one screen whose whole job
 * is showing books, is the wrong trade, and it was 64px of every visit.
 *
 * **It is one component because it is one row.** The gallery draws it as three
 * screens you walk between and the app draws it as one screen that redraws
 * itself, and if each built its own row they would agree until one of them was
 * edited. The filter itself did not move and did not shrink: it is the same row,
 * with a 44px circle now sitting at the end of it.
 *
 * ## Finding is on this row now, and it had to end up no harder to reach
 *
 * The corner became the avatar, so find had to go somewhere, and the owner
 * said where: "we make sure that the library page has the ability for the user
 * to search using that search feature, even if we just represented there as
 * like a search button or something like that."
 *
 * The trap in that sentence is that losing a corner action and gaining a
 * harder-to-find one is a downgrade wearing a tidy-up's clothes. So the test
 * is reach rather than presence, and this row passes it: **one press, from the
 * first row of the page, on every screen the corner served.** Measured at 414
 * by 896, the glyph moved 56px down and 20px in from the top right corner,
 * which on a phone held in one hand is nearer the thumb than where it was, not
 * further. It also costs no height, because this row was already here.
 *
 * It sits **beside the filter and before the view switcher**, which is the
 * order of what the two round buttons do rather than an arrangement. The
 * filter and find both change *which* books you are looking at; the switcher
 * changes how they are drawn, and it stays at the end of the row where it was
 * already reviewed and approved.
 *
 * ## The queue wears the same row, led by its search box (#349)
 *
 * The queue had a segmented control of its own for which photograph a waiting
 * book is drawn by, and the owner asked for this instead:
 *
 * > We shouldn't do the spine versus cover selector there, and the way that we
 * > have it. We should do it the same way we did on the library page, where we
 * > just have the icon next to the search system that switches between spine or
 * > cover.
 *
 * So it is this row, called by that screen too, and what changes between them
 * is only what the row **leads** with. The library leads with the tags and a
 * circle to find a book; the queue leads with the box it already had, which is
 * both of those in one control, because it narrows the list as you type. Given
 * a lead, neither the tag row nor the find circle is drawn: a screen that
 * narrows by typing has no second filter and no second way to find anything.
 *
 * The switcher itself is the same component with the same icons and the same
 * sentences on both, which is the whole point of it being here rather than
 * written twice.
 *
 * ## And a screen with one way of looking draws no switcher (#363)
 *
 * The queue's two answers were the front and the spine, because a row drew one
 * small photograph and somebody had to say which. It now draws the book, which
 * is the spine standing against the front, so both are on every row and the
 * question the switcher asked is answered by the drawing. Two answers that
 * produce one picture is a control that lies, and the rule the switcher
 * arrived under says so in the other direction: two controls meaning the same
 * thing is the fault it was built to avoid.
 *
 * The row itself did not go anywhere, which is the part worth being careful
 * about: this is still the library's row, still led by the queue's search box,
 * still one component. What it is missing is a circle whose two presses drew
 * the same books.
 */
export function Filter({
  tags,
  note = '',
  onTags,
  onFind,
  look = 'covers',
  looks = LOOKS,
  onLook,
  children,
}: {
  /** The chosen tags, as labels. Nothing chosen says so. */
  tags?: string[]
  /** How many books that leaves. Words, not a bare number. */
  note?: string
  onTags?: () => void
  /** Finding, which used to be the one action in the corner. */
  onFind?: () => void
  /** Which way of looking this screen is drawing. */
  look?: Look
  /**
   * The ways of looking this screen has, in the order the button steps round.
   * All three unless a screen says otherwise.
   */
  looks?: readonly Look[]
  /**
   * Given the view being moved to, which is the one the button draws.
   *
   * Without it there is no switcher at all, for the screen that has one way of
   * looking at what it lists. A circle that redraws the same thing is worse
   * than no circle.
   */
  onLook?: (next: Look) => void
  /**
   * What the row leads with, where a screen narrows by typing rather than by
   * tags. Given one, `tags`, `note`, `onTags` and `onFind` have nothing to
   * draw and are not read.
   */
  children?: ReactNode
}) {
  const next = after(look, looks)

  return (
    <div className="wf-filter">
      {children ? (
        <div className="wf-filter__lead">{children}</div>
      ) : (
        <>
          <Picked tags={tags} note={note} onPress={onTags} />
          <Round name="Find a book" icon={<IconFind size={20} />} onPress={onFind} />
        </>
      )}
      {onLook && <Cycle name={NAME[next]} icon={ICON[next]} onPress={() => onLook(next)} />}
    </div>
  )
}

/**
 * A group of tags: everything under one name.
 *
 * Open or shut, and shut is the state that makes twenty-two of these fit. A
 * shut group still says how many are inside it, so nothing is hidden, only
 * folded. Same box-inside-a-box the furniture screens use, for the same
 * reason: one thing inside another is a relationship anybody reads without
 * being taught it.
 */
export function TagGroup({
  name,
  note,
  open = false,
  onPress,
  children,
}: {
  /** The label a person reads. Never the slug it is stored under. */
  name: string
  note: string
  open?: boolean
  onPress?: () => void
  children?: ReactNode
}) {
  return (
    <section className={`wf-tgroup${open ? ' wf-tgroup--open' : ''}`} aria-label={name}>
      <button type="button" className="wf-tgroup__head" onClick={onPress} aria-expanded={open}>
        <span className="wf-tgroup__name">{name}</span>
        <span className="wf-tgroup__note">{note}</span>
        <IconOnward size={18} />
      </button>
      {open && children && <div className="wf-tgroup__body">{children}</div>}
    </section>
  )
}

/**
 * One tag you can choose, inside its group.
 *
 * `under` is a tag that sits inside another tag rather than directly in the
 * group, and it is indented one step further. Two steps is as deep as anything
 * here goes, and the indent is the only thing saying so: no tree lines, no
 * rails, no dotted leaders.
 */
export function TagPick({
  name,
  books,
  on = false,
  under = false,
  onPress,
}: {
  name: string
  books: number
  on?: boolean
  under?: boolean
  onPress?: () => void
}) {
  const className = ['wf-pick', on ? 'wf-pick--on' : '', under ? 'wf-pick--under' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" className={className} aria-pressed={on} onClick={onPress}>
      <span className="wf-pick__name">{name}</span>
      {/* One book is one book, the same as the row under it (#433). */}
      <span className="wf-pick__count">{books} book{books === 1 ? '' : 's'}</span>
      {on && <span className="wf-pick__mark">Showing</span>}
    </button>
  )
}

/**
 * A tag offered while somebody is part way through typing one.
 *
 * The second line is where the nesting goes when there is no tree to indent
 * inside: "under Genre", or "under Subject, History" two deep. Said in words
 * rather than drawn as `genre/fantasy`, because the slug is the identity and
 * the label is the only part anybody is meant to see.
 */
export function Suggestion({
  name,
  where,
  books,
  onPress,
}: {
  name: string
  /** The tags it sits under, as labels: "Genre", or "Subject, History". */
  where?: string
  books: number
  onPress?: () => void
}) {
  return (
    <button type="button" className="wf-suggest" onClick={onPress}>
      <span className="wf-suggest__text">
        <span className="wf-suggest__name">{name}</span>
        {where && <span className="wf-suggest__where">under {where}</span>}
      </span>
      {/* One book is one book. The wireframe only ever drew tags with dozens
          under them, so "1 books" was never on screen until #372 put this row
          in front of a real collection where a tag somebody has just made has
          exactly one. Found by looking at it. */}
      <span className="wf-suggest__count">{books} book{books === 1 ? '' : 's'}</span>
    </button>
  )
}

export function Suggestions({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="wf-suggests" role="list" aria-label={label}>
      {children}
    </div>
  )
}
