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

import type { ReactNode } from 'react'
import { IconFind, IconOnward } from './Icons'

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
}: {
  /** What has been typed so far. Empty is a state this screen has to show. */
  typed?: string
  placeholder?: string
  /** Whether the cursor is sitting in it. */
  caret?: boolean
  /** What the field made of what was typed, when that is worth saying. */
  reads?: ReactNode
}) {
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
      <span className="wf-pick__count">{books} books</span>
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
      <span className="wf-suggest__count">{books} books</span>
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
