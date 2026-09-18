/**
 * `design/Naming.tsx` is the panel and `domain/tagging/naming.ts` is the rule.
 * This component decides nothing about whether two tags are the same word; it
 * only asks the collection what it means and hands the answer to the drawing.
 */

import { useState } from 'react'
import { Nothing, Said } from '../design/Card'
import { Make, Naming } from '../design/Naming'
import { Suggestion, Suggestions } from '../design/Finding'
import { FICTION_SLUG, NON_FICTION_SLUG } from '../../domain/tagging/catalogue-claims'
import { slugSegment } from '../../domain/tagging/tags'
import { NAMED_UNDER, nameIn, nameTag, sameThing, type Naming as Verdict } from '../../domain/tagging/naming'
import type { TagRow } from '../lib/api'
import { labelOf, underOf } from '../lib/tagTree'

/** How many of the tags a collection uses most are offered before anything is typed. */
const FEW = 6

/** The two the buttons above the box answer, which this panel never offers. */
const GENRE_ANSWERS: string[] = [FICTION_SLUG, NON_FICTION_SLUG]

/**
 * A bundle of strings rather than a single `forBook` flag: a boolean that
 * switches copy would hide two sets of words behind one name, invisible to
 * the next caller.
 */
export interface NamingWords {
  title: string
  asks: string
  prompt: string
  wrong: string
  doing: string
  genreReads: string
  /** On a book this points at the two buttons above the box; on the tags screen there are none, so the wording differs by door. */
  genreSaid: string
  /** On a book there is something to do about the duplicate (file under the existing tag); on the tags screen there is not, since pressing it would make nothing new. */
  alreadySaid: string
}

const ABOUT_A_BOOK: NamingWords = {
  title: 'Add a tag',
  asks: 'What is this book?',
  prompt: 'Type what this book is. Whatever you say here, a rule can ask for.',
  wrong: 'That tag could not be added.',
  doing: 'Adding it...',
  genreReads: 'That is one of the two above.',
  genreSaid: 'Fiction and non-fiction are the two above this box. They decide which '
    + 'bookcase the book crosses the room to, so they are answered there rather '
    + 'than typed.',
  alreadySaid: 'That is the same word to this app as the one you already keep, so '
    + 'there is one tag rather than two. Add it, or type something else.',
}

export function TagNaming({
  vocabulary,
  carried,
  busy,
  error,
  words = ABOUT_A_BOOK,
  onPick,
  onClose,
}: {
  vocabulary: TagRow[]
  carried: readonly string[]
  busy: boolean
  error: string
  words?: NamingWords
  onPick: (tag: { slug: string; label: string }) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')

  const has = new Set(carried)
  // Excludes the two genre answers and tags this book already carries, since
  // offering either would draw a target that does nothing.
  const offerable = vocabulary.filter(
    (tag) => !GENRE_ANSWERS.includes(tag.slug) && !has.has(tag.slug),
  )

  const answer = nameTag(typed, offerable)

  // Never the slug: a pinned test refuses a screen that renders one.
  const under = labelOf(
    vocabulary.find((one) => one.slug === NAMED_UNDER.value)
    ?? { slug: NAMED_UNDER.value, label: '' },
  )

  const offer = (tag: TagRow) => (
    <Suggestion
      key={tag.slug}
      name={labelOf(tag)}
      where={underOf(tag, vocabulary)}
      books={tag.books}
      onPress={busy ? undefined : () => onPick({ slug: tag.slug, label: labelOf(tag) })}
    />
  )

  // Looser than `nameTag`'s whole-word equality check: matches a fragment
  // anywhere in a tag's slug or label so results appear before typing is
  // finished. Tags meaning the same thing as what was typed sort first.
  const looking = typed.trim().toLowerCase()
  const key = sameThing(typed)
  const name = slugSegment(typed)
  const reading = looking
    ? [...offerable]
      .filter((tag) => labelOf(tag).toLowerCase().includes(looking)
        || nameIn(tag.slug).includes(name)
        || sameThing(nameIn(tag.slug)) === key)
      .sort((a, b) => Number(sameThing(nameIn(b.slug)) === key)
        - Number(sameThing(nameIn(a.slug)) === key))
      .slice(0, FEW)
    : [...offerable].sort((a, b) => b.books - a.books).slice(0, FEW)

  return (
    <Naming
      typed={typed}
      title={words.title}
      asks={words.asks}
      onType={setTyped}
      onClose={onClose}
      reads={reads(answer, busy, reading.length, words)}
    >
      {error && <Nothing said={words.wrong}>{error}</Nothing>}

      {reading.length > 0 && (
        <Suggestions label={looking ? 'Tags reading like that' : 'Tags you use most'}>
          {reading.map(offer)}
        </Suggestions>
      )}

      {answer.kind === 'nothing' && reading.length === 0 && (
        <Said>{words.prompt}</Said>
      )}

      {answer.kind === 'genre' && <Said>{words.genreSaid}</Said>}

      {/* Deliberately offers no way to add anyway: that would make a second tag for what the collection already considers the same word. */}
      {answer.kind === 'already' && answer.nearly && <Said>{words.alreadySaid}</Said>}

      {answer.kind === 'new' && (
        <>
          <Make
            name={answer.label}
            where={under}
            onPress={busy ? undefined : () => onPick({ slug: answer.slug, label: answer.label })}
          />
          {/* Deliberately not "nothing of yours reads like that": the list above may still show partial matches even here. */}
          <Said>
            A new one goes under {under}, where your catalogue's own words go, so
            a rule can ask for it.
          </Said>
        </>
      )}
    </Naming>
  )
}

/** Only returns a caption where it is not already obvious from what is drawn below, the same rule the find screen's field follows. */
function reads(
  answer: Verdict,
  busy: boolean,
  listed: number,
  words: NamingWords,
): string | undefined {
  if (busy) return words.doing
  if (answer.kind === 'genre') return words.genreReads
  if (answer.kind === 'already' && answer.nearly) return 'You already keep this one.'
  // Only when listed is zero: otherwise this message and the list of near
  // matches would show together, contradicting each other.
  if (answer.kind === 'new' && listed === 0) return 'Nothing of yours reads like that yet.'
  if (listed > 0 && answer.kind !== 'nothing') {
    return listed === 1 ? 'One of your tags reads like that.' : `${listed} of your tags read like that.`
  }
  return undefined
}
