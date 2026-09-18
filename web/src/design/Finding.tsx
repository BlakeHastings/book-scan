/**
 * Finding a book, and the tags that narrow what you are looking at.
 *
 * One field decides whether what was typed is an ISBN, a title, an author or
 * a tag (`#tag`), and says out loud what it decided in one line under itself,
 * drawn only when the answer is not obvious. Tags are nested, per
 * `docs/data-model.md`'s slug hierarchy, so "fantasy" sits under "genre".
 * Only the label is ever drawn: the slug is the identity and a person never
 * sees it, which `design.test.tsx` enforces.
 */

import type { ReactElement, ReactNode } from 'react'
import { Cycle, Round } from './Controls'
import { IconCovers, IconFind, IconList, IconOnward, IconSpines } from './Icons'

/**
 * The one field. A chosen tag is never drawn inside it: choosing a tag hands
 * you back to the library wearing it, so `Picked` is the one place a filter is
 * ever drawn, rather than showing the same live filter in two places.
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
   * Somebody typing into it, in the app. Given this, the box is a real field;
   * without it, it draws read-only. It does not take focus on its own: opening
   * the keyboard on arrival would cover most of the screen before anything is
   * typed.
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
        {/* The cursor sits before an untouched placeholder and after typed
            text; the other way round, the placeholder reads as entered text. */}
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
 * What the library is showing, and the way into the tags. With nothing chosen
 * it says so; with tags chosen it wears them, and past three it counts the
 * rest rather than growing down the screen.
 */
export function Picked({
  tags = [],
  showing,
  note,
  onPress,
}: {
  /** The chosen tags, as labels. */
  tags?: string[]
  /**
   * A narrowing that is not a tag, said in words. Absent is every book. Drawn
   * beside the tags rather than among them: a tag is a thing somebody said
   * about a book, and this is a thing that happened to it.
   */
  showing?: string
  /** How many books that leaves. Words, not a bare number. */
  note: string
  onPress?: () => void
}) {
  const shown = tags.slice(0, 3)
  const rest = tags.length - shown.length

  return (
    <button type="button" className="wf-picked" onClick={onPress}>
      <span className="wf-picked__what">
        {showing && <span className="wf-tag wf-tag--on">{showing}</span>}
        {tags.length === 0 ? (
          !showing && <span className="wf-picked__all">Every book</span>
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

/** Which of the three ways of looking at the books somebody is on. */
export type Look = 'covers' | 'list' | 'spines'

/** All three, in the order the button steps through them. */
const LOOKS: readonly Look[] = ['covers', 'list', 'spines']

/**
 * Pressing the switcher takes you to the next of the ones the screen offers,
 * and round again. A `look` that is not among them lands on the first rather
 * than throwing.
 */
function after(look: Look, looks: readonly Look[]): Look {
  const at = looks.indexOf(look)
  return looks[(at + 1) % looks.length] ?? looks[0]!
}

/** What the switcher draws: the view it would move you to, not the current one. See `Cycle` in Controls.tsx. */
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
 * What every library screen wears above its books. One row: the filter, the
 * find circle, and the view switcher at the end. One component because the
 * gallery draws it as three screens and the app redraws one screen, and a
 * separate row in each would drift apart. The queue calls this same row, led
 * by its own search box instead of the tag filter; given a lead, neither the
 * tag row nor the find circle is drawn. A screen with only one way of looking
 * draws no switcher.
 */
export function Filter({
  tags,
  showing,
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
  /** A narrowing that is not a tag, said in words. See `Picked`. */
  showing?: string
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
  /** Given the view being moved to. Without it there is no switcher at all. */
  onLook?: (next: Look) => void
  /**
   * What the row leads with, where a screen narrows by typing rather than by
   * tags. Given one, `tags`, `note`, `onTags` and `onFind` are not read.
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
          <Picked tags={tags} showing={showing} note={note} onPress={onTags} />
          <Round name="Find a book" icon={<IconFind size={20} />} onPress={onFind} />
        </>
      )}
      {onLook && <Cycle name={NAME[next]} icon={ICON[next]} onPress={() => onLook(next)} />}
    </div>
  )
}

/** A group of tags: everything under one name. Shut, a group still says how many are inside it. */
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
 * One tag you can choose, inside its group. `under` is a tag that sits inside
 * another tag rather than directly in the group; two steps is as deep as
 * anything here goes.
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
      <span className="wf-pick__count">{books} book{books === 1 ? '' : 's'}</span>
      {on && <span className="wf-pick__mark">Showing</span>}
    </button>
  )
}

/**
 * A tag offered while somebody is part way through typing one. The second
 * line says the nesting in words, "under Genre", never as `genre/fantasy`.
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
